# 06 · AI "agents" explained

This file is critical. It tells you the **honest truth** about what's running inside AuraGo's AI layer, and gives you the right words to describe it.

## TL;DR

**AuraGo has zero true agents.** It has **one LLM (Llama 3.3 70B via Groq) called eight different ways**, each with a different system prompt that gives it a different role. The backend decides the order of calls. There is no autonomy, no agent-to-agent communication, no tool use, no memory.

In interview-grade vocabulary: **"AuraGo uses a single LLM in a multi-prompt orchestration pipeline."**

The word "agent" appears in product copy because it sounds friendly. Internally, treat each "role" as **just a function with a specialised system prompt**.

## The eight roles

| # | Role name (the function in code) | Job | System prompt summary | Temperature |
|---|---|---|---|---|
| 1 | `parseIntent` | Extract structured fields from a free-text user message | "From this message, return JSON with mode, budget_inr, party_size, universal_access, must_haves, avoid." | 0.1 |
| 2 | `generateCandidatePool` | Generate 8 hidden-gem destinations matching the user's constraints | "You are a global travel planner. Bias toward hidden gems. Domestic-only if no passport. Split 5+3 if passport. Return JSON array of 8." | 0.75 |
| 3 | `ragVerify` | Decide if a destination is currently safe to recommend | "Given this destination + live Serper snippets, return verdict (pass/hazard/blocked) with reason." | 0 |
| 4 | `buildItineraryPayload` (day-plan) | Generate the full N-day itinerary | "Build a JSON itinerary with days, stays, packing, weather, similar destinations. Match the budget. Honour multi-stop." | 0.4 |
| 5 | `refineItinerary` | Edit an existing itinerary based on a user instruction | "Rewrite this itinerary per the instruction. Keep destination + vibe + dates unchanged." | 0.4 |
| 6 | `replanWeather` | Decide if weather requires re-planning | "Given destination + Serper forecast snippets, return verdict and a refine instruction if rejig needed." | 0.1 |
| 7 | `checkPrices` | Extract price ranges from Serper search snippets | "From these snippets, extract flight/train/hotel INR ranges. Return JSON." | 0 |
| 8 | `chatQA` | Answer freeform user questions about an open itinerary | "Friendly concierge. Be concise (3-6 sentences). Use the trip context. Return { answer }." | 0.5 |

All eight use the same model: `llama-3.3-70b-versatile`.

## "Agent" vs "role" — why we're careful

| If we had agents | What AuraGo actually has |
|---|---|
| Multiple LLM instances running concurrently with their own memory | One LLM, called sequentially by an HTTP handler |
| Agents that decide when to call each other ("planner → critic → executor") | A hard-coded order in the backend: parseIntent → candidate pool → verify → itinerary |
| Tool selection ("should I call the weather API or the maps API?") | The backend already knows which APIs to call |
| Loops that continue until a goal is met | One pass through the pipeline per HTTP request |
| Cross-session memory ("the user told me 3 trips ago they hate Goa") | No memory — only what's in the current session's Postgres rows |

If an interviewer pushes back ("but isn't every LLM call an agent?"), the precise answer is:

> "Each call is a stateless prompt with a strict JSON contract. There's no autonomy or tool routing — the orchestration logic lives in plain TypeScript/JS, not in the model. So I'd call it a multi-stage LLM pipeline rather than an agent system."

## How the roles are triggered

| User action | Which roles run, in what order |
|---|---|
| Submits modal in Surprise mode → `POST /api/chat/turn` | `parseIntent` (skipped if intent was sent structured) → `generateCandidatePool` → 8 cards inserted |
| Taps a card → `POST /api/chat/expand-card` | `ragVerify` (per Serper snippets) → `buildItineraryPayload` (Groq + Serper images in parallel) |
| Direct mode → `POST /api/chat/direct` | Same as expand-card but for a user-named destination, with a small Groq call to invent the vibe + score |
| Clicks "Make it cheaper" chip → `POST /api/chat/refine` | `refineItinerary` |
| Clicks "Re-plan around weather" → `POST /api/chat/replan-weather` | `replanWeather` (verdict) → if rejig, internally calls `refineItinerary` with the suggested instruction |
| Refreshes the price card → `POST /api/prices/check` | `checkPrices` (Serper × 3 + Groq extraction) |
| Asks Concierge a question → `POST /api/chat/qa` | `chatQA` |

The full step-by-step is in `07-orchestration-and-workflows.md`.

## What controls what?

The **Express controller is the orchestrator.** It picks which prompts to run, in which order, and with which Serper enrichment.

The LLM never picks the next step. The LLM only:
1. Reads a system prompt + a user prompt.
2. Returns a JSON object matching the requested schema.
3. Forgets the conversation. (Each call is stateless — see `10-memory-and-state.md`.)

This is **why we can call it an "LLM pipeline"** instead of "agentic" — the control flow is in code, not in the model's head.

## Where data comes from and where it goes

For a single `chatTurn` call:

```
HTTP body
  prompt: "weekend trip from mumbai under 30k"
  intent: { mode, budget_inr, party_size, days, country, has_passport, origin }
  sessionId
                │
                ▼
   load session row from public.sessions
                │
                ▼
   parseIntent (skip if intent already structured)
                │
                ▼  intent object
   generateCandidatePool(intent)
                │
                ▼  array of 8 candidate cards
   ragVerify SKIPPED here — deferred to expandCard
                │
                ▼
   sort by ai_value_score, take top 8
                │
                ▼  cards array with ids
   INSERT INTO public.messages (kind='mystery_deck', payload={ cards, intro }, ...)
                │
                ▼
   { ok: true, messageId } sent back to caller

Meanwhile via realtime:
   Postgres → Supabase realtime → all subscribed browsers
       in this session render the deck.
```

For `expandCard` it's:

```
HTTP body
  sessionId, deckMessageId, cardId, startDate
                │
                ▼
   load deck row, find the card by id
   load session row
                │
                ▼
   buildItineraryPayload({ destination, vibe, est_cost_inr, intent, startDate })
       │
       ├─→ ragVerify({ destination, intent })
       │      │
       │      ├─→ Serper × 2 queries (advisory, weather closure)
       │      │
       │      └─→ Groq (verdict prompt) → { verdict, reason, summary, citations }
       │
       └─→ Promise.allSettled([
              Groq (day-plan prompt)            ← itinerary JSON
              Serper images                    ← 6 photo URLs
           ])
                │
                ▼  payload with days, stays, packing, weather, photos, est_distance_km
   INSERT INTO public.messages (kind='itinerary', parent_message_id=deckMsgId, payload, ...)
                │
                ▼
   { ok: true, messageId } sent back

Realtime fires; browsers expand the itinerary inline.
```

## Why no agent memory?

Because everything we need to remember is **already in Postgres**.

- The user's profile (default mode, country, passport) lives in `public.profiles`.
- The session's current state (budget, days, mode, route stops) lives in `public.sessions`.
- The full conversation lives in `public.messages`.

When a controller needs context, it `SELECT`s from Postgres. There's no "vector memory" because we're not searching unstructured agent observations — we're loading structured rows.

The day we add **cross-session personalisation** ("the user mentioned they hate spicy food two trips ago"), we'll need either a long-term embedding store (`pgvector`) or a memory framework like Mem0. See `16-future-improvements.md`.

## How agents would look if we actually built them

If we re-architected AuraGo as a true multi-agent system, here's what would change:

| Concern | Today (LLM pipeline) | Tomorrow (agents) |
|---|---|---|
| Step ordering | Hard-coded in JS | LLM-decided via a routing prompt |
| Failure recovery | Try/catch with defaults | "Critic agent" reviews + retries |
| Memory | Postgres row reads | Mem0 / Letta long-term memory |
| Tool use | We call Serper for the LLM | LLM has a "search" tool it invokes itself |
| Framework | None — plain `fetch` | LangGraph, CrewAI, or custom |

We didn't build that because:
- The LLM pipeline already gives 95% of the perceived intelligence.
- Agent frameworks add latency and observability difficulty.
- We can swap in agents per-endpoint when there's a concrete reason (e.g., the refine endpoint becomes adaptive).

---

**Next file:** `07-orchestration-and-workflows.md` — the precise sequence of LLM and Serper calls for every endpoint.
