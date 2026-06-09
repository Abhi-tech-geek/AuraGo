# 05 · Database & schema

## Where the SQL lives

```
01_supabase_schema.sql                  ← initial schema (run once)
02_migration_country_passport.sql       ← adds country, has_passport, route_stops
03_migration_chat_polls_alerts.sql      ← allows messages.kind values 'poll','chat','alert'
04_migration_session_days.sql           ← adds sessions.days
```

The migrations are **idempotent** (`if not exists` / `add column if not exists` / drop-then-add CHECK constraints). You can re-run them safely.

They get applied **manually** in Supabase's SQL editor. We do not use `db-migrate` / Prisma migrate / Knex. For a side project, two-file migrations once a month is faster than tooling.

## The seven tables

```
auth.users               (managed by Supabase Auth — we don't touch it directly)
public.profiles          one row per signed-up user
public.sessions          one row per "trip planning chat"
public.session_participants  membership rows for collaboration
public.messages          every chat message (text, deck, itinerary, poll, chat, lock event)
public.trips             one row per locked / finalised trip
public.rag_documents     vector store for future RAG (currently unused)
```

### `auth.users`
Supabase's built-in users table. Holds email, hashed password, JWT signing material. We never query it directly.

### `public.profiles`
Mirrors `auth.users` with public fields we can join to.

```sql
id              uuid primary key references auth.users(id) on delete cascade
display_name    text
avatar_url      text
uses_wheelchair boolean default false
preferred_mode  text default 'elite' check (preferred_mode in ('sasta','elite'))
country         text default 'India'
has_passport    boolean default false
created_at      timestamptz default now()
updated_at      timestamptz default now()
```

A trigger (`handle_new_user`) auto-creates a profile row when a new auth user signs up.

### `public.sessions`
Each "trip planning chat" the user starts. Max 5 per user (enforced in frontend only — the DB doesn't have a hard cap).

```sql
id                uuid primary key default uuid_generate_v4()
owner_id          uuid not null references public.profiles(id)
title             text default 'New Trip'      -- renamed to destination on lock
mode              text check in ('sasta','elite')
budget_inr        bigint
party_size        int default 1
days              int default 4
universal_access  boolean default false
country           text default 'India'
has_passport      boolean default false
route_stops       jsonb default '[]'::jsonb    -- multi-city array
last_deck         jsonb                         -- snapshot of the 8 cards
is_archived       boolean default false
created_at        timestamptz default now()
updated_at        timestamptz default now()
```

`last_deck` lets the "Back to Deck" navigation work after a page reload without re-running the LLM.

### `public.session_participants`
Many-to-many between users and sessions. Powers collaboration.

```sql
session_id   uuid not null references public.sessions(id)
user_id      uuid not null references public.profiles(id)
role         text check in ('owner','member','viewer') default 'member'
joined_at    timestamptz default now()
primary key (session_id, user_id)
```

When a user accepts an invite link (`POST /api/sessions/:id/join`) we `upsert` here.

### `public.messages` — the most important table

Every visible piece of the chat feed is a row here.

```sql
id                  uuid primary key default uuid_generate_v4()
session_id          uuid not null references public.sessions(id)
author_id           uuid references public.profiles(id) on delete set null
role                text check in ('user','assistant','system')
kind                text check in (
                      'text',          -- plain markdown bubble
                      'mystery_deck',  -- the 8 hidden-gem cards
                      'itinerary',     -- a full plan
                      'qa_notice',     -- self-healing notice
                      'lock_event',    -- a trip was locked
                      'poll',          -- group decision card
                      'chat',          -- side-thread chat between collaborators
                      'alert')         -- weather / price alert
content             text         -- markdown body for kind='text', or summary line
payload             jsonb        -- the structured data each kind needs
parent_message_id   uuid references public.messages(id)  -- itinerary points at its deck
created_at          timestamptz default now()
```

**Why one table for everything?** The chat feed is naturally a heterogeneous list of cards. Each `kind` is rendered by a different React component. Modelling it as one table makes "what's in this session?" a single SELECT, plus realtime subscription is trivial (one channel filter).

### `public.trips`
A locked trip — the version the user committed to.

```sql
id                  uuid primary key default uuid_generate_v4()
session_id          uuid not null references public.sessions(id)
message_id          uuid references public.messages(id)  -- the deck this came from
card_id             text not null                         -- which of the 8 cards
destination         text not null                         -- revealed name
vibe                text
ai_value_score      numeric(4,2)
estimated_cost_inr  bigint
itinerary           jsonb                                 -- the whole rich plan
accessibility_notes jsonb
rag_citations       jsonb
status              text default 'locked' check in ('locked','planning','completed','cancelled')
locked_by           uuid references public.profiles(id)
locked_at           timestamptz default now()
created_at          timestamptz default now()
```

A unique index `trips_one_lock_per_session` enforces **one locked trip per session**. The whole itinerary is stored as a self-contained `jsonb` so the public-share view doesn't need to look anything else up.

### `public.rag_documents` — currently dormant
```sql
id            uuid primary key
destination   text
source_url    text
source_type   text check in ('review','news','operator','wiki','blog')
chunk         text not null
embedding     vector(768)
metadata      jsonb
fetched_at    timestamptz default now()
```

The schema is ready. We don't populate it. Why? Groq has no embedding endpoint, and we haven't wired a separate provider. See `09-rag-and-retrieval.md`.

## Row-Level Security (RLS)

Every table has RLS enabled. The policies are the **authorization layer** — they enforce who can read or write what, even when the frontend queries Supabase directly.

### Profiles
- Each user can read/write their own profile row.
- Everyone can read display data (for showing avatars in shared trips).

### Sessions
- Owners have full access (`for all using owner_id = auth.uid()`).
- Participants can read (`for select using is_session_member(id)`).

### `is_session_member(sid uuid)` SQL helper
```sql
returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from public.session_participants
    where session_id = sid and user_id = auth.uid()
  ) or exists (
    select 1 from public.sessions
    where id = sid and owner_id = auth.uid()
  );
$$;
```

This single function is reused by message + trip policies. Keeping the membership check in one place avoids drift.

### Messages
- Members can read (`for select using is_session_member(session_id)`).
- Members can insert their own `role='user'` messages (`for insert with check ...`).
- Assistant/system messages are inserted by the **service role** from the backend, which bypasses RLS.

### Trips
- Members can read (`for select using is_session_member(session_id)`).
- Members can lock (insert), but the unique index enforces one lock per session.

### Why RLS matters
RLS lets the **browser read directly from Postgres safely**. A signed-in user can run:
```js
const { data } = await supabase
  .from('messages')
  .select('*')
  .eq('session_id', someId)
```
…without going through our backend, and they will only see rows they're allowed to see. The DB itself is the security boundary.

## Realtime publication

```sql
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.session_participants;
```

These three tables broadcast INSERT/UPDATE/DELETE events to subscribed clients. That's how collaboration works (see `13-realtime-collaboration.md`).

## Triggers

`touch_sessions` and `touch_profiles` keep `updated_at` fresh on every UPDATE. Trivial but important for sidebar sorting.

## Index choices

- `sessions_owner_idx (owner_id, updated_at desc)` — speeds up "list my trips, newest first".
- `messages_session_idx (session_id, created_at)` — speeds up loading a chat in chronological order.
- `messages_parent_idx (parent_message_id)` — speeds up "given a deck, find its itinerary".
- `trips_one_lock_per_session (session_id) where status='locked'` — partial unique index for the one-lock invariant.
- `rag_embedding_idx using ivfflat` — set up but not yet exercised.

## Common queries (for interview reference)

**Load all messages in a session, oldest first:**
```sql
select * from public.messages
where session_id = $1
order by created_at asc;
```

**Find the itinerary for a specific deck card:**
```sql
select * from public.messages
where session_id = $1
  and parent_message_id = $2
  and kind = 'itinerary'
  and payload @> jsonb_build_object('card_id', $3);
```

**Lock a trip (with one-per-session enforcement):**
```sql
insert into public.trips (...) values (...)
returning *;
-- If the user already has a locked trip in this session, the unique index errors.
```

---

**Next file:** `06-ai-agents-explained.md` — the eight LLM roles, and the honest answer to "is this agentic?".
