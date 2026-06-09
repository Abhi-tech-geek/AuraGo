# 12 · Authentication & security

## The model in one sentence

**Supabase Auth issues JWTs to users; the backend verifies those JWTs and uses a service-role key for privileged writes; Postgres enforces row-level security so direct browser reads are also safe.**

## The three trust layers

```
Browser (untrusted)
   │
   │ (1) JWT (Bearer ...) for /api/* calls
   │ (2) JWT + anon key for direct supabase-js calls
   ▼
Express backend (trusted code)
   │
   │ (3) Service role key for privileged Postgres writes
   ▼
Supabase (Postgres + Auth)
```

Each layer enforces something different:
- **Browser → API**: Express's `requireAuth` middleware verifies the JWT.
- **Browser → Postgres**: RLS policies enforce per-row visibility.
- **Backend → Postgres**: service role bypasses RLS, but only the backend code can use it (the key never reaches the browser).

## How users sign in

### Email + password (current)

`Auth.jsx` → `supabase.auth.signUp / signInWithPassword`.

- Sign-up sends a verification email with a magic link back to `window.location.origin` (the Cloud Run URL in production).
- Sign-in returns a session: an access token (JWT, 1-hour lifetime) and a refresh token (longer lifetime).
- Both tokens are stored in browser storage by `supabase-js` (localStorage by default).
- The Supabase client auto-refreshes the access token using the refresh token before it expires.

### Forgot password

`Auth.jsx` → `supabase.auth.resetPasswordForEmail`. Emails a one-time link.

### OAuth / Google sign-in

**Not enabled.** The user explicitly asked to skip Google login. If we add it later, it is `supabase.auth.signInWithOAuth({ provider: 'google' })` plus enabling Google in the Supabase dashboard.

## How the backend trusts a request

`requireAuth` middleware (in `server.js`):

```js
async function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'invalid token' });
  }
  req.user = data.user;
  next();
}
```

Important details:
- We use `supabase.auth.getUser(token)` rather than verifying the JWT signature ourselves. Supabase does the verification including signature, expiry, and issuer checks.
- This adds ~50–100 ms per request. It is worth it for not having to manage the JWT signing key.
- The middleware attaches `req.user = { id, email, ... }`. Every controller uses `req.user.id` as the user identity.

## Row-Level Security (RLS) recap

Every Postgres table has RLS enabled. Policies use `auth.uid()` which Postgres reads from the JWT context. See `05-database-and-schema.md` for the policy text. The summary:

| Table | Read | Write |
|---|---|---|
| `profiles` | Anyone (display data) | Self only |
| `sessions` | Owner + participants | Owner only |
| `session_participants` | Members | Owner only |
| `messages` | Members | Members can insert their own `role='user'` rows |
| `trips` | Members | Members can insert (lock) |
| `rag_documents` | Authenticated | Service role only (currently unused) |

This means the React app can run `supabase.from('messages').select(...)` directly **without going through our backend**. The DB itself returns only rows the user is allowed to see.

## When does the backend bypass RLS?

The Express backend uses the **service role key**. This key bypasses RLS entirely. We use it for:

- Inserting assistant `messages` rows (the backend cannot pretend to be the user).
- Inserting itinerary `messages` rows.
- Updating poll payloads (RLS would block users from mutating other users' messages).
- Writing to `session_participants` when accepting an invite.
- Reading any session/trip without filter (for the public share view).

**Risk:** if the service role key leaks, attackers can do anything. Mitigations:
- The key is in `.env` (gitignored).
- It is injected at deploy time via `cloudbuild.yaml`'s env-vars step.
- It never ships to the browser.
- It is never logged.

If we ever want to rotate it: Supabase dashboard → API → reset. Update `.env` + `cloudbuild.yaml`, redeploy.

## Secret management today

```
.env                       (local dev — gitignored)
.env.example               (template, committed)
cloudbuild.yaml            (production — gitignored, contains real keys at deploy time)
cloudbuild.yaml.example    (template, committed)
```

`.gitignore` enforces this:
```
.env
.env.*
*.env
!*.env.example
cloudbuild.yaml
!cloudbuild.yaml.example
```

For a production app at scale, secrets would live in Google Secret Manager and Cloud Run would mount them as env vars. For a side project, the current setup is acceptable but not ideal — see `16-future-improvements.md`.

## Public endpoint — the only no-auth route

```js
app.get('/api/public/trip/:id', publicTrip);
```

`publicTrip` whitelists fields:

```js
const { data: trip } = await supabase
  .from('trips')
  .select('id, destination, vibe, estimated_cost_inr, itinerary,' +
          ' accessibility_notes, status, locked_at')
  .eq('id', id)
  .eq('status', 'locked')
  .single();
```

Notes:
- Only `status = 'locked'` trips are returned. Drafts stay private.
- `locked_by` is not returned — the share page doesn't reveal which user locked it.
- The full itinerary JSON is included because the share page renders the whole plan client-side.

This endpoint is the safest part of the system to expose because the data is already "share-link-public" by user action.

## Invite-link security (`/i/<sessionId>`)

The invite URL is **only the session UUID**, no token. Is this safe?

- UUIDs are 128-bit random. Brute forcing is infeasible.
- The invite endpoint requires the visitor to be authenticated.
- It adds them as a `member` (not `owner`).
- Members can read messages and insert their own user messages, but cannot delete the session or lock a trip on someone else's behalf.

So the attack surface is "guess a session UUID + already have an account" — practically nil.

If we wanted stricter control later we would add a `revoked` flag to sessions or use one-time tokens. Today the convenience wins.

## CORS

```js
app.use(cors({
  origin: ['http://localhost:5173', process.env.FRONTEND_URL].filter(Boolean),
  credentials: true,
}));
```

Only `localhost:5173` (Vite dev) and the configured production URL are allowed origins. We send credentials (cookies) but mainly use the `Authorization` header for auth.

## What we explicitly do not do

| Concern | Decision | Why |
|---|---|---|
| CSRF tokens | Not implemented | We use bearer tokens, not cookies, for auth |
| Rate limiting | Not implemented | Cloud Run scales naturally; no abuse yet |
| Audit logs | Not implemented | Cloud Run logs every request; that's enough today |
| Multi-factor auth | Not implemented | Supabase supports it, just not wired |
| API key for the Concierge | Not implemented | All endpoints are user-scoped via JWT |
| WAF / Cloud Armor | Not implemented | Cloud Run's default DDoS protection is fine |

These are all reasonable upgrades for a production v2. For a side project they are noise.

## Common security pitfalls we deliberately avoided

- **No secrets in the React bundle.** The service role key only lives in the backend.
- **No raw SQL strings concatenated from user input.** Supabase-js parametrises everything.
- **No reflected XSS.** React escapes by default; we never inject raw HTML.
- **No clickjacking risk.** Cloud Run sets reasonable headers; we don't need to embed in iframes.
- **No dynamic code execution** of user input anywhere in the codebase.

## Interview soundbites

> "Auth is Supabase — JWTs for clients, service role for the backend. RLS in Postgres is the actual authorization layer, which means even direct browser queries are safe."

> "We bypass RLS in exactly one place — the backend — and only for writes we wouldn't be able to do as the user (assistant messages, poll vote updates, invite acceptance)."

> "Secrets live in `.env` for local dev and in `cloudbuild.yaml` for deploys; neither is committed. For a production v2 they would move to Google Secret Manager."

---

**Next file:** `13-realtime-collaboration.md` — how multi-user sync actually works.
