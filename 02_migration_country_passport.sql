-- =====================================================================
-- AuraGo - Migration: add country + has_passport
-- =====================================================================
-- Adds traveller-origin context so the planner can:
--  * default suggestions to the user's home country
--  * unlock international picks only when has_passport = true
-- Idempotent — safe to re-run.
-- =====================================================================

-- profiles: per-user defaults
alter table public.profiles
  add column if not exists country      text default 'India',
  add column if not exists has_passport boolean default false;

-- sessions: per-trip values (modal can override profile defaults)
alter table public.sessions
  add column if not exists country      text default 'India',
  add column if not exists has_passport boolean default false,
  -- Multi-city trips: ordered list of stop names (city or "City, Country").
  -- Empty array = single-destination trip (normal flow).
  add column if not exists route_stops  jsonb default '[]'::jsonb;
