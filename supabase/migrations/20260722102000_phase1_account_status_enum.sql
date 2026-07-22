-- Hanaply Phase 1: align account lifecycle values without overloading verification state.

alter type public.account_status rename value 'closed' to 'disabled';
alter type public.account_status add value 'pending_deletion';
