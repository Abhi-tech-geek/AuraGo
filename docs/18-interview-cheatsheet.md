# 18 · Interview cheatsheet

Read this the night before. It is everything you need to confidently answer any AuraGo question in 60 seconds or less.

## The 30-second pitch

> "AuraGo is an AI-powered travel discovery web app. Users describe a vibe or a place, and within 30 seconds get 8 verified hidden-gem destinations with full day-by-day plans, live weather, prices, and shareable links they can plan collaboratively with friends in real time."

## What is it, technically?

> "A React + Express full-stack app deployed as one container on Cloud Run. The AI layer is one LLM — Llama 3.3 70B via Groq — called from eight different system prompts in a deterministic orchestration pipeline. Live web data comes from Serper. Persistence, auth, realtime collaboration, and RLS-based authorization all run on Supabase Postgres."

## Is it an agentic AI system?

> "No, and I'm careful with that word. There are no autonomous loops, no agent-to-agent communication, no tool selection by the LLM, no persistent agent memory. I'd describe it as **multi-stage LLM orchestration** behind a real-time collaborative web app. The orchestration logic lives in plain JavaScript controllers — the LLM only fills in structured JSON when asked."

## The 8 LLM roles (memorise these)

1. **parseIntent** — extracts structured intent from free text
2. **generateCandidatePool** — produces 8 destination cards
3. **ragVerify** — judges if a destination is safe to suggest right now
4. **buildItineraryPayload** — generates the N-day plan
5. **refineItinerary** — edits an existing plan per instruction
6. **replanWeather** — decides if weather requires rejig
7. **checkPrices** — extracts ₹ ranges from Serper snippets
8. **chatQA** — concierge Q&A about an open itinerary

## The 10 endpoints (memorise these too)

| POST | Purpose |
|---|---|
| `/api/chat/turn` | Free-text → 8-card mystery deck |
| `/api/chat/direct` | Named destination → deck of 1 + full itinerary |
| `/api/chat/expand-card` | Card tap → full itinerary |
| `/api/chat/refine` | Chip click → rewrite itinerary |
| `/api/chat/replan-weather` | Live forecast → optional rejig |
| `/api/chat/qa` | Concierge bot |
| `/api/prices/check` | Live flight/train/hotel ranges |
| `/api/polls/create` + `/vote` | In-feed polls |
| `/api/sessions/:id/join` | Accept invite link |
| `/api/trips/lock` | Finalise + create share link |

Plus one no-auth: `GET /api/public/trip/:id` for the share page.

## The tech stack soundbite

> "Frontend is React 19 with Vite, Tailwind, Framer Motion, lucide-react. Backend is Node 20 with Express 5. LLM is Groq's hosted Llama 3.3 70B. Web data is Serper. Auth, Postgres, realtime, and RLS are Supabase. Hosted on Cloud Run with Cloud Build CI. One container, one URL, one deploy."

## The "why this stack?" soundbite

> "Every piece was chosen for two reasons — it has a free tier so my side project costs ₹0, and it's a tool I'm fastest in. Groq gives 500+ tokens/second on a free 70B model. Supabase replaces what would otherwise be Postgres host + Auth0 + Pusher + a vector DB. Cloud Run scales to zero so I pay only for compute when used. Total infrastructure cost today: ₹0 a month."

## The data flow soundbite

> "User types in the composer. React inserts a user message into Postgres directly using RLS, and POSTs to the backend with a structured intent. The backend runs Groq plus Serper, then inserts the deck and itinerary as rows in `public.messages`. Supabase Realtime then streams those INSERT events back to every subscribed browser. That's how multi-user collaboration works for free — Postgres is the bus."

## The RAG soundbite

> "There's no classic vector RAG yet — Groq doesn't have an embedding endpoint and I didn't want to introduce a second vendor before there was a corpus worth embedding. Instead, retrieval happens live via Serper. For destination safety, I run 2-4 Google queries and feed the snippets to a low-temperature Groq verdict prompt. Same pattern for prices and weather. The pgvector table is in the schema, ready for when I have stable corpora — locked trips, curated guide articles — that benefit from embedding."

## The realtime soundbite

> "All collaboration runs through one Supabase channel per session. I subscribe to INSERT and UPDATE events on `public.messages` plus INSERT on `public.trips`. When the backend writes an assistant row, Postgres logical replication fires, Supabase Realtime relays it over websockets, and every subscribed browser updates. RLS doubles as websocket access control — non-members can't even subscribe. No Socket.io, no Redis, no Pusher."

## The performance soundbite

> "Direct trip creation is about 15 seconds end-to-end. The fast-paths: when the user submits the modal, I skip the `parseIntent` Groq call because I already have structured values from the form — saves 1.5 seconds. Inside `buildItineraryPayload`, I run Groq and Serper concurrently with `Promise.allSettled` — saves another 600ms. Verification is deferred from deck generation to card open, so users see the deck in 6 seconds even though full verification would take 16."

## The "is it agentic?" deflection

If pushed: "Every LLM call is stateless. The control flow is hard-coded in TypeScript. No autonomy, no loops, no agent-to-agent. If I wanted to migrate to true agents, I'd swap in LangGraph nodes for the controllers and let an LLM-based planner decide which tools to call. I haven't because the current pipeline meets the product needs at a fraction of the latency and complexity."

## The "what would v2 look like?" answer

> "Cross-session personalisation via embeddings — store locked trips as vectors, retrieve similar ones for new sessions. PWA + offline cached itineraries. WhatsApp share format because India shares trips in WhatsApp groups. Real booking inventory via Skyscanner/Booking affiliate APIs. Possibly migrate to true LangGraph agents if the orchestration grows. Mem0 for cross-session preference memory."

## The honest weaknesses

If asked what you'd change:

- "The Tailwind-to-design-token migration isn't 100% complete; some inner components still hardcode Tailwind dark colors so light theme has hybrid feel."
- "No structured logging, no error tracking like Sentry. Cloud Logging is enough for a side project but not production."
- "No rate limiting. First abuse incident I'd add `express-rate-limit`."
- "Secrets in `cloudbuild.yaml` for deploys. Production would move them to Google Secret Manager."
- "No automated tests. Manual smoke tests after each deploy. I'd add Vitest + Playwright when there's a team."

Showing self-awareness about gaps is what separates senior engineers from juniors.

## Numbers to memorise

| Stat | Value |
|---|---|
| LLM | Llama 3.3 70B Versatile (Groq) |
| Tokens/sec on Groq | ~500 |
| Postgres tables | 7 |
| API endpoints | 12 |
| LLM "roles" / prompts | 8 |
| Realtime tables in publication | 3 |
| Bundle size (gzip) | ~180 KB JS, ~7 KB CSS |
| Container size | ~150 MB |
| Deploy time | ~2-3 minutes |
| Cold start time | ~2 seconds |
| Direct trip end-to-end | ~15 seconds |
| Max sessions per user (frontend cap) | 5 |
| Free tier monthly cost | ₹0 |

## Words to use vs avoid

| Use | Avoid |
|---|---|
| "LLM pipeline" | "Agentic AI" |
| "Multi-stage orchestration" | "Multi-agent system" |
| "Live web retrieval via Serper" | "RAG with vector database" (we don't have it yet) |
| "Realtime CDC over websockets" | "Custom websocket layer" |
| "Service role for privileged writes" | "Admin access" |
| "Hidden-gem bias" | "Anti-tourist algorithm" |
| "Verified by live Serper snippets" | "Verified by AI" |

## One thing to remember

If you only remember one sentence: **"It is a structured LLM pipeline behind a realtime-collaborative web app — not an agentic system, but everything I'd build for v1 of a production AI feature."**

Good luck.
