# 00 · Overview — What is AuraGo, really?

## The one-line pitch

**AuraGo is an AI-powered travel discovery web app.** You describe a vibe ("budget weekend from Bangalore") or a place ("Spiti Valley"), and within ~30 seconds you get **eight verified hidden-gem destinations** with full day-by-day itineraries, live weather, price snapshots, and shareable links you can plan with friends in real time.

## What you DO see when you use it

1. **Auth screen** → sign in / sign up.
2. **Welcome screen** → choose "Surprise me" or "I know where".
3. **Open the trip preferences modal** → enter style (Sasta/Elite), home country, passport status, party size, days, date, budget.
4. **Wait ~30 seconds** → 8 destinations appear on a "departures board" (split-flap board, each row is a destination).
5. **Tap a row** → expands into a "boarding pass" with map, weather, prices, day-by-day timeline, stays, packing, booking links, similar gems, totals.
6. **Optionally:**
   - Refine the plan with chips ("make it cheaper", "Indoor Day 2", etc.).
   - Re-plan around weather (Serper checks live forecast).
   - Invite friends → realtime collaboration, in-trip chat, polls.
   - Lock the trip → shareable public read-only link.

## What is AuraGo classified as?

This is the most important question for interviews. The honest answer:

> **AuraGo is an LLM-orchestrated full-stack web application.**
> It is **not** a multi-agent system, and **not** an autonomous agent.
> It is best described as **"structured multi-step LLM orchestration"** behind a normal client–server web app.

### Why it is NOT agentic AI

A true **agentic system** has at least these traits:

| Trait | AuraGo |
|---|---|
| Autonomous goal-directed loops | ❌ No loops. Every LLM call is triggered by a specific HTTP endpoint that the user (or frontend) hit. |
| Tools the agent decides to invoke | ❌ The backend decides which prompts to run, in which order. The LLM only fills in JSON. |
| Memory across sessions / decisions | ❌ No agent memory store. Postgres holds user data, not agent thoughts. |
| Agent-to-agent communication | ❌ No agents talk to each other. There's one LLM (Groq Llama 3.3 70B), called multiple times with different prompts. |
| Planning / re-planning on failure | ❌ Failures fall back to defaults, not new plans. |

### Why it is NOT a multi-agent system

A multi-agent system would have, e.g., a "planner agent", a "critic agent", a "researcher agent" — each running independently, talking to each other, possibly using different models. AuraGo has **one model** called from **one backend** with **eight different system prompts**. Those prompts are roles, not agents.

### Then what IS it?

It's a **prompt-orchestrated AI feature inside a normal web app**. Compared to industry vocabulary:

- **Like:** ChatGPT-style "custom GPTs", structured-output LLM pipelines, RAG chatbots.
- **Unlike:** AutoGPT, LangGraph multi-agent flows, CrewAI, BabyAGI, OpenAI Assistants v2 with tool use.

The reason this distinction matters: in an interview, calling AuraGo "agentic" sets an expectation you can't defend. Calling it "structured LLM orchestration with live web verification" is **accurate, defensible, and still impressive** — most production AI features in industry today are this kind of system.

## The honest tech summary

- **Frontend:** React 19 (Vite), TailwindCSS, Framer Motion, lucide-react, supabase-js.
- **Backend:** Node 20 + Express 5, single service. No microservices, no queue, no worker pool.
- **LLM:** Groq's hosted Llama 3.3 70B Versatile (OpenAI-compatible API). Called via `fetch`, no LangChain.
- **Live web data:** Serper.dev (Google Search API) — used for both fact-checking destinations and grabbing photo URLs.
- **Database:** Supabase Postgres — auth, RLS, realtime channels, file storage available.
- **Vector DB:** Postgres `pgvector` extension is **installed and a `rag_documents` table exists, but it is currently unused** because Groq doesn't offer an embedding endpoint and we haven't wired a separate embedding provider. See `09-rag-and-retrieval.md` for the full honest picture.
- **Hosting:** Google Cloud Run (single containerised service serving both API and static React build).
- **CI/CD:** Cloud Build (`cloudbuild.yaml`) triggered manually with `gcloud builds submit`.

## Why this honesty matters

When someone asks "did you build an agentic AI?", saying:

> "I built a multi-stage LLM orchestration pipeline behind a real-time collaborative travel-planning web app. There are eight specialised prompts the backend runs in a deterministic sequence — destination generation, day-plan generation, refinement, weather replanning, price scraping, Q&A, two roles that talk to Serper for live verification. There are no autonomous loops or agent-to-agent calls today; that's on the roadmap if it provides real value."

…sounds **far more senior** than saying "I built an agentic AI travel app". Interviewers can tell when terminology is being used loosely.

## What problems does it solve?

1. **Decision paralysis** — instead of researching 10 places, you get 8 vetted ones.
2. **Goa/Manali fatigue** — explicit prompt bias toward *hidden gems* (Spiti, Ziro, Majuli, Hampi, Chettinad…) and away from the top-5 touristy clichés.
3. **Budget realism** — total budget includes round-trip transport, and a hard "feasibility gate" hides international suggestions when the budget can't actually pay for them.
4. **Group planning** — invite link, realtime chat drawer, in-feed polls — friends can plan together without leaving the app.

## What it does NOT try to be

- Not a booking engine. Outbound links go to Skyscanner/Booking/MakeMyTrip etc. We don't take payments.
- Not an OTA. We don't aggregate inventory.
- Not a flight aggregator. The price snapshot is AI-extracted from Google snippets, not a live GDS feed.
- Not a marketplace. Local guides links go to GetYourGuide/Viator/Withlocals — we don't run a guide network.

Knowing what AuraGo is NOT is just as important as knowing what it is — it keeps the scope honest in conversations.

---

**Next file:** `01-architecture-big-picture.md` — diagrams every component and the data direction between them.
