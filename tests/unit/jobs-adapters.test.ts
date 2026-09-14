import {
  MissingCredentialError,
  JobSourceRequestError,
  adzunaAdapter,
  arbeitnowAdapter,
  ashbyAdapter,
  buildJobInput,
  classifyDedupe,
  dedupeSignals,
  deriveSeniorityFromExperience,
  detectEmploymentType,
  detectRemoteState,
  detectSeniority,
  extractSkills,
  getJobSourceAdapter,
  greenhouseAdapter,
  hnAlgoliaAdapter,
  jobSourceAdapters,
  joobleAdapter,
  leverAdapter,
  normalizeCompanyName,
  normalizeTitle,
  parseLocation,
  parseSalary,
  payloadChecksum,
  remotiveAdapter,
  runSourceIngestion,
  similarity,
  splitRequirementBullets,
  stableFingerprint,
  stripHtml,
  workableAdapter,
  type AdapterContext,
  type IngestionSink,
  type JobSourceAdapter,
  type NormalizedJobInput,
  type RawPosting,
} from '@hanaply/jobs';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Harness: an injected fetch, so no test in this file touches the network.
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchStub {
  readonly calls: FetchCall[];
  readonly fetch: typeof fetch;
}

function createFetchStub(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): FetchStub {
  const calls: FetchCall[] = [];
  const implementation = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { calls, fetch: implementation };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

function parseJsonBody(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  return JSON.parse(value) as unknown;
}

function createContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    fetch: overrides.fetch ?? createFetchStub(() => jsonResponse({})).fetch,
    credentials: overrides.credentials ?? {},
    limit: overrides.limit ?? 10,
    now: overrides.now ?? new Date('2026-03-02T00:00:00.000Z'),
    userAgent: overrides.userAgent ?? 'HanaplyBot/1.0 (+https://hanaply.test/bot)',
    timeoutMs: overrides.timeoutMs ?? 5_000,
    config: overrides.config ?? {},
  };
}

function expectCanonicalShape(input: NormalizedJobInput): void {
  expect(input.contentFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  expect(input.payloadChecksum).toMatch(/^[a-f0-9]{64}$/u);
  expect(input.sourceUrl).toMatch(/^https?:\/\//u);
  expect(input.title.length).toBeGreaterThanOrEqual(2);
  expect(input.title.length).toBeLessThanOrEqual(300);
  expect(input.companyName.length).toBeGreaterThanOrEqual(1);
  expect(input.companyName.length).toBeLessThanOrEqual(200);
  expect(input.description.length).toBeGreaterThanOrEqual(20);
  expect(input.description.length).toBeLessThanOrEqual(40_000);
  expect(input.language).toBe('en');
  expect(input.requirements.length).toBeLessThanOrEqual(30);
  expect(input.preferredQualifications.length).toBeLessThanOrEqual(20);
  expect(typeof input.rawPayload).toBe('object');
}

function firstPosting(postings: readonly RawPosting[], index: number): RawPosting {
  const posting = postings[index];
  if (posting === undefined) throw new Error(`expected a posting at index ${String(index)}`);
  return posting;
}

function repeat<T>(item: T, count: number): T[] {
  return Array.from({ length: count }, () => item);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REMOTIVE_JOB = {
  id: 1234567,
  url: 'https://remotive.com/remote-jobs/engineering/senior-automation-engineer-1234567',
  title: 'Senior Automation Engineer',
  company_name: 'Northstar Systems, Inc.',
  company_logo: 'https://remotive.com/company/logo.png',
  category: 'Engineering',
  job_type: 'full_time',
  publication_date: '2026-02-20T09:30:00Z',
  candidate_required_location: 'Makati, Metro Manila, Philippines',
  salary: '₱80,000 - ₱110,000 per month',
  description:
    '<p>We are hiring a <strong>Senior Automation Engineer</strong> to own our n8n workflows.</p>' +
    '<ul><li>5+ years of automation experience with TypeScript</li>' +
    '<li>Hands-on PostgreSQL and Docker</li></ul>' +
    '<h3>Nice to have</h3><ul><li>Experience with Kubernetes</li></ul>',
};

const ARBEITNOW_JOB = {
  slug: 'senior-data-analyst-cebu-123',
  company_name: 'Meridian Support Philippines Inc',
  title: 'Senior Data Analyst',
  description:
    '<p>Own the reporting stack for our operations team.</p>' +
    '<ul><li>Advanced SQL and Power BI</li></ul>' +
    '<h4>Preferred</h4><ul><li>dbt experience</li></ul>',
  remote: false,
  url: 'https://www.arbeitnow.com/view/senior-data-analyst-cebu-123',
  tags: ['sql', 'power bi'],
  job_types: ['full_time'],
  location: 'Cebu City, Central Visayas, Philippines',
  created_at: 1_771_234_567,
};

const HN_HIT = {
  objectID: '39876543',
  comment_text:
    'Northstar Systems | Senior Automation Engineer | Remote (Worldwide) | ₱180,000<br><br>' +
    'We build automation for logistics teams. Stack: TypeScript, n8n, PostgreSQL.' +
    '<p>Meridian Support | Data Analyst | Cebu City, Philippines | Hybrid' +
    '<p>Anyone else interviewing right now?',
  story_id: 34_567_890,
  author: 'whoishiring',
  created_at: '2026-03-01T12:00:00Z',
};

const GREENHOUSE_RESPONSE = {
  name: 'Northstar Systems',
  jobs: [
    {
      id: 4_567_890,
      title: 'Senior Automation Engineer (Remote)',
      absolute_url:
        'https://boards.greenhouse.io/northstar/jobs/4567890?utm_source=hanaply&utm_medium=feed',
      updated_at: '2026-02-25T08:00:00-05:00',
      location: { name: 'Manila, Philippines' },
      content:
        '&lt;p&gt;Own the &lt;strong&gt;n8n&lt;/strong&gt; automation platform.&lt;/p&gt;' +
        '&lt;ul&gt;&lt;li&gt;5+ years with TypeScript&lt;/li&gt;&lt;li&gt;PostgreSQL and Docker&lt;/li&gt;&lt;/ul&gt;' +
        '&lt;h3&gt;Nice to have&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Kubernetes&lt;/li&gt;&lt;/ul&gt;',
    },
    {
      id: 4_567_891,
      title: 'Data Analyst',
      absolute_url: 'https://boards.greenhouse.io/northstar/jobs/4567891',
      location: { name: 'Cebu City, Philippines' },
      content: '&lt;p&gt;Reporting and dashboards for the operations team.&lt;/p&gt;',
    },
  ],
};

const LEVER_RESPONSE = [
  {
    id: 'lever-abc-123',
    text: 'Automation Engineer',
    descriptionPlain: 'Build automation for logistics teams. Stack: TypeScript and PostgreSQL.',
    description:
      '<div>Build automation for logistics teams. Stack: TypeScript and PostgreSQL.</div>',
    lists: [
      {
        text: 'Requirements',
        content: '<ul><li>3-5 years of automation experience</li><li>Docker</li></ul>',
      },
    ],
    createdAt: 1_772_000_000_000,
    workplaceType: 'hybrid',
    categories: {
      location: 'Cebu City, Philippines',
      commitment: 'Full-time',
      team: 'Platform',
    },
    hostedUrl: 'https://jobs.lever.co/globex/lever-abc-123',
    applyUrl: 'https://jobs.lever.co/globex/lever-abc-123/apply',
  },
];

const ASHBY_RESPONSE = {
  apiVersion: '1',
  jobs: [
    {
      id: 'ashby-1',
      title: 'Platform Engineer',
      location: 'Manila, Philippines',
      employmentType: 'Contract',
      isRemote: true,
      descriptionPlain: 'Run the platform that our automation products depend on.',
      descriptionHtml: '<p>Run the platform that our automation products depend on.</p>',
      publishedAt: '2026-02-27T00:00:00.000Z',
      jobUrl: 'https://jobs.ashbyhq.com/globex/ashby-1',
      applyUrl: 'https://jobs.ashbyhq.com/globex/ashby-1/apply',
      address: { postalAddress: { addressCountry: 'PH' } },
    },
  ],
};

const WORKABLE_RESPONSE = {
  name: 'Meridian Support Philippines Inc',
  jobs: [
    {
      id: 'workable-1',
      shortcode: 'ABC123',
      title: 'Support Specialist',
      employment_type: 'Part-time',
      telecommuting: true,
      location: {
        country: 'Philippines',
        country_code: 'PH',
        city: 'Cebu City',
        region: 'Central Visayas',
      },
      created_at: '2026-02-26',
      url: 'https://apply.workable.com/meridian/jobs/ABC123',
      application_url: 'https://apply.workable.com/meridian/jobs/ABC123/apply',
      description:
        '<p>Support our customers across time zones with clear written English.</p>' +
        '<ul><li>Excellent written English</li></ul>',
      requirements: '<ul><li>2+ years in customer support</li></ul>',
    },
  ],
};

const ADZUNA_RESPONSE = {
  count: 1,
  results: [
    {
      id: 42,
      title: 'Automation Engineer',
      description: 'Design and run automation for logistics teams across the region.',
      redirect_url: 'https://www.adzuna.com/land/ad/42',
      created: '2026-02-24T00:00:00Z',
      contract_time: 'full_time',
      contract_type: 'permanent',
      salary_min: 600_000,
      salary_max: 900_000,
      company: { display_name: 'Northstar Systems' },
      location: { display_name: 'Makati, Philippines', area: ['Philippines', 'Makati'] },
      category: { label: 'Engineering', tag: 'engineering-jobs' },
    },
  ],
};

const JOOBLE_RESPONSE = {
  totalCount: 1,
  jobs: [
    {
      id: 'jooble-1',
      title: 'Automation Engineer',
      company: 'Northstar Systems',
      location: 'Makati, Philippines',
      snippet: 'Automation work with TypeScript and PostgreSQL at scale for logistics teams.',
      salary: 'PHP 45,000/month',
      type: 'full_time',
      link: 'https://jooble.org/desc/jooble-1',
      updated: '2026-02-28T00:00:00Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Credential-free adapters
// ---------------------------------------------------------------------------

describe('remotive adapter', () => {
  it('maps a posting into the canonical shape', async () => {
    const stub = createFetchStub(() => jsonResponse({ jobs: [REMOTIVE_JOB] }));
    const context = createContext({ fetch: stub.fetch, limit: 5 });

    const postings = await remotiveAdapter.fetchPostings(context);
    expect(postings).toHaveLength(1);
    expect(stub.calls[0]?.url).toBe('https://remotive.com/api/remote-jobs?limit=5');
    expect(stub.calls[0]?.init?.headers).toMatchObject({ 'user-agent': context.userAgent });

    const input = remotiveAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;

    expectCanonicalShape(input);
    expect(input.title).toBe('Senior Automation Engineer');
    expect(input.companyName).toBe('Northstar Systems, Inc.');
    expect(input.description).not.toContain('<');
    expect(input.description).toContain('own our n8n workflows.');
    expect(input.employmentType).toBe('full_time');
    expect(input.seniority).toBe('senior');
    expect(input.remoteState).toBe('remote');
    expect(input.locationRaw).toBe('Makati, Metro Manila, Philippines');
    expect(input.city).toBe('Makati');
    expect(input.region).toBe('Metro Manila');
    expect(input.countryCode).toBe('PH');
    expect(input.isInternational).toBe(false);
    expect(input.salaryMinMinor).toBe(8_000_000);
    expect(input.salaryMaxMinor).toBe(11_000_000);
    expect(input.salaryCurrency).toBe('PHP');
    expect(input.salaryPeriod).toBe('monthly');
    expect(input.salaryIsEstimate).toBe(true);
    expect(input.requirements).toEqual([
      '5+ years of automation experience with TypeScript',
      'Hands-on PostgreSQL and Docker',
    ]);
    expect(input.preferredQualifications).toEqual(['Experience with Kubernetes']);
    expect(input.skills).toEqual(['n8n', 'TypeScript', 'PostgreSQL', 'Docker', 'Kubernetes']);
    expect(input.experienceYearsMin).toBe(5);
    expect(input.experienceYearsMax).toBeNull();
    expect(input.postedAt).toBe('2026-02-20T09:30:00.000Z');
    // The provider's free-text salary always survives in the raw payload.
    expect(input.rawPayload).toMatchObject({ salary: '₱80,000 - ₱110,000 per month' });
  });

  it('refuses postings it cannot represent truthfully', () => {
    const context = createContext();
    const base = { sourceJobId: '1', sourceUrl: REMOTIVE_JOB.url, payload: REMOTIVE_JOB };

    expect(
      remotiveAdapter.normalize({ ...base, payload: { ...REMOTIVE_JOB, title: null } }, context),
    ).toBeNull();
    expect(
      remotiveAdapter.normalize(
        { ...base, payload: { ...REMOTIVE_JOB, company_name: null } },
        context,
      ),
    ).toBeNull();
    expect(
      remotiveAdapter.normalize(
        { ...base, payload: { ...REMOTIVE_JOB, description: null } },
        context,
      ),
    ).toBeNull();
    expect(
      remotiveAdapter.normalize({ ...base, sourceUrl: 'ftp://remotive.com/jobs/1' }, context),
    ).toBeNull();
    expect(
      remotiveAdapter.normalize(
        { ...base, sourceUrl: 'javascript:alert(document.cookie)' },
        context,
      ),
    ).toBeNull();
  });

  it('never invents a salary or a location it was not given', () => {
    const context = createContext();
    const input = remotiveAdapter.normalize(
      {
        sourceJobId: '2',
        sourceUrl: 'https://remotive.com/remote-jobs/other/2',
        payload: {
          ...REMOTIVE_JOB,
          salary: 'Competitive',
          candidate_required_location: 'Anywhere',
        },
      },
      context,
    );
    expect(input).not.toBeNull();
    if (input === null) return;
    expect(input.salaryMinMinor).toBeNull();
    expect(input.salaryMaxMinor).toBeNull();
    expect(input.salaryCurrency).toBeNull();
    expect(input.salaryPeriod).toBeNull();
    expect(input.city).toBeNull();
    expect(input.region).toBeNull();
    expect(input.countryCode).toBeNull();
  });

  it('maps provider employment tokens, including "other"', () => {
    const context = createContext();
    const withType = (jobType: string): NormalizedJobInput | null =>
      remotiveAdapter.normalize(
        {
          sourceJobId: '3',
          sourceUrl: 'https://remotive.com/remote-jobs/other/3',
          payload: { ...REMOTIVE_JOB, job_type: jobType },
        },
        context,
      );
    expect(withType('contract')?.employmentType).toBe('contract');
    expect(withType('part_time')?.employmentType).toBe('part_time');
    expect(withType('internship')?.employmentType).toBe('internship');
    expect(withType('other')?.employmentType).toBe('full_time');
  });

  it('returns an empty batch when the response shape is unexpected', async () => {
    const stub = createFetchStub(() => jsonResponse({ jobs: 'not-an-array' }));
    const postings = await remotiveAdapter.fetchPostings(createContext({ fetch: stub.fetch }));
    expect(postings).toEqual([]);
  });
});

describe('arbeitnow adapter', () => {
  it('maps a posting into the canonical shape', async () => {
    const stub = createFetchStub(() => jsonResponse({ data: [ARBEITNOW_JOB] }));
    const context = createContext({ fetch: stub.fetch });
    const postings = await arbeitnowAdapter.fetchPostings(context);

    expect(postings).toHaveLength(1);
    expect(postings[0]?.sourceJobId).toBe('senior-data-analyst-cebu-123');

    const input = arbeitnowAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;

    expectCanonicalShape(input);
    expect(input.title).toBe('Senior Data Analyst');
    expect(input.companyName).toBe('Meridian Support Philippines Inc');
    expect(input.employmentType).toBe('full_time');
    expect(input.remoteState).toBe('unspecified');
    expect(input.city).toBe('Cebu City');
    expect(input.region).toBe('Central Visayas');
    expect(input.countryCode).toBe('PH');
    expect(input.postedAt).toBe('2026-02-16T09:36:07.000Z');
    expect(input.skills).toContain('SQL');
    expect(input.skills).toContain('Power BI');
    expect(input.skills).toContain('dbt');
    expect(input.requirements).toEqual(['Advanced SQL and Power BI']);
    expect(input.preferredQualifications).toEqual(['dbt experience']);
  });

  it('treats a false remote flag as unknown rather than on-site', async () => {
    const stub = createFetchStub(() =>
      jsonResponse({ data: [{ ...ARBEITNOW_JOB, remote: true }] }),
    );
    const context = createContext({ fetch: stub.fetch });
    const postings = await arbeitnowAdapter.fetchPostings(context);
    const input = arbeitnowAdapter.normalize(firstPosting(postings, 0), context);
    expect(input?.remoteState).toBe('remote');
  });

  it('returns an empty batch when the response shape is unexpected', async () => {
    const stub = createFetchStub(() => jsonResponse({ data: { jobs: [] } }));
    expect(await arbeitnowAdapter.fetchPostings(createContext({ fetch: stub.fetch }))).toEqual([]);
  });
});

describe('hn_algolia adapter', () => {
  it('splits a hiring comment into structured postings', async () => {
    const stub = createFetchStub(() => jsonResponse({ hits: [HN_HIT] }));
    const context = createContext({
      fetch: stub.fetch,
      config: { threadId: '34567890' },
      limit: 10,
    });

    const postings = await hnAlgoliaAdapter.fetchPostings(context);
    expect(postings).toHaveLength(2);
    expect(postings[0]?.sourceJobId).toBe('39876543#0');
    expect(postings[1]?.sourceJobId).toBe('39876543#1');
    expect(stub.calls[0]?.url).toContain('story_34567890');
    expect(stub.calls[0]?.url).toContain('hitsPerPage=');

    const first = hnAlgoliaAdapter.normalize(firstPosting(postings, 0), context);
    expect(first).not.toBeNull();
    if (first === null) return;
    expectCanonicalShape(first);
    expect(first.title).toBe('Senior Automation Engineer');
    expect(first.companyName).toBe('Northstar Systems');
    expect(first.seniority).toBe('unspecified');
    expect(first.salaryMinMinor).toBeNull();
    expect(first.salaryCurrency).toBeNull();
    expect(first.remoteState).toBe('remote');
    expect(first.isInternational).toBe(true);
    expect(first.sourceUrl).toBe('https://news.ycombinator.com/item?id=39876543');
    expect(first.description).toContain('We build automation for logistics teams');
    expect(first.skills).toContain('TypeScript');

    const second = hnAlgoliaAdapter.normalize(firstPosting(postings, 1), context);
    expect(second?.countryCode).toBe('PH');
    expect(second?.city).toBe('Cebu City');
    expect(second?.remoteState).toBe('hybrid');
  });

  it('does not call the API without a valid thread id', async () => {
    const stub = createFetchStub(() => jsonResponse({ hits: [HN_HIT] }));
    const withoutConfig = createContext({ fetch: stub.fetch });
    expect(await hnAlgoliaAdapter.fetchPostings(withoutConfig)).toEqual([]);

    const hostile = createContext({
      fetch: stub.fetch,
      config: { threadId: '34567890&tags=story_1' },
    });
    expect(await hnAlgoliaAdapter.fetchPostings(hostile)).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('derives remote state only from explicit tokens', () => {
    const context = createContext({ config: { threadId: '1' } });
    const input = hnAlgoliaAdapter.normalize(
      {
        sourceJobId: '1#0',
        sourceUrl: 'https://news.ycombinator.com/item?id=1',
        payload: {
          objectID: '1',
          comment_text: 'Northstar Systems | Engineer | Philippines',
          created_at: '2026-03-01T12:00:00Z',
        },
      },
      context,
    );
    expect(input?.remoteState).toBe('unspecified');
  });
});

describe('board adapters', () => {
  it('maps a greenhouse board into the canonical shape', async () => {
    const stub = createFetchStub(() => jsonResponse(GREENHOUSE_RESPONSE));
    const context = createContext({ fetch: stub.fetch, config: { boardTokens: ['northstar'] } });

    const postings = await greenhouseAdapter.fetchPostings(context);
    expect(postings).toHaveLength(2);
    expect(stub.calls[0]?.url).toBe(
      'https://boards-api.greenhouse.io/v1/boards/northstar/jobs?content=true',
    );

    const input = greenhouseAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;
    expectCanonicalShape(input);
    expect(input.companyName).toBe('Northstar Systems');
    expect(input.title).toBe('Senior Automation Engineer (Remote)');
    expect(input.description).not.toContain('&lt;');
    expect(input.description).toContain('Own the n8n automation platform.');
    expect(input.remoteState).toBe('remote');
    expect(input.countryCode).toBe('PH');
    expect(input.city).toBe('Manila');
    expect(input.requirements).toEqual(['5+ years with TypeScript', 'PostgreSQL and Docker']);
    expect(input.preferredQualifications).toEqual(['Kubernetes']);
    // Greenhouse publishes no publication date, so none is fabricated.
    expect(input.postedAt).toBeNull();
    expect(input.sourceUrl).toBe('https://boards.greenhouse.io/northstar/jobs/4567890');
  });

  it('keeps one failing board from stopping the others', async () => {
    const stub = createFetchStub((url) =>
      url.includes('/globex/')
        ? jsonResponse({ error: 'gone' }, 500)
        : jsonResponse(GREENHOUSE_RESPONSE),
    );
    const context = createContext({
      fetch: stub.fetch,
      config: { boardTokens: ['globex', 'northstar'] },
    });

    const postings = await greenhouseAdapter.fetchPostings(context);
    expect(postings).toHaveLength(2);
    expect(stub.calls).toHaveLength(2);
  });

  it('returns an empty batch when a board changes shape', async () => {
    const stub = createFetchStub(() => jsonResponse({ jobs: [{ unexpected: true }] }));
    const context = createContext({ fetch: stub.fetch, config: { boardTokens: ['northstar'] } });
    expect(await greenhouseAdapter.fetchPostings(context)).toEqual([]);
  });

  it('ignores board tokens that are not safe URL segments', async () => {
    const stub = createFetchStub(() => jsonResponse(GREENHOUSE_RESPONSE));
    const context = createContext({
      fetch: stub.fetch,
      config: { boardTokens: ['../../etc/passwd', 'northstar'] },
    });
    const postings = await greenhouseAdapter.fetchPostings(context);
    expect(stub.calls).toHaveLength(1);
    expect(postings).toHaveLength(2);
  });

  it('maps a lever board into the canonical shape', async () => {
    const stub = createFetchStub(() => jsonResponse(LEVER_RESPONSE));
    const context = createContext({ fetch: stub.fetch, config: { boardTokens: ['globex'] } });

    const postings = await leverAdapter.fetchPostings(context);
    expect(postings).toHaveLength(1);
    expect(stub.calls[0]?.url).toBe('https://api.lever.co/v0/postings/globex?mode=json');

    const input = leverAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;
    expectCanonicalShape(input);
    expect(input.title).toBe('Automation Engineer');
    expect(input.companyName).toBe('globex');
    expect(input.employmentType).toBe('full_time');
    expect(input.remoteState).toBe('hybrid');
    expect(input.city).toBe('Cebu City');
    expect(input.countryCode).toBe('PH');
    expect(input.postedAt).toBe('2026-02-25T06:13:20.000Z');
    expect(input.requirements).toEqual(['3-5 years of automation experience', 'Docker']);
    expect(input.applyUrl).toBe('https://jobs.lever.co/globex/lever-abc-123/apply');
  });

  it('returns an empty batch when a lever board answers with an object', async () => {
    const stub = createFetchStub(() => jsonResponse({ jobs: [] }));
    const context = createContext({ fetch: stub.fetch, config: { boardTokens: ['globex'] } });
    expect(await leverAdapter.fetchPostings(context)).toEqual([]);
  });

  it('maps an ashby board into the canonical shape', async () => {
    const stub = createFetchStub(() => jsonResponse(ASHBY_RESPONSE));
    const context = createContext({ fetch: stub.fetch, config: { boardTokens: ['globex'] } });

    const postings = await ashbyAdapter.fetchPostings(context);
    expect(postings).toHaveLength(1);
    expect(stub.calls[0]?.url).toBe('https://api.ashbyhq.com/posting-api/job-board/globex');

    const input = ashbyAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;
    expectCanonicalShape(input);
    expect(input.employmentType).toBe('contract');
    expect(input.remoteState).toBe('remote');
    expect(input.countryCode).toBe('PH');
    expect(input.postedAt).toBe('2026-02-27T00:00:00.000Z');
  });

  it('maps a workable board into the canonical shape', async () => {
    const stub = createFetchStub(() => jsonResponse(WORKABLE_RESPONSE));
    const context = createContext({ fetch: stub.fetch, config: { boardTokens: ['meridian'] } });

    const postings = await workableAdapter.fetchPostings(context);
    expect(postings).toHaveLength(1);
    expect(postings[0]?.sourceJobId).toBe('ABC123');
    expect(stub.calls[0]?.url).toBe(
      'https://apply.workable.com/api/v1/widget/accounts/meridian?details=true',
    );

    const input = workableAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;
    expectCanonicalShape(input);
    expect(input.companyName).toBe('Meridian Support Philippines Inc');
    expect(input.employmentType).toBe('part_time');
    expect(input.remoteState).toBe('remote');
    expect(input.countryCode).toBe('PH');
    expect(input.city).toBe('Cebu City');
    expect(input.region).toBe('Central Visayas');
    expect(input.postedAt).toBe('2026-02-26T00:00:00.000Z');
    expect(input.requirements).toEqual([
      'Excellent written English',
      '2+ years in customer support',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Credential-backed adapters
// ---------------------------------------------------------------------------

describe('adzuna adapter', () => {
  it('throws MissingCredentialError without credentials', async () => {
    const context = createContext();
    await expect(adzunaAdapter.fetchPostings(context)).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    await expect(adzunaAdapter.fetchPostings(context)).rejects.toThrow(/ADZUNA_APP_ID/u);
    expect(adzunaAdapter.requiresCredentials).toBe(true);
    expect(adzunaAdapter.credentialEnvVars).toEqual(['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
  });

  it('maps a search result into the canonical shape', async () => {
    const stub = createFetchStub(() => jsonResponse(ADZUNA_RESPONSE));
    const context = createContext({
      fetch: stub.fetch,
      credentials: { ADZUNA_APP_ID: 'app-id-value', ADZUNA_APP_KEY: 'app-key-value' },
      config: { countries: ['ph'], what: 'automation', where: 'makati' },
    });

    const postings = await adzunaAdapter.fetchPostings(context);
    expect(postings).toHaveLength(1);
    const called = stub.calls[0]?.url ?? '';
    expect(called).toContain('/jobs/ph/search/1');
    expect(called).toContain('app_id=app-id-value');
    expect(called).toContain('results_per_page=10');

    const input = adzunaAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;
    expectCanonicalShape(input);
    expect(input.companyName).toBe('Northstar Systems');
    expect(input.countryCode).toBe('PH');
    expect(input.employmentType).toBe('full_time');
    expect(input.salaryMinMinor).toBe(60_000_000);
    expect(input.salaryMaxMinor).toBe(90_000_000);
    expect(input.salaryCurrency).toBe('PHP');
    expect(input.salaryPeriod).toBe('annual');
    expect(input.salaryIsEstimate).toBe(true);
    expect(input.postedAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('never echoes the credential in a failure', async () => {
    const stub = createFetchStub(() => textResponse('invalid app_key=app-key-value', 401));
    const context = createContext({
      fetch: stub.fetch,
      credentials: { ADZUNA_APP_ID: 'app-id-value', ADZUNA_APP_KEY: 'app-key-value' },
    });

    let captured: unknown;
    try {
      await adzunaAdapter.fetchPostings(context);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(JobSourceRequestError);
    expect(captured instanceof Error ? captured.message : '').toBe(
      'adzuna returned HTTP status 401',
    );
    expect(captured instanceof Error ? captured.message : '').not.toContain('app-key-value');
  });
});

describe('jooble adapter', () => {
  it('throws MissingCredentialError without credentials', async () => {
    const context = createContext();
    await expect(joobleAdapter.fetchPostings(context)).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
    await expect(joobleAdapter.fetchPostings(context)).rejects.toThrow(/JOOBLE_API_KEY/u);
  });

  it('posts the configured search and maps the results', async () => {
    const stub = createFetchStub(() => jsonResponse(JOOBLE_RESPONSE));
    const context = createContext({
      fetch: stub.fetch,
      credentials: { JOOBLE_API_KEY: 'super-secret-jooble-key' },
      config: { keywords: 'automation', location: 'Manila', page: 2 },
    });

    const postings = await joobleAdapter.fetchPostings(context);
    expect(postings).toHaveLength(1);
    const call = stub.calls[0];
    expect(call?.url).toContain('super-secret-jooble-key');
    expect(call?.init?.method).toBe('POST');
    expect(parseJsonBody(call?.init?.body)).toEqual({
      keywords: 'automation',
      location: 'Manila',
      page: 2,
    });

    const input = joobleAdapter.normalize(firstPosting(postings, 0), context);
    expect(input).not.toBeNull();
    if (input === null) return;
    expectCanonicalShape(input);
    expect(input.companyName).toBe('Northstar Systems');
    expect(input.salaryMinMinor).toBe(4_500_000);
    expect(input.salaryMaxMinor).toBeNull();
    expect(input.salaryCurrency).toBe('PHP');
    expect(input.salaryPeriod).toBe('monthly');
    expect(input.salaryIsEstimate).toBe(false);
  });

  it('never echoes the credential in a failure', async () => {
    const stub = createFetchStub(() => textResponse('bad key super-secret-jooble-key', 500));
    const context = createContext({
      fetch: stub.fetch,
      credentials: { JOOBLE_API_KEY: 'super-secret-jooble-key' },
    });

    let captured: unknown;
    try {
      await joobleAdapter.fetchPostings(context);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(JobSourceRequestError);
    const message = captured instanceof Error ? captured.message : '';
    expect(message).not.toContain('super-secret-jooble-key');
    expect(message).toBe('jooble returned HTTP status 500');
  });

  it('refuses a credential that is not an API key', async () => {
    const stub = createFetchStub(() => jsonResponse(JOOBLE_RESPONSE));
    const context = createContext({
      fetch: stub.fetch,
      credentials: { JOOBLE_API_KEY: 'not a key/../etc' },
    });
    await expect(joobleAdapter.fetchPostings(context)).rejects.toBeInstanceOf(
      JobSourceRequestError,
    );
    expect(stub.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Limits and transport hygiene
// ---------------------------------------------------------------------------

describe('adapter limits', () => {
  const cases: readonly {
    name: string;
    adapter: JobSourceAdapter;
    payload: unknown;
    config: Readonly<Record<string, unknown>>;
    credentials?: Readonly<Record<string, string>>;
  }[] = [
    {
      name: 'remotive',
      adapter: remotiveAdapter,
      payload: { jobs: repeat(REMOTIVE_JOB, 5) },
      config: {},
    },
    {
      name: 'arbeitnow',
      adapter: arbeitnowAdapter,
      payload: { data: repeat(ARBEITNOW_JOB, 5) },
      config: {},
    },
    {
      name: 'hn_algolia',
      adapter: hnAlgoliaAdapter,
      payload: { hits: repeat(HN_HIT, 5) },
      config: { threadId: '34567890' },
    },
    {
      name: 'greenhouse',
      adapter: greenhouseAdapter,
      payload: GREENHOUSE_RESPONSE,
      config: { boardTokens: ['northstar', 'globex'] },
    },
    {
      name: 'lever',
      adapter: leverAdapter,
      payload: LEVER_RESPONSE,
      config: { boardTokens: ['globex', 'northstar'] },
    },
    {
      name: 'ashby',
      adapter: ashbyAdapter,
      payload: ASHBY_RESPONSE,
      config: { boardTokens: ['globex', 'northstar'] },
    },
    {
      name: 'workable',
      adapter: workableAdapter,
      payload: WORKABLE_RESPONSE,
      config: { boardTokens: ['meridian', 'globex'] },
    },
    {
      name: 'adzuna',
      adapter: adzunaAdapter,
      payload: ADZUNA_RESPONSE,
      config: { countries: ['ph'] },
      credentials: { ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key' },
    },
    {
      name: 'jooble',
      adapter: joobleAdapter,
      payload: JOOBLE_RESPONSE,
      config: {},
      credentials: { JOOBLE_API_KEY: 'jooble-secret-key' },
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} never returns more postings than the limit`, async () => {
      const stub = createFetchStub(() => jsonResponse(testCase.payload));
      const context = createContext({
        fetch: stub.fetch,
        limit: 2,
        config: testCase.config,
        credentials: testCase.credentials ?? {},
      });
      const postings = await testCase.adapter.fetchPostings(context);
      expect(postings.length).toBeGreaterThan(0);
      expect(postings.length).toBeLessThanOrEqual(2);
    });

    it(`${testCase.name} sends its User-Agent and asks for nothing when the limit is zero`, async () => {
      const stub = createFetchStub(() => jsonResponse(testCase.payload));
      const context = createContext({
        fetch: stub.fetch,
        limit: 0,
        config: testCase.config,
        credentials: testCase.credentials ?? {},
      });
      expect(await testCase.adapter.fetchPostings(context)).toEqual([]);
      expect(stub.calls).toHaveLength(0);
    });
  }
});

describe('transport failures', () => {
  it('reports a status without quoting the response body', async () => {
    const stub = createFetchStub(() => textResponse('<html>upstream exploded</html>', 503));
    const context = createContext({ fetch: stub.fetch });
    let captured: unknown;
    try {
      await remotiveAdapter.fetchPostings(context);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(JobSourceRequestError);
    const message = captured instanceof Error ? captured.message : '';
    expect(message).toBe('remotive returned HTTP status 503');
    expect(message).not.toContain('upstream exploded');
  });

  it('surfaces an unparsable body as a safe code', async () => {
    const stub = createFetchStub(() => textResponse('not json at all'));
    const context = createContext({ fetch: stub.fetch });
    await expect(remotiveAdapter.fetchPostings(context)).rejects.toThrow(/not JSON/u);
  });

  it('reports a transport error without quoting the URL', async () => {
    const stub = createFetchStub(() => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.adzuna.com?app_key=secret');
    });
    const context = createContext({
      fetch: stub.fetch,
      credentials: { ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'secret' },
    });
    let captured: unknown;
    try {
      await adzunaAdapter.fetchPostings(context);
    } catch (error) {
      captured = error;
    }
    const message = captured instanceof Error ? captured.message : '';
    expect(message).toBe('adzuna request failed (network_error)');
    expect(message).not.toContain('secret');
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('adapter registry', () => {
  it('exposes every adapter by its source code', () => {
    expect(jobSourceAdapters.map((adapter) => adapter.code)).toEqual([
      'remotive',
      'arbeitnow',
      'hn_algolia',
      'greenhouse',
      'lever',
      'ashby',
      'workable',
      'adzuna',
      'jooble',
    ]);
    expect(getJobSourceAdapter('remotive')).toBe(remotiveAdapter);
    expect(getJobSourceAdapter(' HN_ALGOLIA ')).toBe(hnAlgoliaAdapter);
    expect(getJobSourceAdapter('unknown_source')).toBeNull();
    for (const adapter of jobSourceAdapters) {
      expect(adapter.code).toMatch(/^[a-z][a-z0-9_]{2,63}$/u);
      expect(adapter.attribution.length).toBeGreaterThan(1);
      expect(adapter.attribution.length).toBeLessThanOrEqual(300);
      expect(adapter.requiresCredentials).toBe(adapter.credentialEnvVars.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

describe('stripHtml', () => {
  it('removes tags, decodes entities, and collapses whitespace', () => {
    expect(stripHtml('<p>Hello&nbsp;<strong>world</strong></p>')).toBe('Hello world');
    expect(stripHtml('A &amp; B &quot;quoted&quot;')).toBe('A & B "quoted"');
    expect(stripHtml('line one\n\n   line two')).toBe('line one line two');
    expect(stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;Safe text')).toBe('Safe text');
    expect(stripHtml('<p>Keep &#8369;80,000 &#x1F600;</p>')).toBe('Keep ₱80,000 😀');
  });
});

describe('detectRemoteState', () => {
  it('reads explicit arrangement tokens only', () => {
    expect(detectRemoteState('Remote-first team')).toBe('remote');
    expect(detectRemoteState('Work from home')).toBe('remote');
    expect(detectRemoteState('WFH anywhere')).toBe('remote');
    expect(detectRemoteState('Hybrid - 2 days in office')).toBe('hybrid');
    expect(detectRemoteState('On-site in Makati')).toBe('onsite');
    expect(detectRemoteState('This is not a remote position')).toBe('onsite');
    expect(detectRemoteState('Manila, Philippines')).toBe('unspecified');
    expect(detectRemoteState('Philippines')).toBe('unspecified');
  });
});

describe('detectEmploymentType', () => {
  it('reads explicit employment tokens and defaults to full_time', () => {
    expect(detectEmploymentType('full_time')).toBe('full_time');
    expect(detectEmploymentType('Part-Time')).toBe('part_time');
    expect(detectEmploymentType('Contract (12 months)')).toBe('contract');
    expect(detectEmploymentType('Freelance designer')).toBe('freelance');
    expect(detectEmploymentType('Internship')).toBe('internship');
    expect(detectEmploymentType('Temporary seasonal work')).toBe('temporary');
    expect(detectEmploymentType('Volunteer coordinator')).toBe('volunteer');
    expect(detectEmploymentType('other')).toBe('full_time');
    expect(detectEmploymentType('')).toBe('full_time');
  });
});

describe('detectSeniority', () => {
  it('never upgrades a title that states no level', () => {
    expect(
      detectSeniority(
        'Automation Engineer',
        'We are looking for a senior automation engineer to lead the platform team.',
      ),
    ).toBe('unspecified');
    expect(detectSeniority('Software Engineer II', 'Join our principal engineering group')).toBe(
      'unspecified',
    );
  });

  it('reads title tokens, strongest first', () => {
    expect(detectSeniority('Senior Automation Engineer (Remote)')).toBe('senior');
    expect(detectSeniority('Sr. Data Analyst')).toBe('senior');
    expect(detectSeniority('Junior Developer')).toBe('junior');
    expect(detectSeniority('Tech Lead')).toBe('lead');
    expect(detectSeniority('Staff Engineer')).toBe('principal');
    expect(detectSeniority('Engineering Manager')).toBe('manager');
    expect(detectSeniority('Head of Data')).toBe('director');
    expect(detectSeniority('VP of Sales')).toBe('executive');
    expect(detectSeniority('Chief Technology Officer')).toBe('executive');
    expect(detectSeniority('Software Engineering Intern')).toBe('internship');
    expect(detectSeniority('Senior Engineering Manager')).toBe('manager');
  });

  it('lets a description place a silent title at a lower band only', () => {
    expect(detectSeniority('Automation Engineer', 'This is an entry level role.')).toBe('entry');
    expect(detectSeniority('Automation Engineer', 'An internship on the platform team.')).toBe(
      'internship',
    );
  });
});

describe('parseSalary', () => {
  it('parses the shapes providers actually publish', () => {
    expect(parseSalary('₱80,000 - ₱110,000 per month')).toEqual({
      minMinor: 8_000_000,
      maxMinor: 11_000_000,
      currency: 'PHP',
      period: 'monthly',
      isEstimate: true,
    });
    expect(parseSalary('$60k-$80k')).toEqual({
      minMinor: 6_000_000,
      maxMinor: 8_000_000,
      currency: 'USD',
      period: null,
      isEstimate: true,
    });
    expect(parseSalary('PHP 45,000/month')).toEqual({
      minMinor: 4_500_000,
      maxMinor: null,
      currency: 'PHP',
      period: 'monthly',
      isEstimate: false,
    });
    expect(parseSalary('80000-110000 PHP monthly')).toEqual({
      minMinor: 8_000_000,
      maxMinor: 11_000_000,
      currency: 'PHP',
      period: 'monthly',
      isEstimate: true,
    });
    expect(parseSalary('USD 120,000 per year')).toEqual({
      minMinor: 12_000_000,
      maxMinor: null,
      currency: 'USD',
      period: 'annual',
      isEstimate: false,
    });
  });

  it('returns nulls for text that is not an unambiguous amount', () => {
    const empty = {
      minMinor: null,
      maxMinor: null,
      currency: null,
      period: null,
      isEstimate: false,
    };
    expect(parseSalary('Competitive')).toEqual(empty);
    expect(parseSalary('')).toEqual(empty);
    expect(parseSalary('Attractive package plus benefits')).toEqual(empty);
    // A number with no currency anywhere is not a salary.
    expect(parseSalary('60,000 - 80,000 per month')).toEqual(empty);
    // More than two amounts in one window is ambiguous.
    expect(parseSalary('PHP 45,000 - PHP 60,000 - PHP 90,000 monthly')).toEqual(empty);
    // An inverted range is not reported.
    expect(parseSalary('PHP 110,000 - PHP 80,000 per month')).toEqual(empty);
  });

  it('accepts a default currency for markets that do not state one', () => {
    expect(parseSalary('45000-60000', 'PHP')).toEqual({
      minMinor: 4_500_000,
      maxMinor: 6_000_000,
      currency: 'PHP',
      period: null,
      isEstimate: true,
    });
  });
});

describe('parseLocation', () => {
  it('recognises Philippine places and explicit country names', () => {
    expect(parseLocation('Makati, Metro Manila, Philippines')).toEqual({
      locationRaw: 'Makati, Metro Manila, Philippines',
      city: 'Makati',
      region: 'Metro Manila',
      countryCode: 'PH',
    });
    expect(parseLocation('Cebu City, Central Visayas')).toMatchObject({
      city: 'Cebu City',
      region: 'Central Visayas',
      countryCode: 'PH',
    });
    expect(parseLocation('Berlin, Germany')).toMatchObject({ city: null, countryCode: 'DE' });
    expect(parseLocation('Remote (Worldwide)')).toMatchObject({
      locationRaw: 'Remote (Worldwide)',
      city: null,
      region: null,
      countryCode: null,
    });
    expect(parseLocation('Somewhere nobody has heard of')).toMatchObject({
      city: null,
      region: null,
      countryCode: null,
    });
    expect(parseLocation('   ')).toEqual({
      locationRaw: null,
      city: null,
      region: null,
      countryCode: null,
    });
    expect(parseLocation('Manila')).toMatchObject({ city: 'Manila', countryCode: 'PH' });
  });
});

describe('extractSkills', () => {
  it('matches the lexicon case-insensitively and returns canonical casing', () => {
    expect(extractSkills('We use TypeScript, React and PostgreSQL daily')).toEqual([
      'TypeScript',
      'PostgreSQL',
      'React',
    ]);
    expect(extractSkills('javascript and n8n')).toEqual(['n8n', 'JavaScript']);
    expect(extractSkills('We value clear communication above all')).toEqual([]);
    expect(extractSkills('Experience with power bi and google sheets')).toEqual([
      'Google Sheets',
      'Power BI',
    ]);
  });
});

describe('splitRequirementBullets', () => {
  it('separates requirements from preferred qualifications', () => {
    const result = splitRequirementBullets(
      [
        'Requirements:',
        '- 3+ years of TypeScript',
        '- PostgreSQL experience',
        'Nice to have:',
        '- Kubernetes',
        '- dbt',
        'Responsibilities:',
        '- Own the ingestion pipeline',
      ].join('\n'),
    );
    expect(result.requirements).toEqual(['3+ years of TypeScript', 'PostgreSQL experience']);
    expect(result.preferredQualifications).toEqual(['Kubernetes', 'dbt']);
  });

  it('caps the number and length of entries', () => {
    const lines = ['Requirements:'];
    for (let index = 0; index < 35; index += 1) lines.push(`- Requirement number ${index}`);
    lines.push('Preferred:');
    for (let index = 0; index < 25; index += 1) lines.push(`- ${String(index)} ${'x'.repeat(600)}`);
    const result = splitRequirementBullets(lines.join('\n'));
    expect(result.requirements).toHaveLength(30);
    expect(result.preferredQualifications).toHaveLength(20);
    for (const entry of result.preferredQualifications) {
      expect(entry.length).toBeLessThanOrEqual(500);
    }
  });

  it('joins continuation lines and ignores empty input', () => {
    const result = splitRequirementBullets('Requirements:\n- Own the pipeline\nand the scheduler');
    expect(result.requirements).toEqual(['Own the pipeline and the scheduler']);
    expect(splitRequirementBullets('')).toEqual({
      requirements: [],
      preferredQualifications: [],
    });
  });
});

describe('deriveSeniorityFromExperience', () => {
  it('reads only explicit N+ years and N-M years phrasing', () => {
    expect(deriveSeniorityFromExperience('5+ years of automation')).toEqual({ min: 5, max: null });
    expect(deriveSeniorityFromExperience('3-5 years in support')).toEqual({ min: 3, max: 5 });
    expect(deriveSeniorityFromExperience('Requires 2.5+ yrs')).toEqual({ min: 2.5, max: null });
    expect(deriveSeniorityFromExperience('5 years of experience')).toEqual({
      min: null,
      max: null,
    });
    expect(deriveSeniorityFromExperience('Several years in the field')).toEqual({
      min: null,
      max: null,
    });
  });
});

describe('SQL normalization parity', () => {
  it('mirrors app_private.normalize_company_name', () => {
    expect(normalizeCompanyName('Northstar Systems, Inc.')).toBe('northstar systems');
    expect(normalizeCompanyName('Meridian Support Philippines Inc')).toBe('meridian support');
    expect(normalizeCompanyName('  ACME  Corporation ')).toBe('acme');
    expect(normalizeCompanyName('Globex')).toBe('globex');
  });

  it('mirrors app_private.normalize_job_title', () => {
    expect(normalizeTitle('Senior Automation Engineer (Remote)')).toBe(
      'senior automation engineer',
    );
    expect(normalizeTitle('Data Analyst II [Hybrid]')).toBe('data analyst ii');
    expect(normalizeTitle('C# / .NET Developer')).toBe('c# .net developer');
    expect(normalizeTitle('   ')).toBe('');
  });
});

describe('fingerprints', () => {
  it('is order-independent and stable', () => {
    const first = stableFingerprint({
      title: 'Senior Automation Engineer (Remote)',
      companyName: 'Northstar Systems, Inc.',
      locationRaw: 'Makati, Philippines',
      description: 'Own the automation platform for logistics teams.',
    });
    const reordered = stableFingerprint({
      description: 'Own the automation platform for logistics teams.',
      locationRaw: 'Makati, Philippines',
      companyName: 'Northstar Systems, Inc.',
      title: 'Senior Automation Engineer (Remote)',
    });
    expect(first).toBe(reordered);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).toBe(
      stableFingerprint({
        title: 'Senior Automation Engineer (Remote)',
        companyName: 'Northstar Systems, Inc.',
        locationRaw: 'Makati, Philippines',
        description: 'Own the automation platform for logistics teams.',
      }),
    );
    expect(
      stableFingerprint({
        title: 'Senior Automation Engineer (Remote)',
        companyName: 'Northstar Systems, Inc.',
        locationRaw: 'Makati, Philippines',
        description: 'A completely different description of the role.',
      }),
    ).not.toBe(first);
  });

  it('hashes payloads independently of key order', () => {
    expect(payloadChecksum({ a: 1, b: [2, 3], c: { d: 4, e: 5 } })).toBe(
      payloadChecksum({ c: { e: 5, d: 4 }, b: [2, 3], a: 1 }),
    );
    expect(payloadChecksum({ a: 1 })).not.toBe(payloadChecksum({ a: 2 }));
    expect(payloadChecksum({ a: 1 })).toMatch(/^[a-f0-9]{64}$/u);
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

const CANDIDATE = {
  sourceJobId: 'remotive-1',
  sourceUrl: 'https://remotive.com/remote-jobs/engineering/senior-automation-engineer-1',
  companyName: 'Northstar Systems, Inc.',
  title: 'Senior Automation Engineer',
  description:
    'Own the automation platform that moves freight for logistics teams across Southeast Asia.',
  locationRaw: 'Makati, Philippines',
  postedAt: '2026-02-20T09:30:00.000Z',
};

const CANDIDATE_FINGERPRINT = stableFingerprint(CANDIDATE);

describe('dedupe scoring', () => {
  it('scores an identical fingerprint as a merge', () => {
    const existing = { ...CANDIDATE, contentFingerprint: CANDIDATE_FINGERPRINT };
    const result = dedupeSignals(
      { ...CANDIDATE, contentFingerprint: CANDIDATE_FINGERPRINT },
      existing,
    );
    expect(result.score).toBe(1);
    expect(result.signals.contentFingerprint).toBe(1);
    expect(classifyDedupe(result.score)).toBe('merge');
  });

  it('places a same-title, same-company repost in the review band', () => {
    const result = dedupeSignals(
      {
        ...CANDIDATE,
        sourceJobId: 'greenhouse-99',
        sourceUrl: 'https://boards.greenhouse.io/northstar/jobs/99',
        description: 'Build integrations between our warehouse systems and partner platforms.',
        contentFingerprint: stableFingerprint({
          title: CANDIDATE.title,
          companyName: CANDIDATE.companyName,
          locationRaw: CANDIDATE.locationRaw,
          description: 'Build integrations between our warehouse systems and partner platforms.',
        }),
      },
      { ...CANDIDATE, contentFingerprint: CANDIDATE_FINGERPRINT },
    );
    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.score).toBeLessThan(0.92);
    expect(classifyDedupe(result.score)).toBe('review');
    expect(result.signals.company).toBe(1);
    expect(result.signals.title).toBe(1);
    expect(result.signals.contentFingerprint).toBe(0);
  });

  it('keeps unrelated postings distinct', () => {
    const result = dedupeSignals(
      {
        sourceJobId: 'workable-7',
        sourceUrl: 'https://apply.workable.com/meridian/jobs/XYZ',
        companyName: 'Meridian Support Philippines Inc',
        title: 'Customer Support Specialist',
        description: 'Answer customer questions over email and chat during Manila business hours.',
        locationRaw: 'Cebu City, Philippines',
        postedAt: '2026-01-05T00:00:00.000Z',
        contentFingerprint: stableFingerprint({
          title: 'Customer Support Specialist',
          companyName: 'Meridian Support Philippines Inc',
          locationRaw: 'Cebu City, Philippines',
          description:
            'Answer customer questions over email and chat during Manila business hours.',
        }),
      },
      { ...CANDIDATE, contentFingerprint: CANDIDATE_FINGERPRINT },
    );
    expect(result.score).toBeLessThan(0.6);
    expect(classifyDedupe(result.score)).toBe('distinct');
    expect(result.signals.postedAt).toBe(0);
  });

  it('classifies on the documented thresholds', () => {
    expect(classifyDedupe(0.92)).toBe('merge');
    expect(classifyDedupe(0.919)).toBe('review');
    expect(classifyDedupe(0.6)).toBe('review');
    expect(classifyDedupe(0.599)).toBe('distinct');
    expect(classifyDedupe(Number.NaN)).toBe('distinct');
  });

  it('computes token-set Jaccard similarity', () => {
    expect(similarity('Senior Automation Engineer', 'Automation Engineer')).toBeCloseTo(2 / 3, 5);
    expect(similarity('Senior Automation Engineer', 'Senior Automation Engineer')).toBe(1);
    expect(similarity('Automation Engineer', 'Customer Support')).toBe(0);
    expect(similarity('', '')).toBe(1);
    expect(similarity('Something', '')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

describe('runSourceIngestion', () => {
  const postings: RawPosting[] = [
    { sourceJobId: 'ok-1', sourceUrl: 'https://example.test/jobs/1', payload: 'first posting' },
    { sourceJobId: 'explode', sourceUrl: 'https://example.test/jobs/2', payload: 'throw' },
    { sourceJobId: 'unrepresentable', sourceUrl: 'https://example.test/jobs/3', payload: 'reject' },
    {
      sourceJobId: 'sink-fails',
      sourceUrl: 'https://example.test/jobs/4',
      payload: 'fourth posting',
    },
    { sourceJobId: 'existing', sourceUrl: 'https://example.test/jobs/5', payload: 'fifth posting' },
    { sourceJobId: 'ok-2', sourceUrl: 'https://example.test/jobs/6', payload: 'sixth posting' },
  ];

  const adapter: JobSourceAdapter = {
    code: 'remotive',
    displayName: 'Fixture source',
    attribution: 'Fixture used by tests.',
    requiresCredentials: false,
    credentialEnvVars: [],
    fetchPostings: () => Promise.resolve(postings),
    normalize: (raw: RawPosting): NormalizedJobInput | null => {
      if (raw.payload === 'throw') throw new Error('adapter bug for one posting');
      if (raw.payload === 'reject') return null;
      return buildJobInput({
        sourceJobId: raw.sourceJobId,
        sourceUrl: raw.sourceUrl,
        title: 'Automation Engineer',
        companyName: 'Northstar Systems',
        description: `Automation work with TypeScript and PostgreSQL. ${String(raw.payload)}.`,
        rawPayload: { payload: raw.payload },
      });
    },
  };

  const sink: IngestionSink = {
    upsertJob: (input) => {
      if (input.sourceJobId === 'sink-fails') {
        return Promise.reject(new Error('duplicate key value violates unique constraint'));
      }
      if (input.sourceJobId === 'existing') {
        return Promise.resolve({
          jobId: 'job-existing',
          created: false,
          merged: false,
          matchedBy: 'source_identity',
        });
      }
      return Promise.resolve({
        jobId: `job-${input.sourceJobId}`,
        created: true,
        merged: false,
        matchedBy: 'created',
      });
    },
  };

  it('isolates per-posting failures and keeps going', async () => {
    const result = await runSourceIngestion({ adapter, context: createContext(), sink });

    expect(result.fetched).toBe(6);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.rejected).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([
      { sourceJobId: 'explode', code: 'normalize_failed' },
      { sourceJobId: 'sink-fails', code: 'sink_failed' },
    ]);
    expect(result.fetched).toBe(
      result.created + result.updated + result.merged + result.skipped + result.rejected,
    );
  });

  it('honours the run limit', async () => {
    const result = await runSourceIngestion({ adapter, context: createContext(), sink, limit: 2 });
    expect(result.fetched).toBe(2);
    expect(result.created).toBe(1);
    expect(result.rejected).toBe(1);
  });

  it('does nothing when the limit is zero', async () => {
    const result = await runSourceIngestion({ adapter, context: createContext(), sink, limit: 0 });
    expect(result).toEqual({
      fetched: 0,
      created: 0,
      updated: 0,
      merged: 0,
      skipped: 0,
      rejected: 0,
      errors: [],
    });
  });

  it('counts a merged posting as merged', async () => {
    const mergingSink: IngestionSink = {
      upsertJob: () =>
        Promise.resolve({
          jobId: 'job-merged',
          created: false,
          merged: true,
          matchedBy: 'content_fingerprint',
        }),
    };
    const result = await runSourceIngestion({
      adapter,
      context: createContext(),
      sink: mergingSink,
      limit: 1,
    });
    expect(result.fetched).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.created).toBe(0);
  });
});
