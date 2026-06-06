-- =====================================================================
-- AuraGo - Migration: persist trip "days" on the session row
-- =====================================================================
-- The candidate-pool prompt and day-plan prompt were both losing the
-- user-specified number of days. We persist it on the session so it
-- survives expand-card / refine flows and so the backend can always
-- enforce the exact day count. Idempotent.
-- =====================================================================

alter table public.sessions
  add column if not exists days int default 4;
