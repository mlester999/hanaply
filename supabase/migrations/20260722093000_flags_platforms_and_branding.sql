-- Hanaply Phase 0: feature targeting, mobile platform lifecycle controls, and safe branding overrides.

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{2,80}$'),
  description text not null check (char_length(description) between 2 and 500),
  default_enabled boolean not null default false,
  client_exposed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feature_flag_rules (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references public.feature_flags (id) on delete cascade,
  enabled boolean not null,
  priority integer not null check (priority between 0 and 100000),
  environment text null check (environment is null or environment ~ '^[a-z][a-z0-9_-]{1,30}$'),
  plan_code text null references public.plans (code) on delete cascade,
  platform public.platform_kind null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feature_id, priority)
);

create index feature_flag_rules_matching_idx
  on public.feature_flag_rules (feature_id, priority desc, environment, plan_code, platform);

create table public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment ~ '^[a-z][a-z0-9_-]{1,30}$'),
  platform public.platform_kind not null,
  status public.platform_lifecycle not null,
  minimum_version text null check (
    minimum_version is null or minimum_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  ),
  latest_version text null check (
    latest_version is null or latest_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  ),
  force_update boolean not null default false,
  maintenance_mode boolean not null default false,
  api_compatibility_version integer not null default 1 check (api_compatibility_version > 0),
  announcement text null check (announcement is null or char_length(announcement) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, platform),
  check (not force_update or minimum_version is not null)
);

create table public.branding_settings (
  id uuid primary key default gen_random_uuid(),
  environment text not null unique check (environment ~ '^[a-z][a-z0-9_-]{1,30}$'),
  brand_name text not null default 'Hanaply' check (char_length(brand_name) between 2 and 100),
  tagline text not null default 'Hanap smarter. Apply stronger.' check (char_length(tagline) <= 180),
  support_email text null check (support_email is null or char_length(support_email) <= 254),
  logo_path text null check (logo_path is null or char_length(logo_path) <= 500),
  theme_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(theme_overrides) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger feature_flags_set_updated_at
before update on public.feature_flags
for each row execute function app_private.set_updated_at();
create trigger feature_flag_rules_set_updated_at
before update on public.feature_flag_rules
for each row execute function app_private.set_updated_at();
create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute function app_private.set_updated_at();
create trigger branding_settings_set_updated_at
before update on public.branding_settings
for each row execute function app_private.set_updated_at();

alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
alter table public.feature_flag_rules enable row level security;
alter table public.feature_flag_rules force row level security;
alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;
alter table public.branding_settings enable row level security;
alter table public.branding_settings force row level security;

comment on table public.branding_settings is
  'Allowlisted future overrides only. The design-token package remains the canonical safe default theme.';
