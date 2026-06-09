# 17 · Build from scratch — step by step

This file teaches AuraGo from Step 0. By following it, you should be able to recreate the entire system in a fresh repo. It is the most concrete way to internalise the architecture.

## Step 0 — Prerequisites

Install:
- Node.js 20+
- Git
- Docker
- gcloud CLI (Google Cloud SDK)

Create accounts:
- Supabase (free tier)
- Groq Cloud (free tier)
- Serper.dev (free tier — 2500 queries)
- Google Cloud (free $300 credit available)

## Step 1 — Repo skeleton

```bash
mkdir aurago && cd aurago
git init
```

Folder structure:
```
aurago/
├── backend/
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       └── main.jsx
├── Dockerfile
├── cloudbuild.yaml.example
└── README.md
```

## Step 2 — Provision Supabase

1. Create a new project at supabase.com.
2. In the SQL editor, run `01_supabase_schema.sql`. This creates:
   - `profiles` table + auto-create trigger
   - `sessions` table
   - `session_participants` table
   - `messages` table
   - `trips` table
   - `rag_documents` table (vector schema, currently unused)
   - All RLS policies
   - Realtime publication
3. Copy:
   - Project URL (`https://xxxxx.supabase.co`)
   - `anon` public key
   - `service_role` secret key

## Step 3 — Backend bootstrap

```bash
cd backend
npm init -y
npm install express cors cookie-parser @supabase/supabase-js dotenv
npm install --save-dev nodemon
```

`backend/server.js` (skeleton):

```js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { createClient } from '@supabase/supabase-js'

const app = express()
const port = process.env.PORT || 3001

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

async function requireAuth(req, res, next) {
  const [, token] = (req.get('authorization') || '').split(' ')
  if (!token) return res.status(401).json({ error: 'missing bearer token' })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return res.status(401).json({ error: 'invalid token' })
  req.user = data.user
  next()
}

app.use(cors({ origin: ['http://localhost:5173'].filter(Boolean), credentials: true }))
app.use(cookieParser())
app.use(express.json())

app.get('/api/health', (req, res) => res.json({ ok: true }))

app.listen(port, () => console.log(`backend on ${port}`))
```

`backend/.env`:
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
GROQ_API_KEY=gsk_...
SERPER_API_KEY=...
```

Test:
```bash
node server.js
curl http://localhost:3001/api/health
# → {"ok":true}
```

## Step 4 — Frontend bootstrap

```bash
cd ../frontend
npm create vite@latest . -- --template react
npm install
npm install @supabase/supabase-js framer-motion lucide-react
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Tailwind config:
```js
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
}
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
:root {
  --bg: #0B1020;
  --accent: #D4AF37;
  /* ...rest of tokens; see frontend/src/index.css in the real repo */
}
```

`src/supabaseClient.js`:
```js
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
```

`frontend/.env.local`:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Test:
```bash
npm run dev
# Open http://localhost:5173
```

## Step 5 — Vite proxy for /api/*

`vite.config.js`:
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
})
```

Now `/api/health` from the React app reaches the Express server.

## Step 6 — Auth UI

Build `Auth.jsx`:

```jsx
import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')

  const submit = async (e) => {
    e.preventDefault()
    if (mode === 'signup') {
      await supabase.auth.signUp({ email, password })
    } else {
      await supabase.auth.signInWithPassword({ email, password })
    }
  }

  return (
    <form onSubmit={submit}>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button>{mode === 'signup' ? 'Sign up' : 'Sign in'}</button>
      <button type="button" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
        Toggle
      </button>
    </form>
  )
}
```

`App.jsx` watches auth state:

```jsx
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Auth from './Auth'

export default function App() {
  const [session, setSession] = useState(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!session) return <Auth />
  return <div>Hello {session.user.email}</div>
}
```

Test sign-up flow. Verify a row appears in `auth.users` and `public.profiles`.

## Step 7 — First Groq call

`backend/chatController.js`:

```js
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

async function groqChat(systemPrompt, userPrompt, { temperature = 0.4 } = {}) {
  const r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  if (!r.ok) throw new Error(`Groq ${r.status}`)
  return (await r.json()).choices[0].message.content
}

export async function chatTurn(req, res) {
  const { sessionId, prompt } = req.body
  // ... simplest version: just generate 8 candidates
  const sys = `Return JSON: { candidates: [{ destination, vibe, score }] }`
  const text = await groqChat(sys, `USER: ${prompt}`)
  const cards = JSON.parse(text).candidates
  res.json({ ok: true, cards })
}
```

Wire it in `server.js`:
```js
import { chatTurn } from './chatController.js'
app.post('/api/chat/turn', requireAuth, chatTurn)
```

Test:
```bash
TOKEN="$(supabase access token from browser localStorage)"
curl -X POST http://localhost:3001/api/chat/turn \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","prompt":"weekend trip from delhi under 20k"}'
```

You should see 8 destinations in the response.

## Step 8 — Insert messages instead of returning

Real AuraGo inserts deck rows into `public.messages` and returns just `{ messageId }`. The frontend renders from realtime.

```js
const { data: deckMsg } = await supabase.from('messages').insert({
  session_id: sessionId,
  role: 'assistant',
  kind: 'mystery_deck',
  payload: { cards },
}).select().single()
return res.json({ ok: true, messageId: deckMsg.id })
```

## Step 9 — Realtime subscription on the frontend

`ChatInterface.jsx`:

```jsx
useEffect(() => {
  const ch = supabase
    .channel(`session:${sessionId}`)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `session_id=eq.${sessionId}` },
        (p) => setMessages(prev => [...prev, p.new]))
    .subscribe()
  return () => supabase.removeChannel(ch)
}, [sessionId])
```

After this, inserts from the backend flow live to the browser. Test by manually inserting a row in the Supabase dashboard — the React feed should update.

## Step 10 — Expand into an itinerary

Add `/api/chat/expand-card` controller. Call Groq twice: once for the day plan, once for the photo URLs (via Serper instead). Insert as a row of `kind: 'itinerary'` with `parent_message_id = deckMsg.id`.

The frontend detects this row via realtime and expands the itinerary inline.

## Step 11 — Refine endpoint

```js
export async function refineItinerary(req, res) {
  const { itineraryMessageId, instruction } = req.body
  const { data: itin } = await supabase.from('messages')
    .select('*').eq('id', itineraryMessageId).single()
  const sys = `Rewrite the itinerary per the instruction. Same JSON shape.`
  const text = await groqChat(sys,
    `INSTRUCTION: ${instruction}\nITINERARY: ${JSON.stringify(itin.payload)}`)
  const newPayload = { ...itin.payload, ...JSON.parse(text) }
  const { data: newMsg } = await supabase.from('messages').insert({
    session_id: itin.session_id,
    role: 'assistant',
    kind: 'itinerary',
    parent_message_id: itin.parent_message_id,
    payload: newPayload,
  }).select().single()
  return res.json({ ok: true, messageId: newMsg.id })
}
```

## Step 12 — Polls + Chat (collaboration)

Migration `03_migration_chat_polls_alerts.sql`: extend `messages.kind` CHECK to allow `'poll'` and `'chat'`.

Add `/api/polls/create` and `/api/polls/vote`. Polls are messages with `kind='poll'` and `payload = { question, options, votes: {} }`. Voting updates `payload.votes`.

Chat messages are inserted directly from the browser (RLS allows it) with `kind='chat'`. They appear in the drawer because we filter messages in the React render.

## Step 13 — Sharing

`POST /api/trips/lock` copies the itinerary payload into `public.trips`. `GET /api/public/trip/:id` is the only no-auth endpoint — it returns the locked trip's JSON for the share page.

## Step 14 — Dockerise

`Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

FROM node:20-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend ./
COPY --from=builder /app/frontend/dist ./public
ENV PORT=8080
CMD ["node", "server.js"]
```

`backend/server.js` should add:
```js
app.use(express.static('public'))
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})
```

Build + run locally:
```bash
docker build -t aurago .
docker run -p 8080:8080 --env-file backend/.env aurago
```

## Step 15 — Deploy to Cloud Run

Create `cloudbuild.yaml` (use `cloudbuild.yaml.example` as template, fill in real env vars). Then:

```bash
gcloud builds submit --config cloudbuild.yaml .
```

After ~3 minutes, your service is live at `https://aurago-xxxxx.run.app`.

## Step 16 — Iterate

Everything else AuraGo does is layered on this skeleton:

- **Multi-stop trips**: add `route_stops jsonb` to `sessions`, branch the day-plan prompt.
- **Weather replan**: new endpoint that Serper-queries forecast, then calls refine.
- **Price snapshot**: new endpoint with parallel Serper queries.
- **Concierge bot**: floating drawer + `/api/chat/qa`.
- **Theme system**: body class + CSS vars.
- **Departures-board UI**: pure CSS + split-flap React component.
- **Boarding-pass header + HUD map + timeline**: more CSS + a few helper components.

Each is a small layer. The foundation is in steps 0–15.

## What to look up when stuck

| If you're stuck on... | Check this file |
|---|---|
| Auth or JWTs | `12-auth-and-security.md` |
| RLS policies | `05-database-and-schema.md` |
| LLM prompts | `08-prompt-engineering.md` |
| Why a workflow exists | `07-orchestration-and-workflows.md` |
| Realtime not delivering events | `13-realtime-collaboration.md` |
| Deployment failures | `14-deployment-pipeline.md` |
| Performance | `15-performance-optimizations.md` |
| Why something wasn't built | `16-future-improvements.md` |

---

**Next file:** `18-interview-cheatsheet.md` — the one-page summary for the night before an interview.
