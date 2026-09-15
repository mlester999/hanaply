import { randomUUID } from 'node:crypto';

import { readLocalSupabaseEnvironment } from './local-supabase.js';
import { getAuthUserByEmail, getServiceRows } from './test-data.js';
import { pollUntil, runJobWorkerCycle } from './worker-cycle.js';

const environment = readLocalSupabaseEnvironment();

/**
 * The seeded posting the matching specs follow from ingestion to the browser.
 *
 * `tooling/db/demo-data.sql` inserts it through `upsert_ingested_job`, the same
 * service-role writer the ingestion worker uses, so it is a normalized row with
 * real provenance and a real source rather than a fabricated one. Its
 * requirements and skills are what the profile below was chosen to meet.
 */
export const analysedOpportunityTitle = 'Workflow Automation Engineer';

export interface AnalysisFixture {
  readonly userId: string;
  readonly careerProfileId: string;
  /** The version the worker must record as the one it scored against. */
  readonly profileVersion: number;
  readonly skillCount: number;
  readonly confirmedFactCount: number;
}

export interface StoredMatch {
  readonly id: string;
  readonly user_id: string;
  readonly job_id: string;
  readonly career_profile_id: string;
  readonly score: number;
  readonly verdict: string;
  readonly confidence: string;
  readonly model_version: string;
  readonly dimensions: readonly {
    readonly key: string;
    readonly label: string;
    readonly weight: number;
    readonly score: number | null;
    readonly contribution: number;
    readonly detail: string;
  }[];
  readonly strengths: readonly string[];
  readonly gaps: readonly string[];
  readonly blockers: readonly string[];
  readonly rejection_risks: readonly string[];
  readonly requirement_mapping: readonly {
    readonly requirement: string;
    readonly status: string;
    readonly matchedSkills: readonly string[];
    readonly evidence: string | null;
  }[];
  readonly recommended_action: string;
  readonly evidence_fact_ids: readonly string[];
  readonly data_quality: {
    readonly profileCompleteness: string;
    readonly jobDetail: string;
    readonly unknowns: readonly string[];
  };
  readonly profile_version: number;
  readonly job_updated_at: string;
  readonly computed_at: string;
}

/**
 * The career profile the matching fixtures score against.
 *
 * It is deliberately the profile the database-level radar test uses
 * (`supabase/tests/database/110_career_radar.test.sql`): a mid-level automation
 * specialist targeting the seeded "Workflow Automation Engineer" role. Against
 * that posting the deterministic engine has one strength to report (n8n and
 * TypeScript are on the profile), one gap to report (Supabase is not), one
 * requirement it can mark met, and one it must mark unmet — so the browser has a
 * real explanation to render rather than an empty shell.
 *
 * Five skills and three confirmed facts are the floor for the engine's `solid`
 * profile reading, which is what makes the stored confidence `high` instead of
 * `medium`. The extra skills are real adjacency, not filler: they change which
 * postings the radar ranks highest without touching the coverage of this one,
 * because coverage counts the vocabulary a posting actually names.
 */
const profileInput = {
  name: 'Primary search',
  headline: 'Workflow automation specialist',
  summary:
    'Builds reliable automation between business systems for small operations teams that need dependable operations without a platform team.',
  currentRoleTitle: 'Automation Specialist',
  careerLevel: 'mid',
  yearsExperience: 3.5,
  industries: ['SaaS'],
  targetRoleTitles: [analysedOpportunityTitle],
  preferredEmploymentTypes: ['full_time'],
  preferredWorkArrangement: 'remote',
  preferredLocations: ['Remote'],
  salaryMinMinor: 8_000_000,
  salaryPeriod: 'monthly',
} as const;

const profileSkills = [
  { name: 'n8n', skillKind: 'tool' },
  { name: 'TypeScript', skillKind: 'technology' },
  { name: 'SQL', skillKind: 'technology' },
  { name: 'Power BI', skillKind: 'tool' },
  { name: 'Node.js', skillKind: 'technology' },
] as const;

const profileFacts = [
  'Rebuilt onboarding automation for a 40-person operations team.',
  'Cut manual handoffs between billing and support by half.',
  'Owned the workflow library three teams depend on.',
] as const;

async function serviceRequest(
  path: string,
  init: { method: string; body?: string },
): Promise<Response> {
  const response = await fetch(new URL(path, environment.apiUrl), {
    ...init,
    headers: {
      apikey: environment.serviceRoleKey,
      Authorization: `Bearer ${environment.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `The analysis fixture request failed for ${path} (HTTP ${response.status}): ${body.slice(0, 400)}`,
    );
  }
  return response;
}

/**
 * Calls a server function as the service role, the way the API's own repository
 * does and the way the pgTAP radar fixture does. Fixtures are built through the
 * product's real write path — `create_career_profile`, `upsert_career_record`,
 * `record_career_facts` — rather than by inserting rows, so the profile the
 * worker reads is one the product could have produced.
 */
async function callFunction(name: string, body: unknown): Promise<unknown> {
  const response = await serviceRequest(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return text === '' ? null : JSON.parse(text);
}

async function activeProfiles(userId: string): Promise<{ id: string }[]> {
  return getServiceRows<{ id: string }[]>(
    `/rest/v1/career_profiles?select=id&user_id=eq.${userId}&status=neq.archived&order=created_at.asc`,
  );
}

async function ensureProfile(userId: string): Promise<string> {
  const existing = await activeProfiles(userId);
  const found = existing[0]?.id;
  if (found !== undefined) return found;
  const created = await callFunction('create_career_profile', {
    actor_user_id: userId,
    profile_input: profileInput,
    action_request_id: randomUUID(),
  });
  if (typeof created !== 'string') {
    throw new Error('The career profile fixture was not created');
  }
  return created;
}

async function ensureSkills(userId: string, profileId: string): Promise<void> {
  const existing = await getServiceRows<{ name: string }[]>(
    `/rest/v1/career_skills?select=name&career_profile_id=eq.${profileId}`,
  );
  const present = new Set(existing.map((row) => row.name));
  for (const skill of profileSkills) {
    if (present.has(skill.name)) continue;
    await callFunction('upsert_career_record', {
      actor_user_id: userId,
      target_profile_id: profileId,
      record_kind: 'skill',
      record_id: null,
      record_input: { name: skill.name, skillKind: skill.skillKind },
      action_request_id: randomUUID(),
    });
  }
}

async function ensureFacts(userId: string, profileId: string): Promise<void> {
  const existing = await getServiceRows<{ statement: string }[]>(
    `/rest/v1/career_facts?select=statement&career_profile_id=eq.${profileId}&status=eq.confirmed`,
  );
  const present = new Set(existing.map((row) => row.statement.toLowerCase()));
  const missing = profileFacts.filter((statement) => !present.has(statement.toLowerCase()));
  if (missing.length === 0) return;
  await callFunction('record_career_facts', {
    actor_user_id: userId,
    target_profile_id: profileId,
    facts: missing.map((statement) => ({ statement, category: 'achievement' })),
    requested_source: 'user_entered',
    source_document_id: null,
    action_request_id: randomUUID(),
  });
}

async function fixtureCounts(
  profileId: string,
): Promise<{ profileVersion: number; skillCount: number; confirmedFactCount: number }> {
  const profiles = await getServiceRows<{ version: number }[]>(
    `/rest/v1/career_profiles?select=version&id=eq.${profileId}`,
  );
  const skills = await getServiceRows<{ id: string }[]>(
    `/rest/v1/career_skills?select=id&career_profile_id=eq.${profileId}`,
  );
  const facts = await getServiceRows<{ id: string }[]>(
    `/rest/v1/career_facts?select=id&career_profile_id=eq.${profileId}&status=eq.confirmed`,
  );
  return {
    profileVersion: profiles[0]?.version ?? 0,
    skillCount: skills.length,
    confirmedFactCount: facts.length,
  };
}

/**
 * Gives one fixture account the career profile the matching specs score against,
 * and reports the identifiers the assertions need.
 *
 * It is idempotent: a profile that already exists is reused, and only the
 * missing skills and facts are written. Every write goes through the product's
 * own server functions, so running it twice cannot double a row, and the version
 * it returns is read after the writes rather than assumed.
 */
export async function ensureAnalysisFixture(account: {
  email: string;
  password: string;
}): Promise<AnalysisFixture> {
  const user = await getAuthUserByEmail(account.email);
  if (!user?.id) throw new Error(`The ${account.email} fixture account is missing`);
  const careerProfileId = await ensureProfile(user.id);
  await ensureSkills(user.id, careerProfileId);
  await ensureFacts(user.id, careerProfileId);

  const counts = await fixtureCounts(careerProfileId);
  if (counts.skillCount < profileSkills.length || counts.confirmedFactCount < profileFacts.length) {
    throw new Error(
      `The analysis fixture for ${account.email} is incomplete: ${counts.skillCount} skill(s) and ${counts.confirmedFactCount} confirmed fact(s). A score stored from a thin profile would report low confidence, which is not what these specs assert.`,
    );
  }
  return { userId: user.id, careerProfileId, ...counts };
}

/** The stored match row for one profile and opportunity, or null while none exists. */
export async function storedMatch(
  fixture: AnalysisFixture,
  jobId: string,
): Promise<StoredMatch | null> {
  const rows = await getServiceRows<StoredMatch[]>(
    `/rest/v1/job_matches?select=*&user_id=eq.${fixture.userId}&career_profile_id=eq.${fixture.careerProfileId}&job_id=eq.${jobId}`,
  );
  return rows[0] ?? null;
}

/** Every stored match for one profile, which is what makes a ranked feed possible. */
export async function storedMatches(fixture: AnalysisFixture): Promise<StoredMatch[]> {
  return getServiceRows<StoredMatch[]>(
    `/rest/v1/job_matches?select=*&user_id=eq.${fixture.userId}&career_profile_id=eq.${fixture.careerProfileId}&order=score.desc`,
  );
}

/**
 * Removes one fixture account's stored results.
 *
 * A spec that asserts "unanalysed, and then analysed" has to start from the
 * state before the transition. Only this fixture account's own rows are
 * removed, and it is the worker — never the spec — that writes them back, so the
 * claim being tested is untouched; what this buys is a spec that can be re-run
 * against an already-running stack instead of one that only passes on a freshly
 * reset database.
 */
export async function clearStoredMatches(fixture: AnalysisFixture): Promise<void> {
  await serviceRequest(
    `/rest/v1/job_matches?user_id=eq.${fixture.userId}&career_profile_id=eq.${fixture.careerProfileId}`,
    { method: 'DELETE' },
  );
}

/**
 * Waits until the worker's own write is visible for one opportunity.
 *
 * The condition is the stored row itself, so the spec can tell "the worker
 * scored it" from "the browser is serving a cached page". The profile version
 * recorded on the row is checked here too: a result computed against a different
 * version of the profile is not the result these assertions describe.
 */
export async function waitForStoredMatch(
  fixture: AnalysisFixture,
  jobId: string,
): Promise<StoredMatch> {
  return pollUntil({
    description: `a stored match for opportunity ${jobId} and career profile ${fixture.careerProfileId} (the worker's write to job_matches)`,
    read: async () => {
      const match = await storedMatch(fixture, jobId);
      return match !== null && match.profile_version === fixture.profileVersion ? match : null;
    },
    timeoutMs: 60_000,
  });
}

/**
 * Makes one fixture account's radar analysed, through the real worker.
 *
 * `radar.spec.ts` asserts what a member sees once their opportunities have been
 * scored. That state has to be produced, not assumed: this runs the same
 * one-shot worker the matching spec runs and then waits on the stored rows, so
 * the spec's assertion holds whatever order the suite's files run in.
 */
export async function ensureAnalysedRadar(account: {
  email: string;
  password: string;
}): Promise<AnalysisFixture> {
  const fixture = await ensureAnalysisFixture(account);
  await runJobWorkerCycle();
  await pollUntil({
    description: `at least one stored match for career profile ${fixture.careerProfileId} (the worker's write to job_matches)`,
    read: async () => {
      const matches = await storedMatches(fixture);
      return matches.length > 0 ? matches : null;
    },
    timeoutMs: 60_000,
  });
  return fixture;
}
