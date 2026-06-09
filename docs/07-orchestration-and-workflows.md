# 07 · Orchestration & workflows

This file walks through the exact sequence of operations for each AuraGo workflow. If `06-ai-agents-explained.md` is "what are the roles?", this file is "how do they get used together?".

## Vocabulary

- **Orchestrator** — the Express controller. It decides which LLM calls happen and in what order.
- **Step** — a single LLM or Serper call.
- **Fan-out** — parallel calls via `Promise.allSettled`.
- **Side-effect** — a Postgres write or a row inserted into `public.messages` (which triggers realtime).

## Workflow 1: Surprise mode — generate a deck

**Entry point:** `POST /api/chat/turn`
**Controller:** `chatTurn`

```
Step 1  load public.sessions row for sessionId         (Postgres)
Step 2  if body.intent provided → use directly         (skip Groq)
        else                    → parseIntent (Groq)
Step 3  persist resolved intent into the session row   (UPDATE sessions)
Step 4  generateCandidatePool(intent)                  (Groq)
Step 5  sort by ai_value_score, top 8                  (in memory)
Step 6  build deck card payload (one row per card)     (in memory)
Step 7  INSERT messages (kind='mystery_deck', payload) (Postgres)
Step 8  UPDATE sessions.last_deck snapshot             (Postgres)
Step 9  return { ok, messageId } HTTP                  → browser updates via realtime
```

Latency budget:

- Fast path (intent provided): **~3–5 s** total — one Groq call for the candidate pool.
- Slow path (free text): **~5–7 s** — adds the `parseIntent` round trip.

This is why we built the fast-path optimization (see `15-performance-optimizations.md`).

## Workflow 2: Expand a card → full itinerary

**Entry point:** `POST /api/chat/expand-card`
**Controller:** `expandCard`

```
Step 1  load deck message, find card by cardId          (Postgres)
Step 2  load session row                                (Postgres)
Step 3  buildItineraryPayload({ destination, vibe, ... })
        │
        ├─ Step 3a  ragVerify({ destination, intent })
        │            │
        │            ├─ Serper × 2-4 (advisory + accessibility)
        │            └─ Groq (verdict prompt, temp 0)
        │
        └─ Step 3b  Promise.allSettled([
               Groq (day-plan prompt, temp 0.4),
               Serper (destination images, num=6)
             ])
Step 4  Enforce exactly N day entries (trim/pad)         (in memory)
Step 5  Compose payload — days, stays, packing, weather,
        photos, est_distance_km, similar_destinations    (in memory)
Step 6  INSERT messages (kind='itinerary', parent_message_id=deckMsgId, payload)
Step 7  Return { ok, messageId }
```

Latency budget: **~12–18 s** total.

Why so long? Because two slow steps run sequentially:

1. RAG verify (~3 s) — Serper × 2 + Groq verdict.
2. Day plan + images (~10 s) — the big Groq generation. Images run in parallel and are usually quicker, so they don't dominate.

In `15-performance-optimizations.md` we discuss the `Promise.allSettled` trick we use for step 3b. It saves ~600 ms.

## Workflow 3: Direct mode (user named a destination)

**Entry point:** `POST /api/chat/direct`
**Controller:** `directTrip`

Same as Workflow 1 + 2 fused, but skips the candidate pool. Instead:

```
Step 1  Quick Groq call to invent a vibe + score + blurb for the named destination
Step 2  Synthesize a "1-card deck" (so the UI flow stays consistent)
Step 3  INSERT mystery_deck message with a single card
Step 4  Run the full itinerary build (Workflow 2's Step 3 onwards)
Step 5  INSERT itinerary message tied to the deck
Step 6  Return { ok, deckMessageId, itineraryMessageId, cardId }
```

Latency: **~15–20 s** total — slightly more than expand-card because it's a deck + itinerary.

## Workflow 4: Refine an existing itinerary

**Entry point:** `POST /api/chat/refine`
**Controller:** `refineItinerary`

```
Step 1  load itinerary message            (Postgres)
Step 2  Groq (refine prompt) with the existing payload as context
Step 3  merge new fields into old payload (preserve photos, route_stops, citations, etc.)
Step 4  INSERT new itinerary message (parent_message_id = original deck's id)
        — keeps the old itinerary visible for compare/revert
Step 5  Return { ok, messageId }
```

Latency: **~6–10 s** total — one Groq call.

This is what powers the "Make it cheaper", "Indoor Day 2", "More photo spots" chip refinements.

## Workflow 5: Re-plan around weather

**Entry point:** `POST /api/chat/replan-weather`
**Controller:** `replanWeather`

```
Step 1  load itinerary message            (Postgres)
Step 2  Serper "destination weather forecast {date}"
Step 3  Groq (verdict prompt) — decides
        {
          verdict: "ok" | "rejig",
          reason: "...",
          instruction: "Make Day 2 indoor — rain expected"
        }
Step 4  if verdict='ok'    → return { ok, changed: false, reason }
        if verdict='rejig' → forward to refineItinerary controller with the suggested instruction
                            → returns the new itinerary's messageId
Step 5  Return { ok, changed: true, messageId } or { ok, changed: false, reason }
```

Latency: **~7–12 s** if it triggers a rejig (because the inner refine call adds its own time).

This is **the cleanest example** of a multi-step orchestration in AuraGo: Serper informs Groq, Groq decides, decision triggers an internal API call.

## Workflow 6: Price snapshot

**Entry point:** `POST /api/prices/check`
**Controller:** `checkPrices`

```
Step 1  Promise.all([
          Serper "origin to destination flight price"
          Serper "origin to destination train price"
          Serper "destination hotel price per night"
        ])
Step 2  Compose snippets text
Step 3  Groq (price extraction prompt, temp 0) → JSON with flight/train/hotel ranges
Step 4  Return { ok, checked_at, prices }
```

Latency: **~3–4 s**. Three Serper calls in parallel + one Groq extraction.

Note: this is not stored in Postgres. The frontend caches the result locally — it's a "live snapshot" the user refreshes on demand.

## Workflow 7: Concierge Q&A

**Entry point:** `POST /api/chat/qa`
**Controller:** `chatQA`

```
Step 1  Groq (concierge prompt) with destination + vibe + weather + days as context
Step 2  Return { ok, answer }
```

Latency: **~2–3 s**. Single Groq call, no Postgres write — the concierge messages live in React state inside the drawer.

## Workflow 8: Polls

### Create
**Entry point:** `POST /api/polls/create`

```
Step 1  Validate question + 2-6 options
Step 2  Generate stable option IDs ("o1", "o2", ...)
Step 3  INSERT messages (kind='poll', payload={ question, options, votes:{}, created_by })
Step 4  Return { ok, messageId }
```

### Vote
**Entry point:** `POST /api/polls/vote`

```
Step 1  load poll message              (Postgres)
Step 2  verify the option_id exists
Step 3  verify the user is a member of the session
Step 4  payload.votes[userId] = optionId
Step 5  UPDATE messages SET payload = ... WHERE id = ...
Step 6  Return { ok }
```

Then **realtime UPDATE** event fires on the messages table → every subscribed browser sees the new vote tally → the bar chart animates.

## Workflow 9: Invite + join

### Create invite link
The frontend just builds `${origin}/i/${sessionId}`. No backend call.

### Accept invite
**Entry point:** `POST /api/sessions/:id/join`

```
Step 1  load session row to confirm it exists
Step 2  if user is the owner → return early with role='owner'
Step 3  upsert a row into session_participants (idempotent on PK conflict)
Step 4  upsert a profiles row for the user (in case auth created without trigger)
Step 5  Return { ok, role, sessionId, title }
```

Triggered automatically by `App.jsx` when the URL matches `/i/<uuid>` after auth.

## Workflow 10: Lock a trip

**Entry point:** `POST /api/trips/lock`

```
Step 1  load the itinerary message
Step 2  INSERT trips row (whole payload denormalised in)
        — unique index on (session_id, status='locked') prevents double-lock
Step 3  UPDATE sessions.title = destination
Step 4  Return { ok, tripId }
```

This is the most "boring" workflow — no LLM, no Serper. Just data movement.

## What controls what

Across all ten workflows, the pattern is identical:

1. **Express controller** receives the request.
2. Controller reads needed rows from Postgres.
3. Controller orchestrates 0–3 LLM calls and 0–4 Serper calls.
4. Controller writes 0–2 rows to Postgres.
5. Controller returns a tiny JSON ack.
6. Realtime (or the response) updates the frontend.

The LLM **never** picks the next step. The orchestrator code does.

That's what we mean when we say "multi-stage LLM orchestration" instead of "agent system".

---

**Next file:** `08-prompt-engineering.md` — the prompts themselves, the JSON contracts, and why we structure them this way.
