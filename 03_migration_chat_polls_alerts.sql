-- =====================================================================
-- AuraGo - Migration: allow poll / chat / alert messages
-- =====================================================================
-- We extend the messages.kind CHECK constraint so the same `messages`
-- table can carry trip chat threads, polls, and weather alerts in
-- addition to the existing flow. Payload schema lives in the controller:
--
--   kind = 'poll'  → payload { question, options: [{id,text}], votes: {userId: optionId} }
--   kind = 'chat'  → payload null; content is the chat line
--   kind = 'alert' → payload { kind:'weather'|'price', severity, summary }
--
-- Idempotent — safe to re-run.
-- =====================================================================

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
  check (kind in (
    'text',          -- plain markdown bubble
    'mystery_deck',  -- the 5/8 hidden-vibe cards
    'itinerary',     -- deep-dive expanded view
    'qa_notice',     -- self-healing notice / RAG warning
    'lock_event',    -- a lock action recorded in the feed
    'poll',          -- group decision card (Beach vs Mountain)
    'chat',          -- side-thread chat between collaborators
    'alert'          -- pre-trip weather/price alert
  ));

-- RLS for chat inserts: members already get `messages_user_insert`, but
-- that policy hard-codes role='user'. Chat lines are user-authored so
-- they fit perfectly — no policy change needed. (Polls are inserted via
-- the service-role backend, which bypasses RLS.)
