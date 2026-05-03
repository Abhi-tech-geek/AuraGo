import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { chatTurn, expandCard, lockTrip, chatQA, publicTrip, directTrip } from './chatController.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3001

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.get('authorization') || ''
    const [scheme, token] = authHeader.split(' ')

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return res.status(401).json({ error: 'missing bearer token' })
    }

    const { data, error } = await supabase.auth.getUser(token)

    if (error || !data?.user) {
      return res.status(401).json({ error: 'invalid token' })
    }

    req.user = data.user
    return next()
  } catch (error) {
    console.error('requireAuth error', error)
    return res.status(500).json({ error: 'auth failed' })
  }
}

app.use(cors({ origin: ['http://localhost:5173', process.env.FRONTEND_URL].filter(Boolean), credentials: true }))
app.use(cookieParser())
app.use(express.json())

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')))

app.post('/api/chat/turn', requireAuth, chatTurn)
app.post('/api/chat/expand-card', requireAuth, expandCard)
app.post('/api/chat/qa', requireAuth, chatQA)
app.post('/api/chat/direct', requireAuth, directTrip)
app.post('/api/trips/lock', requireAuth, lockTrip)

// PUBLIC route — no auth, anyone with the link can view a locked trip
app.get('/api/public/trip/:id', publicTrip)

// SPA fallback — any non-API GET that didn't match a static file returns index.html.
// Express 5 / path-to-regexp v8 chokes on '*' and on some regex routes, so we use
// a plain middleware which doesn't go through the path matcher at all.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(port, () => {
  console.log(`AuraGo backend listening on port ${port}`)
})
