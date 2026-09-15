import { testAccounts } from './accounts.js';
import {
  analysedOpportunityTitle,
  clearStoredMatches,
  ensureAnalysisFixture,
  storedMatch,
  waitForStoredMatch,
  type AnalysisFixture,
  type StoredMatch,
} from './analysis-fixture.js';
import { readLocalSupabaseEnvironment } from './local-supabase.js';
import { expect, signIn, test } from './product.js';
import { getServiceRows } from './test-data.js';
import { runJobWorkerCycle } from './worker-cycle.js';

/**
 * The whole Hanaply loop, end to end: understand, discover, match, explain.
 *
 * Before this file existed the pieces were tested separately and the join
 * between them was not. The Dockerless stack seeded normalized postings and
 * served them through the API, `packages/matching` was unit tested, and the
 * database-level radar test stored a match by hand — but nothing ran the
 * matching worker, so nothing ever produced a match in an end-to-end run.
 * `radar.spec.ts` asserted the honest consequence: every opportunity was
 * unanalysed.
 *
 * What is proved here, in order, and nowhere else:
 *
 *   1. A seeded posting is a normalized row in the database, readable through
 *      the product API — title, employer, employment type, work setup, location,
 *      salary, skills, provenance, freshness — and not yet analysed, while the
 *      database's own work queue already reports the fixture profile as due.
 *   2. The deterministic engine's result is persisted for that opportunity:
 *      score, verdict, confidence, model version, every dimension with its
 *      weight and contribution, the strengths and gaps, the requirement
 *      mapping, the confirmed evidence it may cite, and the profile version and
 *      posting revision it scored. These are read from `public.job_matches`, not
 *      from a later rendering of it.
 *   3. The worker that produced them was started through its real entry point —
 *      the same `services/worker/dist/main.js` a deployment runs, in
 *      `WORKER_MODE=once` — so the ingestion, match computation, freshness, and
 *      notification cycles all ran through `JobIntelligenceWorker.runOnce`, the
 *      orchestration that decides what is due. Nothing here calls `scoreMatch`,
 *      `record_job_matches`, or a repository directly: that code path was
 *      already covered, and this one is the code path that was not.
 *   4. `job_radar` ranks the opportunity and returns it with that score and
 *      verdict — top of the default feed, and the only result under a
 *      minimum-score filter — through the API the browser calls.
 *   5. The browser renders the analysed opportunity: the stored score and
 *      verdict, "Why this fits", "Where you fall short", the match breakdown,
 *      the requirements mapping with a met and an unmet requirement, the
 *      recommended next step, and none of the unanalysed state.
 *   6. Running the worker again is a no-op rather than a second analysis, and
 *      the queue becomes due again only when the stored result is stale.
 *
 * No paid key and no network are involved: matching is deterministic arithmetic
 * over rows the seed already wrote, and the one external provider the worker can
 * reach — email — is the stack's capture provider.
 *
 * One defect this file records rather than fixes: `public.jobs.updated_at` is
 * not a content revision. `public.refresh_job_freshness`
 * (`supabase/migrations/20260915090000_job_ingestion_foundation.sql:1187-1189`)
 * stamps `freshness_checked_at` on every job on every pass, and the generic
 * `jobs_set_updated_at` trigger (same file, lines 1226-1228) turns that
 * bookkeeping write into a new `updated_at`. `matching_job_candidates` compares
 * that column against the revision stored on a result
 * (`20260917090000_match_computation_support.sql:178`), so a stored
 * `job_updated_at` never equals the posting's current one, and the documented
 * "already-scored jobs are only revisited when the profile or the posting
 * changed" is wider than it reads: the worker's own maintenance cycle re-opens
 * every posting on the next due pass. The behaviour is real but changing it is a
 * design decision about what a job's content revision means, so the spec asserts
 * the part that is guaranteed — the recorded revision is a real timestamp from
 * this run and never ahead of the posting's current revision — instead of an
 * equality that the schema cannot honour.
 */
test.describe.configure({ mode: 'serial' });

/** The API under test listens on the port the Playwright configuration gives it. */
const apiUrl = 'http://127.0.0.1:3101';
const environment = readLocalSupabaseEnvironment();

/**
 * The score the deterministic engine must produce for the fixture profile
 * against the seeded "Workflow Automation Engineer" posting.
 *
 * Every dimension has evidence, so the score is the weighted sum of them: role
 * 100 (the title is a stated target role), skills 83 (five of the six terms the
 * posting and the profile name together are on the profile), seniority 100 (both
 * mid), experience 100 (3.5 years against a 3-year minimum), location 100
 * (remote, Philippines), compensation 100 (the advertised floor is above the
 * stated minimum), employment type 100, career direction 45 (the posting does
 * not mention the profile's industry), and freshness 90 (posted a day before the
 * seed ran). Pinning it is the point: the same inputs must produce the same
 * number on every machine and every run, and a change to the engine that moves it
 * should fail here loudly.
 */
const expectedScore = 94;
const expectedVerdict = 'strong_match';
const expectedConfidence = 'high';

interface ApiDimension {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly score: number | null;
  readonly contribution: number;
  readonly detail: string;
}

interface ApiRequirementMapping {
  readonly requirement: string;
  readonly status: string;
  readonly matchedSkills: readonly string[];
  readonly evidence: string | null;
}

interface ApiMatchSummary {
  readonly jobId: string;
  readonly score: number;
  readonly verdict: string;
  readonly confidence: string;
  readonly modelVersion: string;
  readonly recommendedAction: string;
  readonly strengths: readonly unknown[];
  readonly gaps: readonly unknown[];
  readonly blockers: readonly unknown[];
  readonly computedAt: string;
}

interface ApiMatchDetail extends ApiMatchSummary {
  readonly dimensions: readonly ApiDimension[];
  readonly rejectionRisks: readonly unknown[];
  readonly requirementMapping: readonly ApiRequirementMapping[];
  readonly evidenceFactIds: readonly string[];
  readonly dataQuality: Readonly<Record<string, unknown>>;
}

interface ApiRadarItem {
  readonly id: string;
  readonly title: string;
  readonly companyName: string;
  readonly employmentType: string;
  readonly seniority: string;
  readonly remoteState: string;
  readonly countryCode: string | null;
  readonly isPhilippines: boolean;
  readonly isInternational: boolean;
  readonly salaryMinMinor: number | null;
  readonly salaryMaxMinor: number | null;
  readonly salaryCurrency: string | null;
  readonly skills: readonly string[];
  readonly postedAt: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly sourceCount: number;
  readonly status: string;
  readonly excerpt: string;
  readonly savedAt: string | null;
  readonly match: ApiMatchSummary | null;
}

interface ApiRadarFeed {
  readonly items: readonly ApiRadarItem[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
  readonly careerProfileId: string | null;
  readonly evaluatedAt: string;
}

interface ApiJobDetail extends Omit<ApiRadarItem, 'match'> {
  readonly description: string;
  readonly requirements: readonly string[];
  readonly preferredQualifications: readonly string[];
  readonly applyUrl: string;
  readonly match: ApiMatchDetail | null;
  readonly sources: readonly { readonly sourceCode: string; readonly displayName: string }[];
}

let fixture: AnalysisFixture;
let accessToken: string;
let opportunity: ApiRadarItem;
let stored: StoredMatch;

/**
 * A real member session, so the API assertions exercise the API's own
 * authentication and read path rather than the service-role back door.
 */
async function memberAccessToken(account: { email: string; password: string }): Promise<string> {
  const response = await fetch(`${environment.apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: environment.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error(`The ${account.email} fixture account could not sign in`);
  }
  return body.access_token;
}

async function apiGet<TData>(path: string): Promise<TData> {
  const response = await fetch(new URL(path, apiUrl), {
    headers: {
      apikey: environment.publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = (await response.json()) as { data?: TData; error?: { message?: string } };
  if (!response.ok || body.data === undefined) {
    throw new Error(
      `The API request for ${path} failed (HTTP ${response.status}): ${body.error?.message ?? 'no data envelope'}`,
    );
  }
  return body.data;
}

async function serviceRpc<TData>(name: string, body: unknown): Promise<TData> {
  const response = await fetch(new URL(`/rest/v1/rpc/${name}`, environment.apiUrl), {
    method: 'POST',
    headers: {
      apikey: environment.serviceRoleKey,
      Authorization: `Bearer ${environment.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`The ${name} call failed (HTTP ${response.status})`);
  }
  return (await response.json()) as TData;
}

/** The profiles the database itself says have matching work waiting. */
async function dueMatchingSubjects(): Promise<readonly string[]> {
  const subjects = await serviceRpc<{ career_profile_id: string }[]>('matching_subjects', {
    batch_size: 200,
    stale_after_hours: 12,
  });
  return subjects.map((subject) => subject.career_profile_id);
}

test.beforeAll(async () => {
  fixture = await ensureAnalysisFixture(testAccounts.matching);
  /*
   * The spec asserts a transition — unanalysed, then analysed — so it starts
   * from the state before it. Only this fixture account's own stored results are
   * removed, and the worker, not the spec, puts them back; the assertion that
   * matters ("job_matches was empty, and then the worker wrote this row") is
   * unchanged, and the spec can be re-run against a stack that is already
   * running without depending on a database reset.
   */
  await clearStoredMatches(fixture);
  accessToken = await memberAccessToken(testAccounts.matching);
});

test('the seeded opportunity is normalized and unanalysed, and its matching work is due', async () => {
  test.setTimeout(60_000);
  const feed = await apiGet<ApiRadarFeed>(
    `/v1/me/jobs?search=${encodeURIComponent(analysedOpportunityTitle)}`,
  );
  const item = feed.items.find((candidate) => candidate.title === analysedOpportunityTitle);
  expect(
    item,
    `the API did not return the seeded "${analysedOpportunityTitle}" posting, so the row the worker scores does not exist`,
  ).toBeDefined();
  if (!item) return;
  opportunity = item;

  // Normalization: the posting the seed wrote through `upsert_ingested_job` is a
  // row with parsed structure and provenance, not a stored payload.
  expect(item.companyName).toContain('Northstar');
  expect(item.employmentType).toBe('full_time');
  expect(item.seniority).toBe('mid');
  expect(item.remoteState).toBe('remote');
  expect(item.countryCode).toBe('PH');
  expect(item.isPhilippines).toBe(true);
  expect(item.isInternational).toBe(false);
  expect(item.salaryMinMinor).toBe(9_000_000);
  expect(item.salaryMaxMinor).toBe(12_000_000);
  expect(item.salaryCurrency).toBe('PHP');
  expect(item.skills).toEqual(expect.arrayContaining(['n8n', 'TypeScript', 'Supabase']));
  expect(item.postedAt).not.toBeNull();
  expect(item.firstSeenAt).not.toBeNull();
  expect(item.lastSeenAt).not.toBeNull();
  expect(item.sourceCount).toBe(1);
  expect(item.status).toBe('active');
  expect(item.excerpt.length).toBeGreaterThan(20);

  // Not yet analysed: the feed reports no stored result, and there is no row.
  expect(item.match).toBeNull();
  expect(await storedMatch(fixture, item.id)).toBeNull();

  // The work the worker is about to do is due, which is the database's own
  // decision (`matching_subjects`) rather than an assumption made here.
  expect(await dueMatchingSubjects()).toContain(fixture.careerProfileId);
});

test('the matching worker runs its cycles once and the deterministic result is persisted', async () => {
  test.setTimeout(180_000);
  const run = await runJobWorkerCycle();

  // The worker's own account of the run: all four cycles ran, none reported an
  // error, and the matching cycle scored a profile rather than finding nothing
  // due. This is the orchestration talking, not this spec.
  expect(
    run.state.lastErrorCode,
    `the worker reported ${String(run.state.lastErrorCode)}\n${run.stdout}${run.stderr}`,
  ).toBeNull();
  expect(run.state.lastIngestionAt).not.toBeNull();
  expect(run.state.lastMatchingAt).not.toBeNull();
  expect(run.state.lastFreshnessAt).not.toBeNull();
  expect(run.state.lastNotificationAt).not.toBeNull();
  expect(
    run.state.profilesScored,
    `the matching cycle scored no profile, so the queue it saw was empty or every subject it took failed.\n--- worker output ---\n${run.stdout}${run.stderr}`,
  ).toBeGreaterThanOrEqual(1);

  stored = await waitForStoredMatch(fixture, opportunity.id);

  // The stored row, not a rendering of it.
  expect(
    stored.score,
    'the deterministic score moved. If this run reused a stack whose seed is more than three days old, the freshness dimension — and only it — will have aged; re-seed with "pnpm e2e" before treating this as an engine regression.',
  ).toBe(expectedScore);
  expect(stored.verdict).toBe(expectedVerdict);
  expect(stored.confidence).toBe(expectedConfidence);
  expect(stored.model_version).toBe('matching-v1');
  expect(stored.recommended_action.length).toBeGreaterThan(20);

  const dimensions = stored.dimensions;
  expect(dimensions).toHaveLength(9);
  expect(dimensions.map((dimension) => dimension.key)).toEqual([
    'roleAlignment',
    'skillsCoverage',
    'seniorityAlignment',
    'experienceAlignment',
    'locationAlignment',
    'compensationAlignment',
    'employmentTypeAlignment',
    'careerDirection',
    'recency',
  ]);
  expect(dimensions.reduce((total, dimension) => total + dimension.weight, 0)).toBe(100);
  // Every dimension had evidence, so nothing was neutralised and the
  // contributions are the score rather than an approximation of it.
  expect(dimensions.every((dimension) => dimension.score !== null)).toBe(true);
  expect(dimensions.reduce((total, dimension) => total + dimension.contribution, 0)).toBe(
    stored.score,
  );
  const skillsDimension = dimensions.find((dimension) => dimension.key === 'skillsCoverage');
  expect(skillsDimension?.score).toBe(83);
  expect(skillsDimension?.detail).toContain('5 of the 6 skills');

  const strengths = stored.strengths.map(String);
  expect(strengths.join(' ')).toContain('n8n');
  expect(strengths.join(' ')).toContain('TypeScript');
  const gaps = stored.gaps.map(String);
  expect(gaps.join(' ')).toContain('Supabase');
  expect(stored.blockers).toHaveLength(0);

  expect(stored.requirement_mapping).toHaveLength(5);
  const met = stored.requirement_mapping.filter((entry) => entry.status === 'met');
  const unmet = stored.requirement_mapping.filter((entry) => entry.status === 'unmet');
  expect(met).toHaveLength(1);
  expect(met[0]?.requirement).toContain('n8n and TypeScript');
  expect(met[0]?.matchedSkills).toEqual(expect.arrayContaining(['n8n', 'TypeScript']));
  expect(unmet).toHaveLength(1);
  expect(unmet[0]?.requirement).toContain('Supabase');
  expect(unmet[0]?.matchedSkills).toEqual([]);
  // A requirement the posting lists but nothing on the profile names is left
  // unknown rather than scored as a failure.
  expect(stored.requirement_mapping.filter((entry) => entry.status === 'unknown')).toHaveLength(3);

  expect(stored.evidence_fact_ids).toHaveLength(3);
  expect(stored.data_quality.profileCompleteness).toBe('solid');
  expect(stored.data_quality.jobDetail).toBe('detailed');
  expect(stored.data_quality.unknowns).toEqual([]);

  // The row records the inputs it was computed from, so a stale result is
  // detectable rather than indistinguishable from a fresh one.
  expect(stored.profile_version).toBe(fixture.profileVersion);
  const jobs = await getServiceRows<{ updated_at: string }[]>(
    `/rest/v1/jobs?select=updated_at&id=eq.${opportunity.id}`,
  );
  /*
   * The stored revision is bounded rather than equated with the posting's
   * current `updated_at`.
   *
   * It cannot be an equality: the freshness cycle runs after matching in the
   * same pass, it stamps `freshness_checked_at` on every job, and the generic
   * `set_updated_at` trigger on `public.jobs` treats that bookkeeping write as a
   * change to the posting. So the revision the match was scored against is
   * always at or before the current one, and never anything this spec invented.
   */
  const scoredAgainst = Date.parse(stored.job_updated_at);
  expect(Number.isNaN(scoredAgainst)).toBe(false);
  expect(scoredAgainst).toBeGreaterThanOrEqual(Date.parse(opportunity.firstSeenAt));
  expect(scoredAgainst).toBeLessThanOrEqual(Date.parse(jobs[0]?.updated_at ?? ''));
  expect(Number.isNaN(Date.parse(stored.computed_at))).toBe(false);
  expect(Date.parse(stored.computed_at)).toBeLessThanOrEqual(Date.now());
});

test('the ranked radar returns the analysed opportunity through the API', async () => {
  test.setTimeout(60_000);
  const feed = await apiGet<ApiRadarFeed>('/v1/me/jobs');

  // Ranking reads the stored rows: a scored opportunity sorts above every
  // unscored one, and the highest score comes first.
  const ranked = feed.items[0];
  expect(ranked?.id).toBe(opportunity.id);
  expect(feed.careerProfileId).toBe(fixture.careerProfileId);
  expect(ranked?.match?.score).toBe(stored.score);
  expect(ranked?.match?.verdict).toBe(stored.verdict);
  expect(ranked?.match?.confidence).toBe(stored.confidence);
  expect(ranked?.match?.modelVersion).toBe(stored.model_version);
  // The same instant, not the same rendering: the API forwards PostgreSQL's own
  // timestamptz text (microseconds, local offset) while the stored row is read
  // through PostgREST, so the strings differ even when the moment does not.
  expect(Date.parse(ranked?.match?.computedAt ?? '')).toBe(Date.parse(stored.computed_at));
  expect((ranked?.match?.strengths ?? []).length).toBeGreaterThan(0);

  // The same cycle analysed every seeded posting, which is what makes the
  // radar's "not analysed yet" count zero rather than merely small.
  expect(feed.items).toHaveLength(5);
  expect(feed.items.every((item) => item.match !== null)).toBe(true);

  // Server-side filtering on the stored score, not on a rendered list.
  const strong = await apiGet<ApiRadarFeed>(`/v1/me/jobs?minScore=${expectedScore}`);
  expect(strong.items.map((item) => item.id)).toEqual([opportunity.id]);

  const detail = await apiGet<ApiJobDetail>(`/v1/me/jobs/${opportunity.id}`);
  expect(detail.match?.score).toBe(stored.score);
  expect(detail.match?.dimensions).toHaveLength(9);
  expect(detail.match?.requirementMapping).toHaveLength(5);
  expect(detail.match?.evidenceFactIds).toHaveLength(3);
  expect(detail.match?.rejectionRisks).toHaveLength(1);
  expect(detail.sources.length).toBeGreaterThan(0);
});

test('the browser renders the analysed opportunity with its explanation', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.matching);

  // The count strip is three separate API counts. With every seeded posting
  // scored, the unanalysed count is a real zero rather than a placeholder.
  await page.goto('/dashboard/radar');
  await expect(page.getByRole('heading', { name: 'Job radar', level: 1 })).toBeVisible();
  const stats = page.locator('.radar-stat-strip');
  await expect(stats.getByText('Opportunities', { exact: true })).toBeVisible();
  await expect(stats.locator('strong').first()).toHaveText('5');
  await expect(stats.locator('strong').nth(1)).toHaveText('1');
  await expect(stats.locator('strong').nth(2)).toHaveText('0');

  const card = page.locator('.radar-card', {
    has: page.getByRole('link', { name: analysedOpportunityTitle, exact: true }),
  });
  await expect(card).toBeVisible();
  await expect(card.locator('.radar-card-verdict .h-badge')).toHaveText(
    `Strong match · ${String(stored.score)}/100`,
  );
  await expect(card.locator('.radar-confidence')).toHaveText('High confidence');
  await expect(card.getByText('Recommended action')).toBeVisible();
  await expect(card.getByText(stored.recommended_action)).toBeVisible();

  // The opportunity detail: the stored explanation, rendered.
  await card.getByRole('link', { name: analysedOpportunityTitle, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/radar\/[0-9a-f-]{36}$/u);

  const header = page.locator('.radar-detail-verdict');
  await expect(header.locator('.h-badge')).toHaveText(`Strong match · ${String(stored.score)}/100`);
  await expect(header).toContainText('High confidence');

  // The unanalysed state is gone, not merely outnumbered.
  await expect(
    page.getByRole('heading', { name: 'This opportunity has not been analysed yet' }),
  ).toHaveCount(0);
  await expect(page.getByText('No score exists for this opportunity yet.')).toHaveCount(0);

  const whyThisFits = page.locator('.radar-section-card', {
    has: page.getByRole('heading', { name: 'Why this fits' }),
  });
  await expect(whyThisFits).toBeVisible();
  await expect(whyThisFits.locator('.radar-reason-list--positive li')).toHaveCount(
    stored.strengths.length,
  );
  await expect(whyThisFits).toContainText('n8n');
  await expect(whyThisFits).toContainText('The title lines up with a target role.');

  const shortfalls = page.locator('.radar-section-card', {
    has: page.getByRole('heading', { name: 'Where you fall short' }),
  });
  await expect(shortfalls).toBeVisible();
  await expect(shortfalls.locator('.radar-reason-list--gap li')).toHaveCount(stored.gaps.length);
  await expect(shortfalls).toContainText('Supabase');

  const breakdown = page.locator('.radar-section-card', {
    has: page.getByRole('heading', { name: 'Match breakdown' }),
  });
  await expect(breakdown).toBeVisible();
  await expect(breakdown.locator('.radar-dimension-table tbody tr')).toHaveCount(9);
  await expect(breakdown).toContainText('Role alignment');
  await expect(breakdown).toContainText('Skills coverage');
  await expect(breakdown).toContainText('5 of the 6 skills');

  const mapping = page.locator('.radar-section-card', {
    has: page.getByRole('heading', { name: 'Requirements mapping' }),
  });
  await expect(mapping).toBeVisible();
  await expect(mapping.locator('.radar-requirement')).toHaveCount(5);
  await expect(mapping.getByText('Met', { exact: true })).toHaveCount(1);
  await expect(mapping.getByText('Not met yet', { exact: true })).toHaveCount(1);
  await expect(mapping).toContainText('Strong n8n and TypeScript experience');
  await expect(mapping).toContainText('Familiarity with Supabase');
  /*
   * The sentence and the skill list are compared against the stored row rather
   * than a literal: the engine lists matched skills in the order the posting's
   * own skill list is stored, which is normalized (and therefore sorted), so a
   * literal would assert the seed's ordering rather than the product's output.
   */
  const metRequirement = stored.requirement_mapping.find((entry) => entry.status === 'met');
  expect(
    metRequirement?.evidence,
    'the stored mapping records the evidence it matched',
  ).not.toBeNull();
  expect(metRequirement?.matchedSkills.length ?? 0).toBeGreaterThan(0);
  await expect(mapping).toContainText(metRequirement?.evidence ?? '');
  for (const skill of metRequirement?.matchedSkills ?? []) {
    await expect(mapping).toContainText(skill);
  }

  // Confidence is explained by the evidence behind it, and the next step is the
  // sentence the engine stored.
  await expect(page.getByRole('heading', { name: 'Data quality' })).toBeVisible();
  await expect(page.getByText('The stored confidence on this opportunity is high')).toBeVisible();
  const nextStep = page.locator('.radar-next-step');
  await expect(nextStep).toBeVisible();
  await expect(nextStep).toContainText(stored.recommended_action);

  // The untouched posting is still there, so the analysis sits beside the source
  // rather than replacing it.
  await expect(page.getByRole('heading', { name: 'Original posting' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apply on the original source' })).toHaveAttribute(
    'href',
    /localhost\.invalid/u,
  );
});

test('a repeated cycle recomputes nothing because the stored result is fresh', async () => {
  test.setTimeout(120_000);
  const before = stored;
  const run = await runJobWorkerCycle();
  expect(run.state.lastErrorCode).toBeNull();
  // The result is newer than the staleness window, so the work queue is empty
  // and the second cycle scores no profile at all.
  expect(run.state.profilesScored).toBe(0);

  const after = await storedMatch(fixture, opportunity.id);
  expect(after?.id).toBe(before.id);
  expect(after?.score).toBe(before.score);
  expect(after?.computed_at).toBe(before.computed_at);
});

test('the work queue is due again once the stored result is stale', async () => {
  test.setTimeout(60_000);
  /*
   * The queue is the database's decision, and this is the condition that makes a
   * profile due again: a result older than `stale_after_hours`. The clock is
   * moved rather than waited on, because a spec that slept twelve hours would
   * not be a gate. The row is put back before the test ends, so nothing
   * downstream sees a result it did not expect.
   */
  expect(await dueMatchingSubjects()).not.toContain(fixture.careerProfileId);

  const staleComputedAt = new Date(Date.now() - 72 * 3_600_000).toISOString();
  await patchStoredMatches(fixture, staleComputedAt);
  expect(await dueMatchingSubjects()).toContain(fixture.careerProfileId);

  await patchStoredMatches(fixture, new Date(stored.computed_at).toISOString());
  expect(await dueMatchingSubjects()).not.toContain(fixture.careerProfileId);
});

async function patchStoredMatches(target: AnalysisFixture, computedAt: string): Promise<void> {
  const response = await fetch(
    new URL(
      `/rest/v1/job_matches?user_id=eq.${target.userId}&career_profile_id=eq.${target.careerProfileId}`,
      environment.apiUrl,
    ),
    {
      method: 'PATCH',
      headers: {
        apikey: environment.serviceRoleKey,
        Authorization: `Bearer ${environment.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ computed_at: computedAt }),
    },
  );
  if (!response.ok) {
    throw new Error(`The stored match could not be aged (HTTP ${response.status})`);
  }
}
