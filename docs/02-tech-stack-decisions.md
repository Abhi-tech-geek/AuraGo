# 02 · Tech stack decisions

For each technology used in AuraGo: **what it is, why we chose it, what we could have used instead, and why we didn't.**

This file is your single best preparation for any technical interview about AuraGo. Read it before any technical conversation.

---

## Frontend

### React 19

**What it is:** UI library for building component-based interfaces.

**Why we chose it:**
- The biggest ecosystem — every library has a React adapter.
- Hooks make state and effects easy without classes.
- Server components are coming; the codebase will age well.

**Alternatives considered:**
- **Vue 3 / Svelte** — Both genuinely good. Vue has cleaner SFC syntax; Svelte produces smaller bundles. Rejected because the team (just one dev) is fastest in React, and most hiring conversations expect React fluency.
- **Plain HTML + vanilla JS** — Would work for the v1 demo but the live deck + drawer animation + realtime sync would have been hand-rolled. Not worth it.

### Vite

**What it is:** Modern build tool — dev server with HMR, production bundler powered by Rolldown.

**Why we chose it:**
- 10× faster cold-start than Create React App.
- ES-modules dev server means no full rebuild on each save.
- First-class TypeScript / JSX support out of the box.

**Alternatives:**
- **Create React App (CRA)** — Officially deprecated. Slow. Don't.
- **Next.js** — Great for SSR/SSG, overkill for a single-page chat-style app. Adds a second runtime to deploy.
- **Webpack 5 directly** — Configurable but tedious. Vite's defaults are already correct.

### TailwindCSS

**What it is:** Utility-first CSS framework. You compose classes like `flex items-center gap-2` directly in markup.

**Why we chose it:**
- No CSS file naming bikeshedding.
- The JIT compiler only ships classes you actually use.
- Easy responsive design with `sm:`, `md:`, `lg:` prefixes.
- Plays well with hand-written CSS for "design system" classes like `.board`, `.pass`, `.timeline` we added in the Terminal redesign.

**Alternatives:**
- **CSS Modules** — Scoped but you write a stylesheet per component.
- **Styled-components / Emotion** — Run-time CSS-in-JS. Adds a runtime cost and a new mental model.
- **Plain CSS with BEM** — Works fine. Just slower to iterate.

### Framer Motion

**What it is:** React animation library — declarative spring physics, layout animations, gesture handling.

**Why we chose it:**
- The `<motion.div animate={...}>` API is intuitive.
- `layout` and `layoutId` make shared-element transitions a one-liner.
- The "drift / settle" animations on the welcome rail and the deck reveal are trivial with it.

**Alternatives:**
- **CSS transitions/animations** — Free, but choreographing the staggered deck reveal in CSS alone is fragile.
- **React-Spring** — Comparable, slightly older API.
- **GSAP** — More powerful, also heavier (~30 KB more).

### lucide-react

**What it is:** Open-source icon set (a fork of Feather). Each icon is a tree-shakeable React component.

**Why we chose it:**
- 1000+ icons. Consistent visual weight.
- Tree-shaking means our bundle only ships icons we import.
- MIT license, no attribution required.

**Alternatives:**
- **Heroicons (Tailwind team's set)** — Smaller set.
- **Font Awesome** — Older, heavier when self-hosted.
- **Phosphor Icons** — Excellent but a smaller community.

### @supabase/supabase-js

**What it is:** Official Supabase client. Wraps the REST + websocket APIs.

**Why we chose it:**
- We're already on Supabase. Using the official client means RLS, auth, and realtime "just work".
- Realtime channels are exposed as `.channel(name).on(...).subscribe()` — clean.

**Alternatives:** None — if you're on Supabase, you use this client.

---

## Backend

### Node.js 20

**What it is:** JavaScript runtime built on V8.

**Why we chose it:**
- Same language as the frontend → easier mental switching, shared types possible later.
- `fetch` is built-in in Node 20 (no `node-fetch` needed).
- The Cloud Run base image for Node is well supported.

**Alternatives:**
- **Python (FastAPI)** — Better for ML libraries, but our backend only does HTTP + Postgres + LLM API calls. Python adds nothing here.
- **Go** — Faster, lower memory, harder to recruit for. Overkill for our throughput.
- **Bun / Deno** — Promising, but the Cloud Run + Supabase ecosystem still defaults to Node.

### Express 5

**What it is:** Minimal Node web framework — routing, middleware, JSON parsing.

**Why we chose it:**
- The most boring choice on purpose. Stable, well-known.
- Express 5 finally landed async error handling natively.

**Alternatives:**
- **Fastify** — Faster, similar API. Would work too.
- **Hono** — Modern, edge-friendly. Worth a look in v2.
- **NestJS** — Class/decorator-heavy, fine for big teams. Too much for one dev.

### dotenv

**What it is:** Loads `.env` into `process.env`.

**Why we chose it:** Standard, two-line setup.

**Alternative:** Cloud Run injects env vars at deploy time; we still use `dotenv` for local development.

### cookie-parser

Used for completeness (CORS / future session cookies). Currently the API uses bearer tokens; cookies aren't strictly needed.

### cors

Wraps CORS headers. Configured to allow `http://localhost:5173` (Vite dev) and the production Cloud Run URL.

---

## LLM provider

### Groq (Llama 3.3 70B Versatile)

**What it is:** Groq is a chip company that hosts open-source LLMs on their custom inference hardware. They expose an OpenAI-compatible REST API. `llama-3.3-70b-versatile` is Meta's 70B parameter instruction-tuned model.

**Why we chose it:**
- **Speed.** Groq's hardware regularly returns 500+ tokens/second. That's what makes "8 destinations in 30 seconds" possible.
- **Free tier.** 30 requests per minute, ~14k requests per day. Plenty for a personal project.
- **OpenAI-compatible.** We can swap to OpenAI/Anthropic/Together by changing one URL.
- **No embedding API.** This is a real limitation — see `09-rag-and-retrieval.md`. Drove our decision to use Serper as the retrieval channel instead.

**Alternatives:**
- **OpenAI GPT-4o / GPT-4o-mini** — Higher quality, slower, costs $. The price would have killed the free demo.
- **Anthropic Claude 3.5 Sonnet / Haiku** — Excellent quality, no free tier appropriate for this scale.
- **Self-hosted Ollama + Llama 3** — Free but every Cloud Run container would need a GPU. Cost explodes.
- **Together.ai / Replicate** — Similar to Groq, slightly slower today.

### Why JSON-only outputs (`response_format: { type: "json_object" }`)?

We always tell Groq to reply in JSON. This makes the LLM's output **structured data the backend can trust** instead of free-text we'd have to regex-parse. Every system prompt ends with the exact JSON schema we expect. See `08-prompt-engineering.md`.

---

## Live web data

### Serper.dev

**What it is:** Wrapper API around Google Search and Google Images. You POST a query, you get JSON back with `organic` results (title, snippet, link, date) and `images` (URL, source).

**Why we chose it:**
- Google quality without running our own scraper.
- ₹0 → 2500 free queries to start; ₹1500/month for 25k queries after.
- Returns dated snippets we can show in the "Live verified" RAG-summary card.
- Works for image search too — we use it for the photo gallery.

**Alternatives:**
- **SerpAPI** — Same idea, slightly more expensive.
- **Bing Web Search API** — Microsoft retired the free tier. RIP.
- **Brave Search API** — Reasonable, smaller index.
- **Run a Playwright scraper ourselves** — A massive maintenance burden, gets blocked, against Google ToS.

---

## Database / Auth / Realtime

### Supabase (Postgres + Auth + Realtime + pgvector)

**What it is:** Open-source Firebase alternative built on Postgres. Provides:
- Managed Postgres with **Row-Level Security**.
- Email/password and OAuth auth issuing JWTs.
- A websocket layer that streams **logical replication events** (INSERT / UPDATE / DELETE) to subscribed clients.
- `pgvector` extension for embedding similarity search.
- File storage.

**Why we chose it:**
- One service replacing what would otherwise be five (Postgres host + Auth0 + Pusher + S3 + a vector DB).
- RLS means even direct browser queries are safe — no need to write a custom DB API layer for read paths.
- Free tier is generous for a side project.

**Alternatives:**
- **Firebase / Firestore** — NoSQL, not Postgres. Harder to model relational data like "trips have messages which have polls". No RLS.
- **PlanetScale + Clerk + Pusher + Pinecone** — Best-of-breed but four bills instead of one.
- **Self-hosted Postgres on RDS + Auth0 + Socket.io + Pinecone** — Four services to operate.

**See:** `05-database-and-schema.md` for the schema and RLS policies.

---

## Hosting / Deployment

### Google Cloud Run

**What it is:** Fully managed serverless container hosting. You give it a Docker image; it scales from 0 → many instances on HTTP traffic and bills per request.

**Why we chose it:**
- **Scale to zero** — free when nobody's using the app.
- **One service = one URL** — no separate frontend/backend deploys.
- A Cloud Run + Cloud Build + Container Registry setup costs ~₹0 for our traffic level.

**Alternatives:**
- **Vercel / Netlify** — Excellent for static + serverless functions. Would have meant splitting frontend and backend across hosts.
- **Heroku** — Used to be the default; got expensive after free tier death.
- **Fly.io / Railway** — Both great. Cloud Run won because we're already inside the GCP ecosystem.
- **Self-hosted on a VPS (Hetzner / DigitalOcean)** — ~₹500/month, requires you to handle SSL, deploys, scaling.

### Cloud Build (`cloudbuild.yaml`)

**What it is:** GCP's CI service. Takes the repo, builds a Docker image, pushes it to Container Registry, deploys to Cloud Run.

**Why we chose it:** Triggered with one command (`gcloud builds submit --config cloudbuild.yaml .`). No GitHub Actions runner config.

**Alternative:** GitHub Actions could do the same thing. Cloud Build is GCP-native.

### Dockerfile (multi-stage)

The Dockerfile:
1. Builds the React app inside a `node:20` builder stage.
2. Copies the built `dist/` into the backend's `public/` folder.
3. Runs `node server.js` in a slimmer runtime stage.

**Why multi-stage?** Final image stays small (~150 MB), no dev dependencies shipped.

---

## What we explicitly DID NOT use

| Tool | Why we didn't |
|---|---|
| **LangChain / LangGraph** | We orchestrate three or four LLM calls per turn. LangChain adds abstraction layers without saving meaningful code. If we move to true agents later, LangGraph becomes worth it. |
| **OpenAI Assistants API** | Vendor lock-in, and we wanted the free Groq tier. |
| **Mem0 / Letta (MemGPT)** | We don't have agent memory yet. When we add it, Mem0 is the front-runner. |
| **Pinecone / Weaviate** | pgvector inside the existing Supabase Postgres is one less vendor. |
| **Redis** | Nothing actually needs a sub-second cache yet. |
| **TypeScript** | The whole codebase is plain JS. Adding TS now is a multi-day refactor for marginal benefit. |
| **A real CDN (Cloudflare)** | Cloud Run already fronts requests with Google's edge. |

---

**Next file:** `03-frontend-deep-dive.md` — how the React app is structured.
