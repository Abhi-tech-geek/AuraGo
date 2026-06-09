# 15 · Performance optimizations

A 30-second wait is the perceived sweet spot for "fast" AI features. Anything longer and users abandon. This file documents the specific tricks we use to keep latency inside that budget without changing the architecture.

## The latency budget

| Workflow | Slowest path | Target | Achieved |
|---|---|---|---|
| Create deck (free text) | parseIntent + candidate pool | 12 s | ~6 s |
| Create deck (fast path, modal-submitted) | candidate pool only | 8 s | ~4 s |
| Expand card → itinerary | RAG verify + day plan + photos | 18 s | ~12 s |
| Direct trip | meta + RAG verify + day plan + photos | 20 s | ~15 s |
| Refine itinerary | one Groq call | 8 s | ~6 s |
| Re-plan weather | Serper + Groq verdict (+ refine if rejig) | 10 s | ~7 s |
| Concierge Q&A | one Groq call | 3 s | ~2 s |
| Price snapshot | 3 Serper + 1 Groq | 5 s | ~3 s |

## Trick 1: Fast-path for parseIntent

**Problem:** every `POST /api/chat/turn` started with a Groq call to parse the user's free text into structured intent. That round-trip is ~1.5 s.

**Solution:** when the user submits the BudgetModal, the frontend already has the structured values. We send them in the request body:

```js
sendTurn(promptFromPrefs(next), {
  mode: next.mode,
  budget_inr: next.budget_inr,
  party_size: next.party_size,
  days: next.days,
  origin: next.origin,
  universal_access: next.universal_access,
  country: next.country,
  has_passport: next.has_passport,
});
```

The backend checks for this body intent. If present, it skips `parseIntent`:

```js
if (bodyIntent && (bodyIntent.mode || bodyIntent.budget_inr)) {
  intent = { ...bodyIntent, ...defaults };   // use directly
} else {
  intent = await parseIntent(prompt, session); // fall back to LLM
}
```

Net savings: **~1.5 seconds per deck creation in modal flow.** Free-text flows still pay for parseIntent (rarely used today).

## Trick 2: Parallel Groq + Serper for itinerary

**Problem:** building an itinerary needs both the day-plan generation (Groq, ~10 s) and the photo gallery (Serper, ~0.6 s). Run sequentially that's ~11 s.

**Solution:** `Promise.allSettled` runs them concurrently. Both are bound by external latency; nothing in JS blocks.

```js
const [planText, photos] = await Promise.allSettled([
  groqChat(daySys, dayUser, { temperature: 0.4 }),
  serperImages(`${destination} travel ${vibe ?? ""}`.trim(), 6),
]);
```

Net savings: **~600 ms per itinerary.**

Why `allSettled` not `all`? If Serper fails (rate limit, network), we still want the day plan to succeed. `allSettled` returns per-promise success/failure so a failed photos call just gives an empty gallery.

## Trick 3: Parallel Serper queries for verification

`ragVerify` runs 2–4 Serper queries (travel advisory, weather closure, optional accessibility):

```js
const searches = await Promise.all(
  blockerQueries(dest, intent).map(serper)
);
```

`Promise.all` here because all results are needed for the Groq verdict prompt. Running them in parallel turns 4 × 600 ms = 2.4 s sequential into ~600 ms concurrent.

Net savings: **~1.8 seconds per itinerary.**

## Trick 4: Parallel Serper queries for prices

`checkPrices` runs 3 Serper queries (flight, train, hotel). Same `Promise.all` trick.

Net savings: **~1.2 seconds per refresh.**

## Trick 5: Deferred RAG verification

**Problem:** The candidate pool generates 8 destinations. If we verified each one with Serper before showing the deck, we'd run 16–32 Serper queries (~10–20 s additional latency).

**Solution:** the deck shows immediately with `_verdict: "to be verified on open"`. Verification happens when the user **opens a card** (`expandCard`). Most users only open 1–2 cards, so we save 6–7 verifications.

Net savings: **~6 seconds per deck creation**, plus a much faster perceived UX.

## Trick 6: Response is tiny — content arrives via realtime

The HTTP response of `/api/chat/turn` is just `{ ok, messageId }`. We don't send the deck back. Reasons:

- The deck row was already inserted into Postgres → realtime delivers it to the browser ~200 ms later.
- Sending the deck twice (HTTP response + realtime) doubles the bytes and could confuse local state.
- This pattern unifies single-user and multi-user flows. The same code path that updates User A's browser also updates User B's.

There's no real latency saving but the design is cleaner.

## Trick 7: Cap Groq tokens with concise prompts

We've kept system prompts under ~2 KB. Llama 3.3 on Groq processes input tokens fast, but a 10 KB system prompt would cost real seconds.

Tactics:
- No few-shot examples for the full itinerary.
- No chain-of-thought preamble.
- JSON shape shown once, not described twice.
- No persona scripting beyond the role line.

See `08-prompt-engineering.md` for the full prompt design philosophy.

## Trick 8: Hard-enforce day count after the fact

The day-plan prompt says "EXACTLY N days". The LLM usually obeys, but we don't trust it 100%. Post-LLM we trim/pad:

```js
let dayPlan = Array.isArray(plan.days) ? plan.days.slice(0, numDays) : [];
while (dayPlan.length < numDays) {
  dayPlan.push({ day: dayPlan.length + 1, title: "...", activities: [...] });
}
dayPlan = dayPlan.map((d, i) => ({ ...d, day: i + 1 }));
```

This converts an LLM correctness problem into a deterministic post-processing step. Saves ~1 retry round-trip in the rare case the LLM over/undershoots.

## Trick 9: Realtime UPDATE (not just INSERT)

**Problem:** poll votes mutate an existing row's `payload.votes`. Without UPDATE subscription, browsers wouldn't see new votes until refresh.

**Solution:** subscribe to UPDATE events too:

```js
.on("postgres_changes",
    { event: "UPDATE", schema: "public", table: "messages",
      filter: `session_id=eq.${sessionId}` },
    (p) => setMessages(prev =>
      prev.map(x => x.id === p.new.id ? { ...x, ...p.new } : x)))
```

This makes the poll bar charts update live. Same mechanism could broadcast other field mutations later.

## Trick 10: Frontend optimistic insert

When the user sends a turn, we insert the user message into Postgres AND append it to local state immediately. The realtime echo of the same INSERT is deduped:

```js
prev.some(x => x.id === userMsg.id) ? prev : [...prev, userMsg]
```

No spinner, no flash, no delay between keystroke and bubble. Perceived latency drops to zero for the user's own message.

## Trick 11: Vite's deck-scroll uses native scroll-snap

We thought about implementing virtualised lists for very long sessions. Profiling showed the bottleneck wasn't the React tree — it was layout, mainly from the horizontal deck scroller. Switching to `scroll-snap-type: x mandatory` lets the browser handle snapping natively, no JS scroll listeners needed.

(Even after the Terminal redesign moved the deck to a vertical board, this technique is still used in the welcome rail and photo gallery.)

## Trick 12: Photo gallery uses thumbnails first

Serper returns both `imageUrl` and `thumbnailUrl`. We use the thumb in the gallery and only fetch the full-res when the user opens the lightbox. Saves several MB of unused bandwidth.

## Trick 13: Lazy load photos

```jsx
<img loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
```

The browser only loads photos that come into the viewport. Critical for long itineraries with 6+ gallery shots.

## Trick 14: One Supabase channel per session

We could subscribe to "all messages I can see across all sessions" in one channel. That would broadcast every event everywhere, even sessions the user isn't viewing.

Instead, `ChatInterface` mounts a new channel filtered to the current `sessionId`. When the user switches sessions, the old channel is removed and a new one is opened.

This keeps payload sizes proportional to what's actually visible.

## What we don't optimise (yet)

| Optimization | Why not |
|---|---|
| Code splitting the React bundle | 640 KB minified is fine; we'll split when it hits 1 MB |
| Server-side rendering | SPA UX is fine; SSR would complicate Cloud Run deploy |
| HTTP/2 push or preloading | Cloud Run handles HTTP/2 by default |
| Edge caching the React bundle | Cloud Run's static serving is fast enough |
| Compressed prompts (LLM-side) | Llama 3.3 doesn't expose compression hooks; nothing to do |
| Streaming the LLM output | Groq supports it; we don't because we need the full JSON before parsing |
| Cached Serper results | Adds complexity; Serper is already fast |

## Latency budget summary

For the most expensive endpoint — direct trip creation — the budget looks like:

```
HTTP request → /api/chat/direct                    20 ms
Express requireAuth (Supabase JWT check)           60 ms
Load session row                                  100 ms
Groq meta (1-card vibe + score)                ~2000 ms
INSERT mystery_deck row                           120 ms
ragVerify (4 Serper + Groq verdict)            ~3000 ms
Promise.allSettled(Groq dayplan + Serper photos) ~9500 ms (parallel)
Trim/pad days                                       0 ms
INSERT itinerary row                              120 ms
Return tiny JSON                                   30 ms
                                                ───────────
Total backend time:                              ~15 s
+ Realtime delivery to browser:                  ~250 ms
+ React render:                                   ~50 ms
                                                ───────────
Perceived total:                                 ~15-16 s
```

That's tolerable. The user sees a sliding loading state and 15 seconds later a full plan appears. Compared to manually researching 8 destinations, it's magic.

## What would let us cut this further

- **Streaming JSON output** from Groq with progressive UI rendering. Would need a custom JSON parser. Saves perceived (not actual) time.
- **Pre-warming Cloud Run** with min-instances=1. Saves cold-start time (~3 s) but costs ₹150/month.
- **Skipping ragVerify on the first card** the user opens. Show a "verifying…" chip then update on completion. Saves ~3 s upfront.
- **Smaller / faster model** for the meta card synthesis. Llama 3.1 8B is 5× faster and the vibe/score blurb doesn't need huge intelligence.

None of these are necessary today. They're available if traffic ever justifies them.

---

**Next file:** `16-future-improvements.md` — what AuraGo v2 looks like and when each piece becomes worth building.
