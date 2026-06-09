# 11 · End-to-end data flow — one trip, every step

This file follows **one user, one request**, from the moment they type "Spiti Valley" until the itinerary appears on screen. Every hop is documented. If you read only this file plus the overview, you can already explain AuraGo to anyone.

## The scenario

- The user signed in earlier. Their browser holds a Supabase JWT.
- They're on the welcome screen.
- They click "I know where", type **Spiti Valley**, and hit send.

We'll trace from that keystroke to the rendered itinerary.

---

## Hop 1 — Browser captures input

`ChatInterface.handleSendInput`:

```js
const text = input.trim();          // "Spiti Valley"
if (composerMode === "direct") {
  setPendingDestination(text);      // store the destination
  setModalOpen(true);               // open BudgetModal
}
```

The destination is held in React state. The BudgetModal opens with `destinationHint="Spiti Valley"`.

## Hop 2 — User confirms the modal

The user picks party_size=2, days=4, mode=sasta, budget=₹30k, origin=Delhi, has_passport=false.
They hit "Plan Spiti Valley →".

`BudgetModal.onSubmit` fires with a `next` object:
```js
{
  mode: "sasta",
  country: "India",
  has_passport: false,
  origin: "Delhi",
  destination: "Spiti Valley",
  party_size: 2,
  days: 4,
  start_date: "",
  budget_inr: 30000,
  universal_access: false,
  route_stops: []
}
```

`ChatInterface.handleModalSubmit` receives it, persists it to React + localStorage, then calls `sendDirect("Spiti Valley", next)` because `next.destination` is set.

## Hop 3 — Optimistic message + DB insert (browser → Postgres)

Inside `sendDirect`:

```js
// 1) Insert a user-role message into Postgres directly (RLS allows it).
const { data: userMsg } = await supabase.from("messages").insert({
  session_id: sessionId,
  author_id: currentUser.id,
  role: "user",
  kind: "text",
  content: "Plan Spiti Valley for me",
}).select().single();

// 2) Append it to local state immediately for instant UI feedback.
setMessages(m => [...m, userMsg]);
```

The realtime channel will also re-fire this INSERT, but our dedupe (`prev.some(x => x.id === p.new.id)`) skips it.

## Hop 4 — Browser → Backend (POST /api/chat/direct)

```js
const { data: authData } = await supabase.auth.getSession();
const token = authData?.session?.access_token;       // Supabase JWT

const r = await fetch("/api/chat/direct", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    sessionId,
    destination: "Spiti Valley",
    startDate: null,
    intent: {
      mode: "sasta",
      budget_inr: 30000,
      party_size: 2,
      days: 4,
      origin: "Delhi",
      universal_access: false,
      country: "India",
      has_passport: false,
      route_stops: [],
    },
  }),
});
```

## Hop 5 — `requireAuth` middleware verifies the JWT

Express's `requireAuth` middleware:

```js
const { data, error } = await supabase.auth.getUser(token);
if (error || !data?.user) return res.status(401);
req.user = data.user;       // { id: "uuid-of-user", email: "..." }
next();
```

A round-trip to Supabase Auth verifies the token signature. Request continues.

## Hop 6 — `directTrip` controller starts (backend)

```js
export async function directTrip(req, res) {
  const { sessionId, destination, startDate, intent: bodyIntent } = req.body;
  const userId = req.user.id;

  // 1) Load the session row (service role bypasses RLS)
  const { data: session } = await supabase.from("sessions")
    .select("*").eq("id", sessionId).single();
```

Now the controller has:
- The structured `intent` from the body (party size, days, budget, etc.).
- The persisted `session` row (in case fields are missing).

## Hop 7 — Build the resolved intent

```js
const intent = {
  mode: bodyIntent?.mode ?? session.mode ?? "elite",
  budget_inr: bodyIntent?.budget_inr ?? session.budget_inr ?? 50000,
  party_size: bodyIntent?.party_size ?? session.party_size ?? 2,
  days: bodyIntent?.days ?? session.days ?? 4,
  origin: bodyIntent?.origin ?? session.origin ?? "",
  universal_access: bodyIntent?.universal_access ?? session.universal_access ?? false,
  country: bodyIntent?.country ?? session.country ?? "India",
  has_passport: bodyIntent?.has_passport ?? session.has_passport ?? false,
  route_stops: bodyIntent?.route_stops ?? session.route_stops ?? [],
  must_haves: [], avoid: [],
};
```

Then persist this back to the session row so subsequent operations are consistent:

```js
await supabase.from("sessions").update({
  mode: intent.mode,
  budget_inr: intent.budget_inr,
  party_size: intent.party_size,
  days: intent.days,
  universal_access: intent.universal_access,
  country: intent.country,
  has_passport: intent.has_passport,
  route_stops: intent.route_stops,
}).eq("id", sessionId);
```

## Hop 8 — Synthesize a one-card "deck" for UI consistency

The product UX always shows a deck → card → itinerary flow. For direct mode we shortcut this with a one-card deck. We ask Groq for a quick vibe + score for Spiti Valley:

```js
const sys = `Return JSON only describing this destination as a card:
{
 "vibe": "<2-3 word vibe>",
 "ai_value_score": <number 1-10>,
 "est_cost_inr": <int>,
 "blurb": "<<= 100 chars one-line vibe>",
 "hint_category": "<one of: mountain, beach, ...>"
}`;

const meta = json(await groqChat(sys,
  "Destination: Spiti Valley\nMode: sasta\nBudget: ₹30000\nParty size: 2",
  { temperature: 0.4 }));

// Groq returns something like:
// { vibe: "High Desert", ai_value_score: 9.3, est_cost_inr: 18000,
//   blurb: "Cold-desert silence, dust-yellow monasteries, zero wifi.",
//   hint_category: "mountain" }
```

We assemble a fake `card` object and insert it as a `mystery_deck` row with one card:

```js
const cardForDeck = { id: cryptoRandomId(), ...meta,
                      _destination: "Spiti Valley", accessibility_ok: true };

const { data: deckMsg } = await supabase.from("messages").insert({
  session_id: sessionId,
  role: "assistant",
  kind: "mystery_deck",
  content: "Here's a custom plan for Spiti Valley.",
  payload: { intro: "...", cards: [cardForDeck], direct: true },
}).select().single();
```

## Hop 9 — Build the full itinerary

The big function: `buildItineraryPayload`.

```js
const payload = await buildItineraryPayload({
  destination: "Spiti Valley",
  vibe: "High Desert",
  est_cost_inr: 18000,
  card_id: cardForDeck.id,
  intent,
  startDate: null,
});
```

Inside that function:

```
Step 9a) ragVerify({ destination: "Spiti Valley", intent })
         │
         ├─ Serper × 2  (advisory + closure)
         │    returns ~6 snippets: title, snippet, link, date
         │
         └─ Groq (verdict, temp 0)
              system: "You are AuraGo's QA Agent. Decide if SAFE..."
              user:   "DESTINATION: Spiti Valley
                       LIVE WEB SNIPPETS:
                       (1) Best time to visit Spiti — Tribuneindia.com — May-Oct...
                       (2) Spiti road closures Jan 2026 — IndiaTimes — ..."
              returns: { verdict: "pass", reason: "open season May-Oct",
                         summary: "Spiti is open and accepting travellers from June.",
                         citations: [url, url] }

Step 9b) Promise.allSettled([
           Groq (day-plan, temp 0.4)
              system: huge itinerary schema with day count rule + budget rule
              user:   "Destination: Spiti Valley (High Desert)
                       Origin: Delhi
                       Days: 4 (MUST match exactly)
                       Party size: 2
                       Total budget: ₹30000
                       Stay within India only — no passport."
              returns: {
                days: [
                  { day:1, title:"Arrival, Manali → Spiti road", activities:[…] },
                  { day:2, title:"…", activities:[…] },
                  { day:3, title:"…", activities:[…] },
                  { day:4, title:"Return + memory", activities:[…] }
                ],
                estimated_cost_inr: 12000,
                est_distance_km: 720,
                weather: {summary:"Sunny days, freezing nights -5 to 12°C", ...},
                stays: [{name:"…", price_per_night_inr:1800, ...}, …],
                packing: ["Heavy down jacket", "Sunscreen SPF 50", ...],
                similar_destinations: [{name:"Lahaul", ...}, ...]
              },
           Serper images("Spiti Valley travel", num=6)
              returns: 6 photo URLs
         ])

Step 9c) Trim/pad days to exactly 4 entries  (defensive)
Step 9d) Compose final payload object combining all of the above
```

Total time at this point: ~12 seconds.

## Hop 10 — Insert the itinerary message

```js
const { data: itinMsg } = await supabase.from("messages").insert({
  session_id: sessionId,
  role: "assistant",
  kind: "itinerary",
  parent_message_id: deckMsg.id,
  content: "Itinerary for Spiti Valley",
  payload: { card_id: cardForDeck.id, destination: "Spiti Valley",
             days: [...], weather: {...}, stays: [...], packing: [...],
             est_distance_km: 720, photos: [...], ... },
}).select().single();
```

## Hop 11 — Backend responds to the HTTP call

```js
return res.json({
  ok: true,
  deckMessageId: deckMsg.id,
  itineraryMessageId: itinMsg.id,
  cardId: cardForDeck.id,
});
```

That tiny JSON is what the frontend's `fetch` promise resolves with. **It doesn't contain the itinerary itself.**

## Hop 12 — Realtime delivers the actual content

Meanwhile, two `INSERT` events fired on the `messages` table — one for the deck, one for the itinerary. Supabase Realtime relays them over websockets to every subscriber.

```
Postgres logical replication
       │
       ▼
Supabase Realtime server
       │
       ▼ websocket frame
Browser's open channel `session:${sessionId}`
       │
       ▼
.on("postgres_changes", { event: "INSERT", table: "messages", ... }, callback)
       │
       ▼
setMessages(prev => [...prev, newRow])
       │
       ▼
React re-renders
```

The deck row appears as a departures board (with the one card). The itinerary row appears expanded under it because `App.jsx`'s `sendDirect` also called `setOpenCard({ [deckMessageId]: cardId })`.

## Hop 13 — The boarding pass renders

`ItineraryView` reads the itinerary payload from React state:

- The vibe pill (`High Desert`)
- The serif-italic destination title (`Spiti Valley`)
- The meta row (country, distance km, travel date)
- The boarding-pass stub (BOOKING code, DAYS Anton numeral, barcode)
- The HUD route map (Delhi → Spiti)
- The Live verified card with the RAG summary
- The weather card
- The price snapshot card (triggers a separate `/api/prices/check` call)
- The photo gallery
- The route picker (flight / train / road from `lib/tripPlanning.js`)
- The vertical timeline of 4 days
- Stays / packing / booking links / guides / similar / totals / refine composer

All of this is rendered from the **one itinerary row** in `messages`.

## Total flow at a glance

```
User keystroke
   │
   ▼
React state                                     (instant)
   │
   ▼
supabase.from('messages').insert (user msg)    (~250 ms)
   │
   ▼
POST /api/chat/direct                          (~12 s incl. Groq + Serper)
   │
   ▼
Postgres INSERTs (deck + itinerary)
   │
   ▼ realtime fires
Browser receives INSERT events                 (~200 ms after each insert)
   │
   ▼
React renders deck + itinerary
```

End-to-end perceived latency: **~12–15 seconds**. The optimistic user message keeps it from feeling lagged.

## What a multi-user session looks like

If a friend opened the same session in another tab, **every step above happens in their tab too** — they see the user message appear, then ~12 seconds later they see the deck and itinerary. Because they subscribed to the same `session:${sessionId}` channel.

This is collaboration with **zero extra backend work** — Postgres + Supabase Realtime handle it for free.

---

**Next file:** `12-auth-and-security.md` — JWTs, RLS, service role, secret management.
