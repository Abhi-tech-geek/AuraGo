-- =====================================================================
-- AuraGo - Supabase Database Schema
-- AI-Powered Travel Discovery Platform
-- =====================================================================
-- Run this in the Supabase SQL Editor. Order matters: extensions first,
-- then tables, then policies, then triggers, then realtime publication.
-- =====================================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
-- Vector extension for RAG embeddings (Supabase ships with pgvector)
create extension if not exists "vector";


-- =====================================================================
-- 1. PROFILES (extends auth.users)
-- =====================================================================
-- Supabase Auth manages auth.users. We mirror a public profile row
-- per user for joining and surfacing display data in the UI.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_url    text,
  -- Default accessibility preference; can be overridden per-session
  uses_wheelchair boolean default false,
  preferred_mode  text default 'elite' check (preferred_mode in ('sasta','elite')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- 2. SESSIONS (one per chat / trip plan in the sidebar)
-- =====================================================================
create table if not exists public.sessions (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  title         text not null default 'New Trip',
  -- Mode drives the neon accent color on the client (green vs gold)
  mode          text not null default 'elite' check (mode in ('sasta','elite')),
  budget_inr    bigint,
  party_size    int default 1,
  universal_access boolean default false,
  -- Snapshot of the latest 5-card deck so "Back to Deck" survives reloads
  last_deck     jsonb,
  is_archived   boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists sessions_owner_idx on public.sessions(owner_id, updated_at desc);


-- =====================================================================
-- 3. SESSION PARTICIPANTS (collaborative locking / multi-user sync)
-- =====================================================================
create table if not exists public.session_participants (
  session_id    uuid not null references public.sessions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner','member','viewer')),
  joined_at     timestamptz default now(),
  primary key (session_id, user_id)
);
create index if not exists participants_user_idx on public.session_participants(user_id);


-- =====================================================================
-- 4. MESSAGES (chat feed: text + rich UI payloads)
-- =====================================================================
-- `kind` tells the React renderer which component to mount.
-- `payload` is the typed JSON the component consumes.
create table if not exists public.messages (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  author_id     uuid references public.profiles(id) on delete set null,
  role          text not null check (role in ('user','assistant','system')),
  kind          text not null default 'text' check (kind in (
                  'text',          -- plain markdown bubble
                  'mystery_deck',  -- the 5 hidden-vibe cards
                  'itinerary',     -- deep-dive expanded view
                  'qa_notice',     -- self-healing notice / RAG warning
                  'lock_event'     -- a lock action recorded in the feed
                )),
  content       text,            -- text body for kind='text', or summary
  payload       jsonb,           -- structured data for rich components
  -- For "Back to Deck": itinerary messages reference the deck they came from
  parent_message_id uuid references public.messages(id) on delete set null,
  created_at    timestamptz default now()
);
create index if not exists messages_session_idx on public.messages(session_id, created_at);
create index if not exists messages_parent_idx  on public.messages(parent_message_id);


-- =====================================================================
-- 5. TRIPS (a finalized / locked destination from a deck)
-- =====================================================================
create table if not exists public.trips (
  id              uuid primary key default uuid_generate_v4(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  message_id      uuid references public.messages(id) on delete set null, -- the deck msg
  card_id         text not null,        -- id of the chosen card inside payload
  destination     text not null,        -- revealed name e.g. 'Udaipur'
  vibe            text,                 -- 'Royal Heritage'
  ai_value_score  numeric(4,2),
  estimated_cost_inr bigint,
  itinerary       jsonb,                -- day-by-day plan
  accessibility_notes jsonb,            -- ramp info, gate hints, etc.
  rag_citations   jsonb,                -- sources used by the QA agent
  status          text not null default 'locked'
                  check (status in ('locked','planning','completed','cancelled')),
  locked_by       uuid references public.profiles(id),
  locked_at       timestamptz default now(),
  created_at      timestamptz default now()
);
create unique index if not exists trips_one_lock_per_session
  on public.trips(session_id) where status = 'locked';


-- =====================================================================
-- 6. RAG STORE (vector embeddings for fact-checking / self-healing)
-- =====================================================================
-- Populated by the Node controller when it ingests Serper.dev results,
-- review snippets, or operator data sheets.
create table if not exists public.rag_documents (
  id            uuid primary key default uuid_generate_v4(),
  destination   text,
  source_url    text,
  source_type   text check (source_type in ('review','news','operator','wiki','blog')),
  chunk         text not null,
  embedding     vector(768),     -- Gemini text-embedding-004 dimension
  metadata      jsonb,
  fetched_at    timestamptz default now()
);
create index if not exists rag_destination_idx on public.rag_documents(destination);
-- IVFFlat for cosine similarity search
create index if not exists rag_embedding_idx
  on public.rag_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);


-- =====================================================================
-- 7. ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles             enable row level security;
alter table public.sessions             enable row level security;
alter table public.session_participants enable row level security;
alter table public.messages             enable row level security;
alter table public.trips                enable row level security;
alter table public.rag_documents        enable row level security;

-- Helper: is the current user a participant of this session?
create or replace function public.is_session_member(sid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.session_participants
    where session_id = sid and user_id = auth.uid()
  ) or exists (
    select 1 from public.sessions where id = sid and owner_id = auth.uid()
  );
$$;

-- Profiles: each user reads/writes their own; everyone can read display data
drop policy if exists "profiles_self_rw" on public.profiles;
create policy "profiles_self_rw" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read" on public.profiles
  for select using (true);

-- Sessions: owner full access; participants read
drop policy if exists "sessions_owner_all" on public.sessions;
create policy "sessions_owner_all" on public.sessions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "sessions_participant_read" on public.sessions;
create policy "sessions_participant_read" on public.sessions
  for select using (public.is_session_member(id));

-- Participants
drop policy if exists "participants_member_read" on public.session_participants;
create policy "participants_member_read" on public.session_participants
  for select using (public.is_session_member(session_id));

drop policy if exists "participants_owner_write" on public.session_participants;
create policy "participants_owner_write" on public.session_participants
  for all using (
    exists (select 1 from public.sessions s
            where s.id = session_id and s.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.sessions s
            where s.id = session_id and s.owner_id = auth.uid())
  );

-- Messages: members read; members write their own user-role messages.
-- Assistant/system messages are inserted by the service role from the API.
drop policy if exists "messages_member_read" on public.messages;
create policy "messages_member_read" on public.messages
  for select using (public.is_session_member(session_id));

drop policy if exists "messages_user_insert" on public.messages;
create policy "messages_user_insert" on public.messages
  for insert with check (
    public.is_session_member(session_id)
    and role = 'user'
    and author_id = auth.uid()
  );

-- Trips: members read; members can lock (insert)
drop policy if exists "trips_member_read" on public.trips;
create policy "trips_member_read" on public.trips
  for select using (public.is_session_member(session_id));

drop policy if exists "trips_member_lock" on public.trips;
create policy "trips_member_lock" on public.trips
  for insert with check (public.is_session_member(session_id));

-- RAG: read for any signed-in user; writes only via service role
drop policy if exists "rag_authenticated_read" on public.rag_documents;
create policy "rag_authenticated_read" on public.rag_documents
  for select using (auth.role() = 'authenticated');


-- =====================================================================
-- 8. UPDATED_AT TRIGGERS
-- =====================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_sessions on public.sessions;
create trigger touch_sessions before update on public.sessions
  for each row execute function public.touch_updated_at();


-- =====================================================================
-- 9. REALTIME (WebSockets for collaborative locking & multi-user chat)
-- =====================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.session_participants;


-- =====================================================================
-- 10. RPC: similarity search used by the Node RAG controller
-- =====================================================================
create or replace function public.match_rag_documents(
  query_embedding vector(768),
  match_destination text default null,
  match_count int default 6
)
returns table (
  id uuid, destination text, source_url text,
  chunk text, similarity float, metadata jsonb
)
language sql stable as $$
  select d.id, d.destination, d.source_url, d.chunk,
         1 - (d.embedding <=> query_embedding) as similarity,
         d.metadata
  from public.rag_documents d
  where match_destination is null or d.destination = match_destination
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
