# 13 · Realtime & collaboration

## The mental model

> Postgres is the source of truth. Supabase Realtime is a pipe that streams INSERT and UPDATE events from Postgres to every browser tab subscribed to a channel. The browsers re-render from the new rows.

There is no Socket.io, no Redis pub/sub, no Pusher, no custom websocket server. The full collaboration stack is Postgres + Supabase.

## How a single tab subscribes

`ChatInterface.jsx`:

```js
useEffect(() => {
  if (!sessionId) return;
  const ch = supabase
    .channel(`session:${sessionId}`)
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages",
          filter: `session_id=eq.${sessionId}` },
        (p) => setMessages(prev =>
          prev.some(x => x.id === p.new.id) ? prev : [...prev, p.new]))
    .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages",
          filter: `session_id=eq.${sessionId}` },
        (p) => setMessages(prev =>
          prev.map(x => x.id === p.new.id ? { ...x, ...p.new } : x)))
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "trips",
          filter: `session_id=eq.${sessionId}` },
        (p) => /* append a lock_event chip */)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, [sessionId]);
```

Three subscriptions on one channel:

1. **`messages` INSERT** — new turn, new deck, new itinerary, new chat, new poll, new alert. Anything that appears in the feed comes through here.
2. **`messages` UPDATE** — poll vote payloads mutate, and refined itineraries also touch existing rows.
3. **`trips` INSERT** — a trip got locked. We surface this as a `lock_event` chip in the feed.

## What "channel" means here

A Supabase channel is a logical group of subscriptions. We use **one channel per session**, named `session:<sessionId>`. Every subscription on that channel passes through one websocket connection.

If a user has 5 trips open in 5 tabs, that's 5 channels and 5 websockets. Acceptable. If we ever needed to consolidate, Supabase supports multiplexing, but we don't.

## How the deck appears in two browsers at once

```
User A enters the modal and clicks "Plan my trip"
       │
       ▼
POST /api/chat/turn                                  (Cloud Run Express)
       │
       ▼
Groq + Postgres writes
       │
       ▼
INSERT INTO public.messages (kind='mystery_deck', ...)
       │
       ├─→ logical replication slot fires
       │
       ▼
Supabase Realtime server fans out the event
       │
       ├──────────────────────────────────────┐
       │                                      │
       ▼                                      ▼
User A's browser channel                User B's browser channel
(session:abc-123 subscriber)          (session:abc-123 subscriber)
       │                                      │
       ▼                                      ▼
setMessages adds the new row          setMessages adds the new row
       │                                      │
       ▼                                      ▼
React renders the deck                React renders the deck
```

User A and User B see the deck within milliseconds of each other. No polling, no API call needed by User B's browser.

## Why UPDATE matters for polls

When a poll is created, a new row appears (INSERT). When someone votes, the **payload** changes:

```js
// Before
payload: { question, options, votes: {} }

// After User B votes for option "o2"
payload: { question, options, votes: { "user-B-id": "o2" } }
```

This is an UPDATE, not an INSERT. Without the UPDATE handler, the vote would happen invisibly until a manual refresh. With it, the bar chart animates as votes come in.

This was a real bug we fixed mid-redesign — see commit history.

## Realtime publication setup (one-time)

In `01_supabase_schema.sql`:

```sql
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.session_participants;
```

These three tables emit logical replication events. Supabase wraps that into a websocket protocol. Subscribed clients get JSON payloads of new/updated rows.

If we add a new table that needs realtime (e.g., a future `comments` table), we add it to the publication.

## Auth + realtime

The realtime websocket carries the user's JWT. Supabase uses it to enforce RLS on subscriptions:

- Only rows you can read via RLS are streamed to you.
- A user who isn't a member of a session **cannot subscribe to that session's channel**, period.

This is RLS doing double duty — security AND access control on the realtime layer.

## Chat drawer = same mechanism

The trip-chat drawer renders `messages.kind = 'chat'` rows. They come through the **same realtime subscription** as everything else. We just filter them in the React render layer:

```js
const chatMsgs = messages.filter(m => m.kind === "chat");
```

So when User A types a chat message, all members' chat drawers update simultaneously. Same machinery as the deck.

The same is true for polls, lock events, refined itineraries, and weather replans. **One realtime hook handles all forms of collaboration.**

## What we don't broadcast

| Thing | Why not |
|---|---|
| Cursor positions / "who's typing in the composer" | Would need Supabase Presence; nice-to-have, not built |
| User mouse pointers in the itinerary | Same — Presence isn't wired |
| "User X is viewing this trip right now" | Same |
| Optimistic in-flight messages | We insert them as real rows; no need for a separate channel |

All these would be cheap additions later. Today we don't push them because there's no UX feature that demands them yet.

## Performance characteristics

- **Latency**: typically 200–500 ms from Postgres INSERT to React render on a subscribed client.
- **Backpressure**: minimal — chat is human-paced, polls vote rarely.
- **Cost**: Supabase free tier covers ~2 million realtime messages/month. We are not close.
- **Connection limits**: each browser tab keeps one websocket. With 10 concurrent users that's 10 sockets. Easy.

## How invite acceptance flows through realtime

1. Friend opens `/i/<sessionId>`.
2. App.jsx detects the path, stores it in localStorage.
3. After auth, App.jsx POSTs `/api/sessions/:id/join`.
4. The backend upserts into `public.session_participants`.
5. That table is in the realtime publication, so a `session_participants` INSERT event broadcasts.
6. The original owner's browser can show a "X joined" toast (we don't yet, but the data is there).
7. The friend's browser navigates to `/` and the session list reloads, including the newly joined trip.

## What happens on a network drop

- The websocket disconnects.
- `supabase-js` auto-reconnects with exponential backoff.
- On reconnect, the client re-subscribes to the channel.
- It does NOT replay missed events. If a message was inserted while disconnected, the user only sees it after the channel rejoins... unless the React component refetches all session messages.

We don't currently refetch on reconnect. Acceptable for a chat-like app where the user can scroll up. A v2 improvement would be to track the last-seen timestamp and query for missed rows on rejoin.

## Interview soundbites

> "Realtime is Postgres logical replication piped through Supabase. INSERT and UPDATE events broadcast on session-scoped channels. RLS doubles as access control on the websocket so no one sees what they shouldn't."

> "We don't run our own websocket layer. Everything collaborative — chat, polls, deck reveals, itinerary refines — flows through one mechanism: row changes in `public.messages`."

> "Presence features like 'X is typing' aren't built yet. The infrastructure is one Supabase channel call away."

---

**Next file:** `14-deployment-pipeline.md` — Docker, Cloud Build, Cloud Run.
