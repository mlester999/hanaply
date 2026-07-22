-- Hanaply Phase 0: production-safe static catalog. This migration contains no fake users or activity.

insert into public.admin_permissions (code, description)
values
  ('admins.read', 'Read administrator memberships and role assignments'),
  ('admins.manage', 'Manage administrator memberships and role assignments'),
  ('users.read', 'Read safe user account information'),
  ('users.manage', 'Manage user account status and support actions'),
  ('subscriptions.read', 'Read subscriptions'),
  ('subscriptions.manage', 'Manage subscriptions through authorized services'),
  ('payments.read', 'Read payment review records'),
  ('payments.review', 'Review manual payment submissions'),
  ('plans.manage', 'Manage plans and entitlement values'),
  ('job_sources.read', 'Read job-source configuration'),
  ('job_sources.manage', 'Manage approved job sources'),
  ('jobs.read', 'Read normalized jobs'),
  ('jobs.moderate', 'Moderate normalized jobs'),
  ('taxonomy.read', 'Read career taxonomy'),
  ('taxonomy.manage', 'Manage career taxonomy'),
  ('ai.read', 'Read AI provider and evaluation configuration'),
  ('ai.manage', 'Manage AI provider and model configuration'),
  ('prompts.publish', 'Publish versioned prompts'),
  ('templates.manage', 'Manage resume and cover-letter templates'),
  ('notifications.manage', 'Manage notification configuration'),
  ('cms.manage', 'Manage approved marketing content'),
  ('support.manage', 'Manage support workflows'),
  ('audit.read', 'Read protected audit events'),
  ('security.manage', 'Manage security-sensitive settings'),
  ('platforms.manage', 'Manage web and mobile platform lifecycle controls'),
  ('feature_flags.manage', 'Manage feature flags and targeting rules')
on conflict (code) do update set description = excluded.description;

insert into public.admin_roles (code, name, description, system_role)
values
  ('super_admin', 'Super Admin', 'Full platform authority, reserved for tightly controlled owner access', true),
  ('operations_administrator', 'Operations Administrator', 'Broad operational control without AI, content, or security authority', true),
  ('payment_reviewer', 'Payment Reviewer', 'Read users and subscriptions and review manual payments', true),
  ('ai_administrator', 'AI Administrator', 'Manage providers, prompts, templates, and AI evaluation configuration', true),
  ('content_manager', 'Content Manager', 'Manage templates, notifications, and approved CMS content', true),
  ('support_administrator', 'Support Administrator', 'Read support-relevant records and manage support workflows', true),
  ('security_administrator', 'Security Administrator', 'Manage administrator access and security controls', true),
  ('read_only_analyst', 'Read-only Analyst', 'Read operational data and audits without mutation authority', true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  system_role = excluded.system_role;

insert into public.admin_role_permissions (role_id, permission_code)
select r.id, p.code
from public.admin_roles r
cross join public.admin_permissions p
where r.code = 'super_admin'
on conflict do nothing;

with mappings (role_code, permission_code) as (
  values
    ('operations_administrator', 'admins.read'),
    ('operations_administrator', 'users.read'),
    ('operations_administrator', 'users.manage'),
    ('operations_administrator', 'subscriptions.read'),
    ('operations_administrator', 'subscriptions.manage'),
    ('operations_administrator', 'payments.read'),
    ('operations_administrator', 'payments.review'),
    ('operations_administrator', 'plans.manage'),
    ('operations_administrator', 'job_sources.read'),
    ('operations_administrator', 'job_sources.manage'),
    ('operations_administrator', 'jobs.read'),
    ('operations_administrator', 'jobs.moderate'),
    ('operations_administrator', 'taxonomy.read'),
    ('operations_administrator', 'taxonomy.manage'),
    ('operations_administrator', 'notifications.manage'),
    ('operations_administrator', 'support.manage'),
    ('operations_administrator', 'audit.read'),
    ('operations_administrator', 'platforms.manage'),
    ('operations_administrator', 'feature_flags.manage'),
    ('payment_reviewer', 'users.read'),
    ('payment_reviewer', 'subscriptions.read'),
    ('payment_reviewer', 'payments.read'),
    ('payment_reviewer', 'payments.review'),
    ('ai_administrator', 'job_sources.read'),
    ('ai_administrator', 'jobs.read'),
    ('ai_administrator', 'taxonomy.read'),
    ('ai_administrator', 'ai.read'),
    ('ai_administrator', 'ai.manage'),
    ('ai_administrator', 'prompts.publish'),
    ('ai_administrator', 'templates.manage'),
    ('ai_administrator', 'audit.read'),
    ('content_manager', 'templates.manage'),
    ('content_manager', 'notifications.manage'),
    ('content_manager', 'cms.manage'),
    ('support_administrator', 'users.read'),
    ('support_administrator', 'subscriptions.read'),
    ('support_administrator', 'payments.read'),
    ('support_administrator', 'jobs.read'),
    ('support_administrator', 'support.manage'),
    ('security_administrator', 'admins.read'),
    ('security_administrator', 'admins.manage'),
    ('security_administrator', 'users.read'),
    ('security_administrator', 'audit.read'),
    ('security_administrator', 'security.manage'),
    ('security_administrator', 'platforms.manage'),
    ('read_only_analyst', 'users.read'),
    ('read_only_analyst', 'subscriptions.read'),
    ('read_only_analyst', 'payments.read'),
    ('read_only_analyst', 'job_sources.read'),
    ('read_only_analyst', 'jobs.read'),
    ('read_only_analyst', 'taxonomy.read'),
    ('read_only_analyst', 'ai.read'),
    ('read_only_analyst', 'audit.read')
)
insert into public.admin_role_permissions (role_id, permission_code)
select r.id, m.permission_code
from mappings m
join public.admin_roles r on r.code = m.role_code
on conflict do nothing;

insert into public.entitlement_definitions (
  key,
  value_type,
  default_value,
  description,
  unit,
  constraints
)
values
  ('careerProfileLimit', 'integer', '0', 'Maximum career search profiles', 'profiles', '{}'),
  ('subCareerLimitPerProfile', 'integer', '0', 'Maximum sub-careers per career profile', 'sub-careers', '{}'),
  ('scanIntervalMinutes', 'integer', '0', 'Target source discovery interval', 'minutes', '{}'),
  ('coverLetterPerJobLimit', 'integer', '0', 'Cover letters available per eligible job', 'documents', '{}'),
  ('tailoredResumePerJobLimit', 'integer', '0', 'Tailored resumes available per eligible job', 'documents', '{}'),
  ('coverLetterStyleSlotLimit', 'integer', '0', 'Configurable cover-letter style slots', 'slots', '{}'),
  ('resumeStyleSlotLimit', 'integer', '0', 'Configurable resume style slots', 'slots', '{}'),
  ('automaticPackMonthlyLimit', 'integer', '0', 'Approximate automatic Application Pack monthly limit', 'packs', '{}'),
  (
    'sourceDiscoveryPriority',
    'string',
    '"none"',
    'Source discovery priority class',
    null,
    '{"allowedValues":["none","standard","priority"]}'
  ),
  ('emailAlerts', 'boolean', 'false', 'Email job alerts', null, '{}'),
  ('dailyDigest', 'boolean', 'false', 'Daily digest email', null, '{}'),
  ('instantAlerts', 'boolean', 'false', 'Instant opportunity alerts', null, '{}'),
  ('browserNotifications', 'boolean', 'false', 'Browser notification access', null, '{}'),
  ('basicResumeBuilder', 'boolean', 'false', 'Basic resume builder access', null, '{}'),
  ('advancedResumeTemplates', 'boolean', 'false', 'Advanced visual resume templates', null, '{}'),
  ('applicationTracking', 'boolean', 'false', 'Application tracking access', null, '{}'),
  ('coreAiAnalysis', 'boolean', 'false', 'Core AI job analysis', null, '{}'),
  ('advancedAiAnalysis', 'boolean', 'false', 'Advanced AI job analysis', null, '{}'),
  ('interviewPreparation', 'boolean', 'false', 'Interview preparation tools', null, '{}'),
  ('recruiterMessages', 'boolean', 'false', 'Recruiter message generation', null, '{}'),
  ('weeklyAiCareerStrategy', 'boolean', 'false', 'Weekly AI career strategy', null, '{}'),
  ('priorityProcessing', 'boolean', 'false', 'Priority background processing', null, '{}'),
  ('futureMobileAccess', 'boolean', 'false', 'Future mobile application access', null, '{}'),
  ('automaticStretchPackOptIn', 'boolean', 'false', 'Future opt-in for stretch-opportunity packs', null, '{}')
on conflict (key) do update set
  value_type = excluded.value_type,
  default_value = excluded.default_value,
  description = excluded.description,
  unit = excluded.unit,
  constraints = excluded.constraints;

insert into public.plans (
  code,
  tier_code,
  name,
  billing_period,
  currency,
  price_minor,
  active,
  display_order,
  metadata
)
values
  (
    'plus_monthly', 'plus', 'Plus Monthly', 'monthly', 'PHP', 49900, true, 10,
    '{"defaultCoverLetterStyles":["professional"],"defaultResumeStyles":["ats_professional"]}'
  ),
  (
    'plus_annual', 'plus', 'Plus Annual', 'annual', 'PHP', 479900, true, 20,
    '{"defaultCoverLetterStyles":["professional"],"defaultResumeStyles":["ats_professional"]}'
  ),
  (
    'pro_monthly', 'pro', 'Pro Monthly', 'monthly', 'PHP', 99900, true, 30,
    '{"defaultCoverLetterStyles":["professional","results_first","warm_conversational"],"defaultResumeStyles":["ats_professional","results_led","technical_depth"]}'
  ),
  (
    'pro_annual', 'pro', 'Pro Annual', 'annual', 'PHP', 959900, true, 40,
    '{"defaultCoverLetterStyles":["professional","results_first","warm_conversational"],"defaultResumeStyles":["ats_professional","results_led","technical_depth"]}'
  )
on conflict (code) do update set
  tier_code = excluded.tier_code,
  name = excluded.name,
  billing_period = excluded.billing_period,
  currency = excluded.currency,
  price_minor = excluded.price_minor,
  active = excluded.active,
  display_order = excluded.display_order,
  metadata = excluded.metadata;

with tier_values (tier_code, entitlement_key, value) as (
  values
    ('plus'::public.plan_tier, 'careerProfileLimit', '1'::jsonb),
    ('plus'::public.plan_tier, 'subCareerLimitPerProfile', '2'::jsonb),
    ('plus'::public.plan_tier, 'scanIntervalMinutes', '15'::jsonb),
    ('plus'::public.plan_tier, 'coverLetterPerJobLimit', '1'::jsonb),
    ('plus'::public.plan_tier, 'tailoredResumePerJobLimit', '1'::jsonb),
    ('plus'::public.plan_tier, 'coverLetterStyleSlotLimit', '1'::jsonb),
    ('plus'::public.plan_tier, 'resumeStyleSlotLimit', '1'::jsonb),
    ('plus'::public.plan_tier, 'automaticPackMonthlyLimit', '40'::jsonb),
    ('plus'::public.plan_tier, 'sourceDiscoveryPriority', '"standard"'::jsonb),
    ('plus'::public.plan_tier, 'emailAlerts', 'true'::jsonb),
    ('plus'::public.plan_tier, 'dailyDigest', 'true'::jsonb),
    ('plus'::public.plan_tier, 'instantAlerts', 'false'::jsonb),
    ('plus'::public.plan_tier, 'browserNotifications', 'false'::jsonb),
    ('plus'::public.plan_tier, 'basicResumeBuilder', 'true'::jsonb),
    ('plus'::public.plan_tier, 'advancedResumeTemplates', 'false'::jsonb),
    ('plus'::public.plan_tier, 'applicationTracking', 'true'::jsonb),
    ('plus'::public.plan_tier, 'coreAiAnalysis', 'true'::jsonb),
    ('plus'::public.plan_tier, 'advancedAiAnalysis', 'false'::jsonb),
    ('plus'::public.plan_tier, 'interviewPreparation', 'false'::jsonb),
    ('plus'::public.plan_tier, 'recruiterMessages', 'false'::jsonb),
    ('plus'::public.plan_tier, 'weeklyAiCareerStrategy', 'false'::jsonb),
    ('plus'::public.plan_tier, 'priorityProcessing', 'false'::jsonb),
    ('plus'::public.plan_tier, 'futureMobileAccess', 'false'::jsonb),
    ('plus'::public.plan_tier, 'automaticStretchPackOptIn', 'false'::jsonb),
    ('pro'::public.plan_tier, 'careerProfileLimit', '3'::jsonb),
    ('pro'::public.plan_tier, 'subCareerLimitPerProfile', '5'::jsonb),
    ('pro'::public.plan_tier, 'scanIntervalMinutes', '5'::jsonb),
    ('pro'::public.plan_tier, 'coverLetterPerJobLimit', '3'::jsonb),
    ('pro'::public.plan_tier, 'tailoredResumePerJobLimit', '3'::jsonb),
    ('pro'::public.plan_tier, 'coverLetterStyleSlotLimit', '3'::jsonb),
    ('pro'::public.plan_tier, 'resumeStyleSlotLimit', '3'::jsonb),
    ('pro'::public.plan_tier, 'automaticPackMonthlyLimit', '100'::jsonb),
    ('pro'::public.plan_tier, 'sourceDiscoveryPriority', '"priority"'::jsonb),
    ('pro'::public.plan_tier, 'emailAlerts', 'true'::jsonb),
    ('pro'::public.plan_tier, 'dailyDigest', 'true'::jsonb),
    ('pro'::public.plan_tier, 'instantAlerts', 'true'::jsonb),
    ('pro'::public.plan_tier, 'browserNotifications', 'true'::jsonb),
    ('pro'::public.plan_tier, 'basicResumeBuilder', 'true'::jsonb),
    ('pro'::public.plan_tier, 'advancedResumeTemplates', 'true'::jsonb),
    ('pro'::public.plan_tier, 'applicationTracking', 'true'::jsonb),
    ('pro'::public.plan_tier, 'coreAiAnalysis', 'true'::jsonb),
    ('pro'::public.plan_tier, 'advancedAiAnalysis', 'true'::jsonb),
    ('pro'::public.plan_tier, 'interviewPreparation', 'true'::jsonb),
    ('pro'::public.plan_tier, 'recruiterMessages', 'true'::jsonb),
    ('pro'::public.plan_tier, 'weeklyAiCareerStrategy', 'true'::jsonb),
    ('pro'::public.plan_tier, 'priorityProcessing', 'true'::jsonb),
    ('pro'::public.plan_tier, 'futureMobileAccess', 'true'::jsonb),
    ('pro'::public.plan_tier, 'automaticStretchPackOptIn', 'true'::jsonb)
)
insert into public.plan_entitlements (plan_id, entitlement_key, value)
select p.id, tv.entitlement_key, tv.value
from public.plans p
join tier_values tv on tv.tier_code = p.tier_code
on conflict (plan_id, entitlement_key) do update set value = excluded.value;

insert into public.feature_flags (key, description, default_enabled, client_exposed)
values
  ('manual_payments', 'Manual payment activation workflow', false, true),
  ('career_profiles', 'Career Intelligence Profile workflow', false, true),
  ('job_ingestion', 'Approved job-source ingestion', false, false),
  ('ai_job_intelligence', 'AI requirement extraction and match analysis', false, false),
  ('application_packs', 'Truth-gated Application Pack generation', false, true),
  ('browser_notifications', 'Browser notification delivery', false, true),
  ('mobile_access', 'React Native application access', false, true)
on conflict (key) do update set
  description = excluded.description,
  default_enabled = excluded.default_enabled,
  client_exposed = excluded.client_exposed;

with environments (name) as (
  values ('local'), ('test'), ('staging'), ('production')
), platforms (platform, status, latest_version, announcement) as (
  values
    ('web'::public.platform_kind, 'active'::public.platform_lifecycle, '0.0.0', null::text),
    ('ios'::public.platform_kind, 'planned'::public.platform_lifecycle, null, 'Hanaply for iOS is planned.'),
    ('android'::public.platform_kind, 'planned'::public.platform_lifecycle, null, 'Hanaply for Android is planned.')
)
insert into public.platform_settings (
  environment,
  platform,
  status,
  minimum_version,
  latest_version,
  force_update,
  maintenance_mode,
  api_compatibility_version,
  announcement
)
select e.name, p.platform, p.status, null, p.latest_version, false, false, 1, p.announcement
from environments e
cross join platforms p
on conflict (environment, platform) do update set
  status = excluded.status,
  minimum_version = excluded.minimum_version,
  latest_version = excluded.latest_version,
  force_update = excluded.force_update,
  maintenance_mode = excluded.maintenance_mode,
  api_compatibility_version = excluded.api_compatibility_version,
  announcement = excluded.announcement;

insert into public.branding_settings (environment, brand_name, tagline, theme_overrides)
values
  ('local', 'Hanaply', 'Hanap smarter. Apply stronger.', '{}'),
  ('test', 'Hanaply', 'Hanap smarter. Apply stronger.', '{}'),
  ('staging', 'Hanaply', 'Hanap smarter. Apply stronger.', '{}'),
  ('production', 'Hanaply', 'Hanap smarter. Apply stronger.', '{}')
on conflict (environment) do update set
  brand_name = excluded.brand_name,
  tagline = excluded.tagline,
  theme_overrides = excluded.theme_overrides;
