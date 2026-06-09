# 01 · Architecture — The big picture

## Component diagram (in text)

```
                            ┌──────────────────────┐
                            │       USER           │
                            │ (browser / phone)    │
                            └──────────┬───────────┘
                                       │ HTTPS
                                       ▼
                            ┌──────────────────────────────────────┐
                            │           CLOUD RUN                  │
                            │  ┌──────────────────────────────────┐│
                            │  │  Single Docker container         ││
                            │  │  ──────────────────────────────  ││
                            │  │  • Express 5 server              ││
                            │  │  • Serves built React app        ││
                            │  │  • Serves /api/* JSON endpoints  ││
                            │  └──────────┬───────────────────────┘│
                            └─────────────┼────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌────────────────┐               ┌─────────────────┐               ┌────────────────┐
│  Supabase      │               │   Groq API      │               │  Serper.dev    │
│  ────────────  │               │   ───────────   │               │  ───────────   │
│  • Postgres    │               │  Llama 3.3 70B  │               │  Google Search │
│  • Auth (JWT)  │               │  versatile      │               │  + Images API  │
│  • RLS         │               │  (OpenAI-compat)│               │                │
│  • Realtime    │               └─────────────────┘               └────────────────┘
│  • pgvector*   │
└────────┬───────┘
         │  realtime websocket
         ▼
┌────────────────┐
│  Browser tab 1 │ ◀─── sync ───▶ Browser tab 2 (another user, same trip)
└────────────────┘
```

\* pgvector is enabled but unused — see `09-rag-and-retrieval.md`.

## What lives where

### One Docker container on Cloud Run
The entire backend (Express) **and** the built React static files (`frontend/dist`) live inside **one** container image. There is no separate "frontend hosting" layer like Vercel or Netlify. The Express server:

- Serves `index.html` for any GET that doesn't start with `/api/`.
- Serves `/api/chat/...`, `/api/trips/...`, `/api/sessions/...`, `/api/polls/...`, `/api/prices/...`, `/api/public/trip/...` as JSON endpoints.

**Why a single container?** Simpler deployment, no CORS gymnastics in production, one URL for everything, easier secret management.

### Supabase = our managed Postgres + auth + realtime
We don't run our own Postgres or auth server. Supabase gives us:

- A Postgres database we own (with `pgvector` extension installed).
- An OAuth/email auth service that issues JWTs.
- Row-Level Security (RLS) — Postgres-native authorization, so even direct DB queries from the browser are safe.
- A websocket realtime layer that streams Postgres CDC events to subscribers.
- File storage (we don't use it yet).

### Groq = our LLM provider
Groq hosts open-source LLMs and gives us a free-tier OpenAI-compatible API. We call it from the backend only (the API key never touches the browser). Currently using `llama-3.3-70b-versatile`.

### Serper = our "live web" channel
We never train models or fetch our own scraped data. When we need fresh facts ("is this destination closed?", "what's a flight to Goa cost right now?", "what photos exist?"), we call Serper, which is Google Search wrapped as an API. Snippets get fed back into Groq for extraction.

## Request directions

Three kinds of traffic flow through this architecture:

### A. Read-only public traffic
**URL:** `/trip/<tripId>` (someone you shared a link with)
**Path:** Browser → Cloud Run Express → `/api/public/trip/:id` → Supabase Postgres (service role bypasses RLS) → JSON back to browser → React renders the read-only itinerary.
No auth required.

### B. Authenticated user traffic
**URL:** anywhere in the app after sign-in.
**Path:** Browser → Cloud Run Express → endpoint extracts the Supabase JWT from the `Authorization` header → calls `supabase.auth.getUser(token)` → if valid, the controller runs.
For each request the controller may:

1. Read from Postgres (sessions, messages, trips) via the service role key.
2. Call **Groq** one or many times (parseIntent → candidate pool → expand card → refine → etc.).
3. Call **Serper** for live verification or photo fetch.
4. Insert one or more rows back into `messages` / `trips`.
5. Return a small `{ ok: true, messageId }` JSON.

The actual **content** the user sees (the deck, the itinerary, the chat messages) flows back via **Supabase realtime**, not via the API response. That's the trick that makes multi-user sync work.

### C. Realtime collaboration traffic
**URL:** `wss://<supabase-project>.supabase.co/realtime/v1/...`
Every authenticated client opens **one websocket** per active session. When the backend (using the service role) inserts into `messages` or updates a poll payload, Postgres fires a CDC event → Supabase relays it to every subscriber of that channel → both your tab and your friend's tab update simultaneously.

This is the entire "agent" of multi-user collaboration — Postgres CDC events through Supabase. There is no Redis pub-sub, no Socket.io, no Pusher.

## What the frontend actually does

Three jobs:

1. **Render Postgres state.** A session is rows in `messages`; the React feed is a map of those rows.
2. **Trigger backend endpoints** when the user sends a turn, opens a card, locks a trip, refines a plan, votes on a poll.
3. **Subscribe to realtime.** A single `supabase.channel(`session:${id}`)` listens for INSERTs and UPDATEs on `messages` and `trips` so any change anywhere shows up everywhere.

## What the backend actually does

Three jobs:

1. **Auth verification.** A small `requireAuth` middleware validates Supabase JWTs.
2. **LLM orchestration.** Each endpoint runs a sequence of LLM calls plus optional Serper calls, then writes the result as a `messages` row.
3. **Static file serving.** A fallback middleware returns `index.html` for SPA routes.

There is intentionally **no** background queue, no cron, no worker. Every LLM call happens inside a normal HTTP request lifecycle. This is a deliberate simplicity trade-off — see `15-performance-optimizations.md` for what we did to keep response times tolerable inside a single request.

## Why this architecture (and not microservices)?

| Concern | Decision | Reason |
|---|---|---|
| Single container vs frontend + API split | Single container | One URL, no CORS, one deploy. |
| Microservices vs monolith | Monolith | We have one developer, one product. Microservices would be premature complexity. |
| Self-hosted Postgres vs Supabase | Supabase | Free tier, built-in auth + RLS + realtime, one fewer service to operate. |
| Self-hosted LLM (Ollama/vLLM) vs hosted (Groq) | Groq | Free tier, near-instant cold start, 30 RPM is enough for a side project. |
| Vector DB (Pinecone/Weaviate) vs pgvector | pgvector inside Supabase | Same Postgres, no extra service. (Currently unused — see RAG doc.) |
| Custom search vs Serper | Serper | $50 buys a year of dev usage. Google quality, no scraping headaches. |

---

**Next file:** `02-tech-stack-decisions.md` — every library, every framework, every choice and its alternatives.
