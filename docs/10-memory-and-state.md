# 10 · Memory & state

## The honest summary

AuraGo has **no agent memory**. Each LLM call is **stateless**. The "memory" people see in the product is **rows in Postgres** — nothing more.

The distinction matters for interviews. "We use Postgres as our memory" is correct; "we built a memory system for our agents" would be misleading.

## What state lives where

| Where | What | Survives a restart? | Survives a session switch? |
|---|---|---|---|
| `public.profiles` | User defaults (country, passport, preferred mode) | ✅ | ✅ |
| `public.sessions` | Current trip's prefs (mode, budget, days, route_stops) | ✅ | ✅ (per session) |
| `public.messages` | Every visible message — text, deck, itinerary, poll, chat | ✅ | ✅ (per session) |
| `public.trips` | Locked finalised plans | ✅ | ✅ (one per session) |
| `localStorage["aurago.prefs"]` | Browser-side fallback prefs | ✅ | Per device |
| `localStorage["aurago.theme"]` | Light/dark theme preference | ✅ | Per device |
| `localStorage["aurago.pendingInvite"]` | `/i/<sessionId>` survives email-verify redirect | ✅ until consumed | — |
| React state in `ChatInterface` | Composer text, modal open, sending flag | ❌ on reload | ❌ on session switch |
| Groq's context | Only what we put in the system + user prompts | ❌ | ❌ |

## What "context" the LLM sees per call

This is critical. Every LLM call is **stateless**. Groq has no memory of previous calls. We re-send everything needed each time:

### `parseIntent` call
- System prompt: extraction rules.
- User prompt: just the latest user message text.

### `generateCandidatePool` call
- System prompt: travel-planner role + hidden-gems bias + budget realism + scope brief.
- User prompt: the **structured intent object** (mode, budget_inr, party_size, days, country, has_passport).

### `buildItineraryPayload` (day-plan) call
- System prompt: itinerary schema + strict day count + budget interpretation + distance requirement.
- User prompt: destination + vibe + origin + party_size + budget + accessibility + passport line + RAG summary + access notes.

### `refineItinerary` call
- System prompt: editor role + preservation rules.
- User prompt: the **entire previous itinerary as JSON** + the user's refine instruction.

The pattern: **context = whatever we read from Postgres + whatever the user just said.** The LLM is a stateless function we feed.

## Why no agent memory framework (Mem0 / Letta)?

Frameworks like Mem0 give agents persistent semantic memory: "the user said they're vegetarian three sessions ago", "they hate cold weather", "they always tip 15%".

Today, we don't need this because:

1. **The product is session-scoped.** Each "trip" is its own session. There's no cross-session personalisation yet.
2. **Profile fields cover the universal preferences** (country, passport, mode preference, wheelchair access). Adding a "diet" field would cover another. None of these need fuzzy semantic memory.
3. **Adding Mem0 costs time + a vector store**. We chose not to until there's a clear feature that needs it.

When we add **cross-session personalisation** ("you went to Hampi last year, here's a follow-up trip"), we'll likely:
- Embed locked trips into `rag_documents` (vector + JSON metadata).
- On a new session, retrieve top-3 similar past trips and include them as context for the candidate pool.

That's still not "agent memory" in the LangChain/Letta sense — it's just retrieval. But it gives the same product experience.

## How "Back to Deck" works without server-side memory

Problem: user generates a deck (8 cards) → opens a card → reloads the page. How do we still show the deck?

Solution: `sessions.last_deck` is a `jsonb` snapshot of the most recent deck (cards + the deck message id). On page load, `ChatInterface` queries messages **plus** reads `sessions.last_deck` so the deck rehydrates even if the card was the last thing the user saw.

This is "memory" in the colloquial sense, but it's just Postgres state — not agent state.

## Session resumption — what the user sees

When a user clicks a session in the sidebar:

```
1. ChatInterface receives sessionId via props
2. useEffect loads all messages for that session:
   SELECT * FROM public.messages
   WHERE session_id = $1
   ORDER BY created_at ASC;
3. State updates → React renders the full feed
4. Realtime channel subscribes for new INSERT/UPDATE events
```

Every visible element of the chat — decks, itineraries, polls, chat messages, lock chips — is reconstructed from the `messages` table on every load. There's no server-side cache.

## Why this design holds up

| Concern | How we handle it |
|---|---|
| User refreshes — does state survive? | Yes. State is in Postgres; React re-renders from rows. |
| User opens on phone after planning on laptop | Yes. Both clients query the same Postgres rows. |
| Friend joins via invite link | Yes. They see the same rows. Realtime keeps them in sync. |
| LLM call fails — do we lose work? | Mostly no. Each row is its own commit; only the failed step's output is missing. |
| Server restarts mid-conversation | No data lost. Sessions persist. The half-finished HTTP request fails; user retries. |

The Postgres-as-source-of-truth model is **boring and correct**. It works because the product is fundamentally a "list of messages in a session" — a model the database understands natively.

## Cost of statelessness

The LLM-stateless design has one cost: **every refine call re-sends the entire current itinerary as input tokens**. For Llama 3.3 70B with a ~3 KB itinerary, that's roughly 750 input tokens per refine. At Groq's free-tier pricing, free; at paid pricing, ~$0.0003. Negligible.

If we ever move to a long-context model (Claude 200K, GPT-4o 128K) with stateful threads, we could save tokens by sending only deltas. Not worth the complexity today.

## What memory would unlock (and when we'd build it)

| Memory feature | What it enables | Trigger to build |
|---|---|---|
| Cross-session embedding store of locked trips | "Suggest similar trips to ones the user loved" | When ≥ 1k locked trips exist |
| Diet / mobility / fear preferences on profile | Auto-apply to all future plans | When users start asking us to "remember" prefs |
| Chat-message embedding for the concierge | "Last time we said X about Hampi" within one trip | When concierge usage > 10 messages per trip on average |
| Cross-user collaborative filtering | "Users who liked Spiti also planned Tawang" | Once we have 100+ users with multiple trips each |

Each of these is a clean upgrade — none break the current model. Postgres + pgvector handles all of it. No new vendor needed.

---

**Next file:** `11-end-to-end-data-flow.md` — a user types "Goa" and we trace every step from frontend to LLM and back.
