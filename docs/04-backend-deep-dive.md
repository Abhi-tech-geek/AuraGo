# 04 · Backend deep dive

## File layout

```
backend/
├── server.js           ← Express setup + route table
├── chatController.js   ← Every controller (chatTurn, expandCard, refine, polls, etc.)
├── package.json
├── .env                ← Secrets (gitignored, never commit)
└── .env.example        ← Template
```

Two files. That's it. Deliberately tiny.

## `server.js` — the route table

```js
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { createClient } from '@supabase/supabase-js'
import { /* all controllers */ } from './chatController.js'

const app = express()
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// JWT auth middleware
async function requireAuth(req, res, next) {
  const [, token] = (req.get('authorization') || '').split(' ')
  if (!token) return res.status(401).json({ error: 'missing bearer token' })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return res.status(401).json({ error: 'invalid token' })
  req.user = data.user
  next()
}

app.use(cors({ origin: [...], credentials: true }))
app.use(cookieParser())
app.use(express.json())
app.use(express.static('public'))   // built React app

// API endpoints
app.post('/api/chat/turn',            requireAuth, chatTurn)
app.post('/api/chat/direct',          requireAuth, directTrip)
app.post('/api/chat/expand-card',     requireAuth, expandCard)
app.post('/api/chat/refine',          requireAuth, refineItinerary)
app.post('/api/chat/replan-weather',  requireAuth, replanWeather)
app.post('/api/chat/qa',              requireAuth, chatQA)
app.post('/api/prices/check',         requireAuth, checkPrices)
app.post('/api/polls/create',         requireAuth, createPoll)
app.post('/api/polls/vote',           requireAuth, votePoll)
app.post('/api/sessions/:id/join',    requireAuth, joinSession)
app.get ('/api/sessions/:id/participants', requireAuth, listParticipants)
app.post('/api/trips/lock',           requireAuth, lockTrip)
app.get ('/api/public/trip/:id',                  publicTrip)   // no auth

// SPA fallback — last
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(process.env.PORT || 3001)
```

## `requireAuth` middleware in detail

Every authenticated endpoint runs this first.

1. Read the `Authorization: Bearer <jwt>` header.
2. Call `supabase.auth.getUser(token)`. This validates the JWT signature **without** us holding the JWT secret — Supabase does it server-side.
3. If valid, attach `req.user = { id, email, ... }`. If invalid, return 401.

This is enough for full auth because the JWT contains the user ID, and the rest of the system enforces RLS using that ID.

## The two Supabase clients (important)

Inside the backend we create the Supabase client with the **service role key**:

```js
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})
```

This client **bypasses Row-Level Security**. Why? Because the backend needs to write rows on behalf of users:

- Insert assistant `messages` rows.
- Update poll vote payloads (which the user couldn't update through RLS).
- Lock trips into `public.trips` with `locked_by = req.user.id`.
- Accept invite-link joins by writing to `session_participants`.

The frontend, on the other hand, uses the **anon key** with a JWT — RLS applies normally there.

**Why this is safe:** the backend always verifies the user before doing anything, and it writes only what the user is permitted to write. The service role is a sharp tool, used carefully.

## Controllers (chatController.js)

Each controller is roughly:

```js
export async function controllerName(req, res) {
  try {
    const { /* body params */ } = req.body
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'unauthorized' })

    // 1. Load session / message from Postgres
    // 2. Call Groq one or more times (sometimes Serper too)
    // 3. Insert/update Postgres rows
    // 4. Return { ok: true, messageId }
  } catch (e) {
    console.error('controllerName error', e)
    return res.status(500).json({ error: 'something failed' })
  }
}
```

The pattern is repeated for ~12 controllers. Their roles and prompts are documented in `06-ai-agents-explained.md` and `07-orchestration-and-workflows.md`.

## Helper: `groqChat(systemPrompt, userPrompt, { temperature })`

Every LLM call goes through this:

```js
const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

async function groqChat(systemPrompt, userPrompt, { temperature = 0.4 } = {}) {
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature,
      response_format: { type: "json_object" },     // ← always JSON
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    }),
  })
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0,400)}`)
  return (await r.json()).choices?.[0]?.message?.content ?? "{}"
}
```

Three things to note:

- **`response_format: { type: "json_object" }`** — Groq enforces JSON output. The LLM cannot return prose.
- **Temperature defaults to 0.4** — low-ish. We bump it to 0.6–0.75 for the candidate pool (we want variety) and drop to 0 for verdict / extraction (we want determinism).
- **Errors throw** — every controller wraps the call in a try/catch and decides whether to fall back to a default or surface the error.

## Helper: `serper(query)` and `serperImages(query, num)`

Same idea — thin wrapper around the Serper REST API.

```js
const serper = async (query) => {
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 8 }),
  })
  return r.ok ? r.json() : { organic: [] }
}
```

Both Serper helpers **never throw** — they return empty arrays on failure so the calling controller can continue.

## Error strategy

- **Validation errors** → 400 with `{ error: "missing X" }`.
- **Auth errors** → 401.
- **Not-found errors** → 404.
- **Permission errors** → 403.
- **Anything else** → 500 with `{ error, detail }`, logged via `console.error` (which Cloud Run captures into stackdriver / logging).

There is no winston / pino. Cloud Run's structured logging captures `console.error` automatically.

## Performance shortcuts

Inside controllers we use `Promise.allSettled` to parallelise the Groq day-plan call with the Serper image-gallery call:

```js
const [planText, photos] = await Promise.allSettled([
  groqChat(daySys, dayUser, { temperature: 0.4 }),
  serperImages(`${destination} travel`, 6),
])
```

Both are bound by external latency (~3–5 s and ~600 ms respectively). Running them concurrently saves ~600 ms per itinerary open.

The `parseIntent` fast-path is another shortcut — see `15-performance-optimizations.md`.

## Environment variables expected

```
SUPABASE_URL                 https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY    sb_secret_…    (service role, NEVER ship to browser)
GROQ_API_KEY                 gsk_…
SERPER_API_KEY               <40-char hex>
FRONTEND_URL                 https://aurago-…run.app   (for CORS)
PORT                         3001 by default; Cloud Run injects 8080
```

Stored in `.env` for local dev. Injected by `cloudbuild.yaml` for production.

---

**Next file:** `05-database-and-schema.md` — every table, every column, every RLS policy.
