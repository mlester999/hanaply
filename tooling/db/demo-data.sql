-- Local development seed data.
--
-- Static roles, plans, entitlements, flags, platforms, branding, and the job
-- provider catalogue are seeded by the forward-only foundation and ingestion
-- migrations, so every environment receives the same baseline. This file adds
-- only what makes a local radar useful to look at.
--
-- It runs exclusively on `supabase db reset` or `pnpm db:harness:reset`, so it
-- can never touch a hosted project. It creates no users, no subscriptions, no
-- payments, and no product activity: a developer signs up normally, and the
-- fixtures below simply give that account something real to rank against.
--
-- The postings are synthetic and carry a fictional employer, so they can never
-- be mistaken for live opportunities. They are normalized through the same
-- `upsert_ingested_job` path the worker uses, which means the local database
-- exercises the real deduplication, provenance, and freshness logic.

-- ---------------------------------------------------------------------------
-- Local development job source
-- ---------------------------------------------------------------------------

insert into public.job_sources (
  code, display_name, source_kind, status, base_url, attribution, terms_url,
  min_scan_interval_minutes, requests_per_minute, batch_size
)
values (
  'local_fixtures',
  'Local development fixtures',
  'manual',
  'active',
  'https://localhost.invalid/fixtures',
  'Synthetic local development data. These postings are not real opportunities.',
  'https://localhost.invalid/terms',
  60,
  10,
  100
)
on conflict (code) do update set
  display_name = excluded.display_name,
  status = excluded.status,
  attribution = excluded.attribution;

-- ---------------------------------------------------------------------------
-- Synthetic postings
-- ---------------------------------------------------------------------------

do $$
declare
  fixture_source uuid;
  fingerprint text := repeat('0', 63);
  posting record;
begin
  select id into fixture_source from public.job_sources where code = 'local_fixtures';
  if fixture_source is null then
    return;
  end if;

  -- The ingestion writer is service-role only, exactly as it is in production.
  -- Local seeding adopts that role rather than weakening the check, so the seed
  -- exercises the same authorization path a real scan does.
  set local role service_role;
  set local request.jwt.claims = '{"role":"service_role"}';

  for posting in
    select * from (
      values
        (
          'local-0001',
          'Workflow Automation Engineer',
          'Northstar Systems (local fixture)',
          'full_time',
          'mid',
          'remote',
          'Remote - Philippines',
          'PH',
          9000000,
          12000000,
          'monthly',
          array['n8n', 'TypeScript', 'Supabase'],
          array[
            '3+ years building automation between business systems',
            'Strong n8n and TypeScript experience',
            'Comfortable owning a workflow end to end'
          ],
          array['Experience in a small operations team', 'Familiarity with Supabase'],
          3,
          1
        ),
        (
          'local-0002',
          'Solutions Engineer',
          'Pinebridge Labs (local fixture)',
          'full_time',
          'senior',
          'hybrid',
          'Makati, Metro Manila',
          'PH',
          11000000,
          15000000,
          'monthly',
          array['SQL', 'Node.js', 'Stakeholder communication'],
          array[
            'Translate customer requirements into technical designs',
            '5+ years in a customer-facing engineering role'
          ],
          array['Experience with enterprise procurement'],
          5,
          3
        ),
        (
          'local-0003',
          'Data Analyst',
          'Meridian Support (local fixture)',
          'contract',
          'junior',
          'remote',
          'Remote - Philippines',
          'PH',
          4500000,
          6000000,
          'monthly',
          array['SQL', 'Excel', 'Power BI'],
          array['Build recurring operational reports', '1+ years writing SQL'],
          array['Experience with PostgreSQL'],
          1,
          5
        ),
        (
          'local-0004',
          'Platform Engineer',
          'Atlas Workflow (local fixture)',
          'full_time',
          'senior',
          'onsite',
          'Singapore',
          'SG',
          9000000,
          12000000,
          'monthly',
          array['Kubernetes', 'Terraform', 'Go'],
          array[
            'Operate a distributed platform for a global customer base',
            '5+ years running production infrastructure'
          ],
          array['Experience with multi-region deployments'],
          5,
          2
        ),
        (
          'local-0005',
          'Night Shift Support Representative',
          'Meridian Support (local fixture)',
          'part_time',
          'entry',
          'onsite',
          'Cebu City, Cebu',
          'PH',
          1800000,
          2400000,
          'monthly',
          array['Zendesk', 'English'],
          array['Handle inbound calls on a night shift schedule'],
          array[]::text[],
          0,
          6
        )
    ) as fixture (
      source_job_id,
      title,
      company_name,
      employment_type,
      seniority,
      remote_state,
      location_raw,
      country_code,
      salary_min_minor,
      salary_max_minor,
      salary_period,
      skills,
      requirements,
      preferred,
      experience_years_min,
      days_ago
    )
  loop
    -- A stable, distinct fingerprint per fixture keeps them from deduplicating
    -- into each other while still exercising the real uniqueness constraint.
    fingerprint := pg_catalog.lpad(
      pg_catalog.to_hex(pg_catalog.hashtext(posting.source_job_id)::bigint & 1099511627775),
      13,
      '0'
    );
    fingerprint := pg_catalog.rpad(fingerprint, 64, '0');

    perform public.upsert_ingested_job(
      fixture_source,
      pg_catalog.jsonb_build_object(
        'sourceJobId', posting.source_job_id,
        'sourceUrl', 'https://localhost.invalid/fixtures/' || posting.source_job_id,
        'applyUrl', 'https://localhost.invalid/fixtures/' || posting.source_job_id || '/apply',
        'title', posting.title,
        'companyName', posting.company_name,
        'description',
          posting.title || ' at ' || posting.company_name || '. '
          || 'This is synthetic local development data and does not describe a real opening. '
          || pg_catalog.array_to_string(posting.requirements, '. ') || '. '
          || 'It exists so the radar, the matching engine, and the application surfaces can be '
          || 'exercised locally without contacting a provider.',
        'employmentType', posting.employment_type,
        'seniority', posting.seniority,
        'remoteState', posting.remote_state,
        'locationRaw', posting.location_raw,
        'countryCode', posting.country_code,
        'salaryMinMinor', posting.salary_min_minor,
        'salaryMaxMinor', posting.salary_max_minor,
        'salaryCurrency', 'PHP',
        'salaryPeriod', posting.salary_period,
        'salaryIsEstimate', false,
        'skills', pg_catalog.to_jsonb(posting.skills),
        'requirements', pg_catalog.to_jsonb(posting.requirements),
        'preferredQualifications', pg_catalog.to_jsonb(posting.preferred),
        'experienceYearsMin', posting.experience_years_min,
        'postedAt', pg_catalog.to_char(
          now() - pg_catalog.make_interval(days => posting.days_ago),
          'YYYY-MM-DD"T"HH24:MI:SSOF'
        ),
        'contentFingerprint', fingerprint,
        'payloadChecksum', pg_catalog.rpad(
          pg_catalog.to_hex(pg_catalog.hashtext(posting.source_job_id || ':payload')::bigint & 1099511627775),
          64,
          '0'
        ),
        'rawPayload', pg_catalog.jsonb_build_object(
          'fixture', true,
          'sourceJobId', posting.source_job_id
        )
      ),
      null
    );
  end loop;
end;
$$;
