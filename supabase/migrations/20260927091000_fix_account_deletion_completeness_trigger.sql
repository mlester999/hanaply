-- Fix: deleting an account that owns career records aborted the whole delete.
--
-- `public.career_profiles` and its child tables cascade from `auth.users`.
-- Removing a user therefore deletes the profile's skills, facts, employment,
-- links, projects, education, and certifications, and each of those deletes
-- fires an AFTER DELETE trigger calling this function to refresh the cached
-- completeness percentage. By the time those triggers ran, the parent
-- `career_profiles` row was already gone, so
-- `app_private.career_profile_completeness_value()` raised
-- `P0002: career profile does not exist` and the deletion failed with it.
--
-- The visible symptom was that no fixture account owning a career profile could
-- be removed: `tooling/e2e/test-data.ts` reported it as best-effort cleanup, and
-- because accounts are created by email, a second end-to-end run against a live
-- stack then failed in global setup on a duplicate address.
--
-- The guard belongs here rather than in each trigger: this helper is what every
-- one of the eight completeness triggers calls, so tolerating a profile that is
-- going away fixes every cascade path at once — including any table added later.
-- The strict behaviour of `career_profile_completeness_value()` is deliberately
-- left alone, because its other callers should still refuse to describe a
-- profile that does not exist.
--
-- Forward-only: the original migration is untouched.

create or replace function app_private.refresh_career_profile_completeness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
  computed integer;
begin
  target_profile_id := coalesce(new.career_profile_id, old.career_profile_id, new.id, old.id);
  if target_profile_id is null then
    return coalesce(new, old);
  end if;
  -- A cascade that removes the profile removes its children too, and the profile
  -- row is not visible from this trigger by then. There is no cached percentage
  -- left to refresh, so the child delete is allowed to proceed.
  if not exists (
    select 1 from public.career_profiles as profile where profile.id = target_profile_id
  ) then
    return coalesce(new, old);
  end if;
  computed := (app_private.career_profile_completeness_value(target_profile_id) ->> 'percent')::integer;
  update public.career_profiles
  set completeness_percent = computed
  where id = target_profile_id
    and completeness_percent <> computed;
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.refresh_career_profile_completeness()
  from public, anon, authenticated;
