-- Hanaply career documents: private storage, extraction review, and parsing state.
--
-- Resume and portfolio bytes are sensitive. They are stored in a private bucket
-- that has no anon/authenticated storage policy at all: uploads, listings, and
-- reads are performed exclusively by the server-side service client, and clients
-- receive only short-lived signed URLs after an owner or administrator check.
--
-- Extraction output is a *proposal*, never a fact. It is stored in
-- app_private.career_document_extractions and surfaced for review. Candidate
-- facts are only created when the owner applies a reviewed extraction, and even
-- then they land in the truth ledger as `candidate` rows that require explicit
-- confirmation.

-- ---------------------------------------------------------------------------
-- Private storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'career-documents',
  'career-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf',
    'text/rtf',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The deferred-cleanup queue was introduced for the two payment buckets. Career
-- documents reuse it so replaced and deleted objects are always reclaimed.
alter table app_private.storage_cleanup_jobs
  drop constraint storage_cleanup_jobs_bucket_id_check;

alter table app_private.storage_cleanup_jobs
  add constraint storage_cleanup_jobs_bucket_id_check
  check (bucket_id in ('payment-proofs', 'payment-qr-codes', 'career-documents'));

create or replace function public.queue_storage_cleanup(
  requested_bucket_id text,
  requested_object_path text,
  requested_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  normalized_path text;
  normalized_reason text;
begin
  perform app_private.require_service_role();

  if requested_bucket_id is null
    or requested_bucket_id not in ('payment-proofs', 'payment-qr-codes', 'career-documents')
  then
    raise exception 'unsupported storage bucket' using errcode = '22023';
  end if;

  normalized_path := pg_catalog.btrim(coalesce(requested_object_path, ''));
  if pg_catalog.char_length(normalized_path) < 10
    or pg_catalog.char_length(normalized_path) > 300
    or normalized_path ~ '\.\.'
    or normalized_path ~ '[\x00-\x1f]'
  then
    raise exception 'invalid storage object path' using errcode = '22023';
  end if;

  normalized_reason := pg_catalog.btrim(coalesce(requested_reason, ''));
  if pg_catalog.char_length(normalized_reason) < 3
    or pg_catalog.char_length(normalized_reason) > 120
  then
    raise exception 'a cleanup reason between 3 and 120 characters is required'
      using errcode = '22023';
  end if;

  insert into app_private.storage_cleanup_jobs (bucket_id, object_path, reason)
  values (requested_bucket_id, normalized_path, normalized_reason)
  on conflict (bucket_id, object_path, status) do update
    set reason = excluded.reason,
        available_at = now(),
        updated_at = now()
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.queue_storage_cleanup(text, text, text)
  from public, anon, authenticated;
grant execute on function public.queue_storage_cleanup(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Extraction records
-- ---------------------------------------------------------------------------

create table app_private.career_document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null
    references public.career_documents (id) on delete cascade,
  extractor text not null check (extractor in ('deterministic', 'ai')),
  extractor_version text not null check (char_length(extractor_version) between 1 and 80),
  model text null check (model is null or char_length(model) between 1 and 120),
  prompt_version text null check (prompt_version is null or char_length(prompt_version) between 1 and 80),
  payload jsonb not null check (pg_catalog.jsonb_typeof(payload) = 'object'),
  fact_count integer not null default 0 check (fact_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  reviewed_at timestamptz null,
  reviewed_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table app_private.career_document_extractions is
  'Raw extraction proposals. Not exposed through the Data API: the payload is returned to the owner only through public.career_document_detail, and never becomes a fact without an explicit owner decision.';

create index career_document_extractions_document_idx
  on app_private.career_document_extractions (document_id, created_at desc);

revoke all on table app_private.career_document_extractions from public, anon, authenticated;
grant all privileges on table app_private.career_document_extractions to service_role;

-- ---------------------------------------------------------------------------
-- Document lifecycle functions
-- ---------------------------------------------------------------------------

create or replace function app_private.career_document_snapshot(document public.career_documents)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', document.id,
    'careerProfileId', document.career_profile_id,
    'documentKind', document.document_kind,
    'status', document.status,
    'originalFilename', document.original_filename,
    'mimeType', document.mime_type,
    'sizeBytes', document.size_bytes,
    'checksumSha256', document.checksum_sha256,
    'pageCount', document.page_count,
    'wordCount', document.word_count,
    'parsedAt', document.parsed_at,
    'isActive', document.is_active,
    'version', document.version,
    'createdAt', document.created_at,
    'updatedAt', document.updated_at
  );
$$;

create or replace function app_private.require_career_document_owner(
  actor_user_id uuid,
  target_document_id uuid
)
returns public.career_documents
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  document public.career_documents;
begin
  perform app_private.require_active_actor(actor_user_id);
  select * into document
  from public.career_documents
  where id = target_document_id and user_id = actor_user_id;
  if document.id is null then
    raise exception 'career document does not exist' using errcode = 'P0002';
  end if;
  return document;
end;
$$;

create or replace function public.register_career_document(
  actor_user_id uuid,
  document_input jsonb,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  created_id uuid;
  target_profile_id uuid;
  object_path text;
  mime text;
begin
  perform app_private.require_active_actor(actor_user_id);
  payload := app_private.career_require_object(document_input, 'document');

  target_profile_id := nullif(app_private.career_text(payload, 'careerProfileId', 40, false), '')::uuid;
  if target_profile_id is not null then
    perform app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  end if;

  mime := app_private.career_text(payload, 'mimeType', 100, true);
  if mime not in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf',
    'text/rtf',
    'text/plain',
    'text/markdown'
  ) then
    raise exception 'unsupported career document type' using errcode = '22023';
  end if;

  object_path := app_private.career_text(payload, 'objectPath', 300, true);
  if pg_catalog.char_length(object_path) < 10
    or object_path ~ '\.\.'
    or object_path ~ '[\x00-\x1f]'
  then
    raise exception 'invalid career document object path' using errcode = '22023';
  end if;

  insert into public.career_documents (
    user_id, career_profile_id, document_kind, status, original_filename, mime_type,
    size_bytes, checksum_sha256, object_path
  ) values (
    actor_user_id,
    target_profile_id,
    coalesce(app_private.career_enum(
      payload, 'documentKind', array['resume', 'cover_letter', 'portfolio', 'other'], false
    ), 'resume')::public.career_document_kind,
    'uploaded',
    app_private.career_text(payload, 'originalFilename', 160, true),
    mime,
    app_private.career_integer(payload, 'sizeBytes', 1, 10485760),
    app_private.career_text(payload, 'checksumSha256', 64, true),
    object_path
  )
  returning id into created_id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'career_document.registered', 'career_document', created_id,
    action_request_id,
    pg_catalog.jsonb_build_object('documentKind', 'resume', 'sizeBytes', (payload ->> 'sizeBytes'))
  );

  return created_id;
end;
$$;

create or replace function public.record_career_document_extraction(
  actor_user_id uuid,
  target_document_id uuid,
  extraction_input jsonb,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  document public.career_documents;
  payload jsonb;
  created_id uuid;
  facts jsonb;
begin
  document := app_private.require_career_document_owner(actor_user_id, target_document_id);
  payload := app_private.career_require_object(extraction_input, 'extraction');
  facts := coalesce(payload -> 'candidateFacts', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(facts) <> 'array' then
    raise exception 'candidateFacts must be an array' using errcode = '22023';
  end if;

  insert into app_private.career_document_extractions (
    document_id, extractor, extractor_version, model, prompt_version, payload,
    fact_count, warning_count
  ) values (
    document.id,
    app_private.career_enum(payload, 'extractor', array['deterministic', 'ai'], true),
    app_private.career_text(payload, 'extractorVersion', 80, true),
    app_private.career_text(payload, 'model', 120, false),
    app_private.career_text(payload, 'promptVersion', 80, false),
    payload,
    pg_catalog.jsonb_array_length(facts),
    pg_catalog.jsonb_array_length(coalesce(payload -> 'warnings', '[]'::jsonb))
  )
  returning id into created_id;

  update public.career_documents
  set status = 'needs_review',
      page_count = app_private.career_integer(payload, 'pageCount', 1, 500),
      word_count = app_private.career_integer(payload, 'wordCount', 0, 200000),
      parsed_at = now(),
      parse_error_code = null,
      version = version + 1
  where id = document.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'system', 'career_document.extracted', 'career_document', document.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'extractor', (payload ->> 'extractor'),
      'factCount', pg_catalog.jsonb_array_length(facts)
    )
  );

  return created_id;
end;
$$;

create or replace function public.complete_career_document_processing(
  actor_user_id uuid,
  target_document_id uuid,
  outcome text,
  error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  document public.career_documents;
begin
  document := app_private.require_career_document_owner(actor_user_id, target_document_id);
  if outcome not in ('failed', 'rejected', 'processing') then
    raise exception 'unsupported document outcome' using errcode = '22023';
  end if;

  update public.career_documents
  set status = outcome::public.career_document_status,
      parse_error_code = pg_catalog.left(app_private.career_text(
        pg_catalog.jsonb_build_object('errorCode', error_code), 'errorCode', 80, false
      ), 80),
      version = version + 1
  where id = document.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, metadata
  ) values (
    actor_user_id, 'system', 'career_document.processing_' || outcome, 'career_document',
    document.id,
    pg_catalog.jsonb_build_object('errorCode', error_code)
  );

  return true;
end;
$$;

create or replace function public.career_document_directory(actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_actor(actor_user_id);
  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        app_private.career_document_snapshot(document)
        order by document.created_at desc
      )
      from public.career_documents as document
      where document.user_id = actor_user_id and document.is_active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.career_document_detail(
  actor_user_id uuid,
  target_document_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  document public.career_documents;
  extraction app_private.career_document_extractions;
begin
  document := app_private.require_career_document_owner(actor_user_id, target_document_id);

  select * into extraction
  from app_private.career_document_extractions
  where document_id = document.id
  order by created_at desc
  limit 1;

  return app_private.career_document_snapshot(document) || pg_catalog.jsonb_build_object(
    'extraction', case
      when extraction.id is null then null
      else pg_catalog.jsonb_build_object(
        'documentId', document.id,
        'status', document.status,
        'extractor', extraction.extractor,
        'extractorVersion', extraction.extractor_version,
        'wordCount', document.word_count,
        'headline', coalesce(extraction.payload -> 'headline', 'null'::jsonb),
        'summary', coalesce(extraction.payload -> 'summary', 'null'::jsonb),
        'skills', coalesce(extraction.payload -> 'skills', '[]'::jsonb),
        'employment', coalesce(extraction.payload -> 'employment', '[]'::jsonb),
        'education', coalesce(extraction.payload -> 'education', '[]'::jsonb),
        'certifications', coalesce(extraction.payload -> 'certifications', '[]'::jsonb),
        'links', coalesce(extraction.payload -> 'links', '[]'::jsonb),
        'candidateFacts', coalesce(extraction.payload -> 'candidateFacts', '[]'::jsonb),
        'warnings', coalesce(extraction.payload -> 'warnings', '[]'::jsonb)
      )
    end
  );
end;
$$;

create or replace function public.resolve_career_document_object(
  actor_user_id uuid,
  target_document_id uuid
)
returns table (
  bucket_id text,
  object_path text,
  mime_type text,
  original_filename text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  document public.career_documents;
begin
  document := app_private.require_career_document_owner(actor_user_id, target_document_id);
  return query select
    document.bucket_id,
    document.object_path,
    document.mime_type,
    document.original_filename;
end;
$$;

create or replace function public.archive_career_document(
  actor_user_id uuid,
  target_document_id uuid,
  action_request_id uuid default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  document public.career_documents;
begin
  document := app_private.require_career_document_owner(actor_user_id, target_document_id);

  update public.career_documents
  set is_active = false,
      status = 'archived',
      version = version + 1
  where id = document.id;

  -- Facts that came from this document survive, but their document pointer is
  -- cleared so no evidence row can reference a deleted object.
  update public.career_facts
  set document_id = null
  where document_id = document.id;

  perform public.queue_storage_cleanup(
    document.bucket_id,
    document.object_path,
    'career_document_archived'
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'career_document.archived', 'career_document', document.id,
    action_request_id,
    pg_catalog.jsonb_build_object('documentKind', document.document_kind)
  );

  return document.object_path;
end;
$$;

revoke all on function app_private.career_document_snapshot(public.career_documents)
  from public, anon, authenticated;
revoke all on function app_private.require_career_document_owner(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.register_career_document(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.record_career_document_extraction(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_career_document_processing(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.career_document_directory(uuid) from public, anon, authenticated;
revoke all on function public.career_document_detail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_career_document_object(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.archive_career_document(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.register_career_document(uuid, jsonb, uuid) to service_role;
grant execute on function public.record_career_document_extraction(uuid, uuid, jsonb, uuid)
  to service_role;
grant execute on function public.complete_career_document_processing(uuid, uuid, text, text)
  to service_role;
grant execute on function public.career_document_directory(uuid) to service_role;
grant execute on function public.career_document_detail(uuid, uuid) to service_role;
grant execute on function public.resolve_career_document_object(uuid, uuid) to service_role;
grant execute on function public.archive_career_document(uuid, uuid, uuid) to service_role;

comment on function public.resolve_career_document_object(uuid, uuid) is
  'Returns the private storage address for an owner document. The path must never be logged, returned as display data, or written to an audit event.';
