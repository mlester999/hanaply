-- Hanaply Phase 0: foundational types and security-conscious helper schema.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create type public.onboarding_status as enum ('not_started', 'in_progress', 'complete');
create type public.account_status as enum ('active', 'suspended', 'closed');
create type public.admin_membership_status as enum ('active', 'suspended', 'revoked');
create type public.plan_tier as enum ('plus', 'pro');
create type public.billing_period as enum ('monthly', 'annual');
create type public.subscription_status as enum (
  'pending_activation',
  'active',
  'expired',
  'cancelled',
  'suspended'
);
create type public.subscription_source as enum (
  'manual_payment',
  'admin_grant',
  'migration',
  'promotion'
);
create type public.entitlement_value_type as enum ('boolean', 'integer', 'string');
create type public.platform_kind as enum ('web', 'ios', 'android');
create type public.platform_lifecycle as enum ('planned', 'active', 'maintenance', 'retired');
create type public.audit_actor_type as enum ('user', 'admin', 'service', 'system');

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.set_updated_at() from public, anon, authenticated;

comment on schema app_private is
  'Functions and implementation details that must not be exposed through the Supabase Data API.';
