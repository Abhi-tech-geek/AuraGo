# AuraGo

> AI-powered travel discovery. Tell it your budget, vibe, and accessibility needs — get five verified destination "mystery cards", then dive into a full day-by-day plan with weather, stays, packing, routes, and a live concierge bot.

[Live demo](https://aurago-13196505521.us-central1.run.app) · React + Express + Supabase + Groq

---

## What it does

1. You describe a trip (or use the budget modal): origin, party size, days, total budget, accessibility, optional travel date.
2. AuraGo's planner agent proposes **5 mystery destinations** that match the brief — destination names hidden, vibe + AI value score visible.
3. Tap a card → AuraGo runs **live RAG verification** (Serper search + an LLM judge), then renders a deep-dive:
   - Weather forecast tuned to your travel month
   - Embedded Google Map
   - Route picker (flight / train / road) with live cost-per-person and pros/cons
   - Smart budget breakdown (transport / stay / food / activities / buffer) that **reacts** to your route choice
   - Day-by-day itinerary
   - **4 stay options** at different price points, each with a "Book on Booking.com" deeplink
   - Auto-generated **packing checklist** tuned to weather + activities (with local persistence)
   - Booking links (Skyscanner, ConfirmTkt, Booking.com) prefilled with your dates
   - **"More like this"** chips — alternative destinations to switch to
4. Floating **AuraGo concierge bot** answers follow-up questions about the destination.
5. Lock the trip → it gets saved with a **public share link** (no login required for viewers).

## Features

- 🔐 **Supabase Auth** — email + password sign-up / sign-in, with RLS-protected sessions, messages, and trips
- 🧠 **Groq Llama-3.3-70B** for intent parsing, candidate generation, RAG judge, day-plan generation, concierge Q&A
- 🌐 **Serper.dev** for live web search (travel advisories, accessibility issues, weather closures)
- 🗺️ **Google Maps** iframe embed (no API key needed)
- 🛏️ **Stays + Packing + Booking deeplinks** — generated per destination
- 📊 **Trip comparison** — side-by-side cost view across all your locked trips
- 🤖 **Concierge chatbot** — context-aware follow-up Q&A
- 🔗 **Public share links** — `/trip/<id>` works without auth
- ♿ **Universal Access mode** — destinations are filtered for wheelchair-friendliness, ramps, and step-free entries
- 🎨 **Sasta vs Elite mode** — neon-green vs metallic-gold themes that propagate via CSS variables
- 📱 **Mobile-first** — collapsible sidebar, floating composer, touch-friendly cards

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 19 + TailwindCSS + Framer Motion + lucide-react |
| Backend | Node 20 + Express 5 |
| Database / Auth | Supabase (Postgres + RLS + Realtime) |
| LLM | Groq (`llama-3.3-70b-versatile`) via OpenAI-compatible API |
| Search / RAG | Serper.dev |
| Hosting | Google Cloud Run (single-container — backend serves the static SPA) |
| Build | Google Cloud Build with `Dockerfile` (multi-stage) |

## Architecture

```
                ┌──────────────────────────────────────────┐
                │         Cloud Run (single image)         │
  Browser ◀────▶│ Express 5  ─  serves static SPA          │
                │            ─  /api/chat/turn  (auth)     │──▶ Groq
                │            ─  /api/chat/expand-card      │──▶ Serper
                │            ─  /api/chat/qa               │──▶ Supabase (service role)
                │            ─  /api/trips/lock            │
                │            ─  /api/public/trip/:id  (no auth) │
                └──────────────────────────────────────────┘
                                     │
                                     ▼
                                Supabase
                  (Auth · sessions · messages · trips · RLS)
```

Browser also talks to Supabase directly for auth (`signInWithPassword`) and Realtime subscriptions on `messages` and `trips` tables.

## Running locally

### 1. Prerequisites
- Node.js 20+
- A free Supabase project
- A free Groq API key — [console.groq.com/keys](https://console.groq.com/keys)
- A free Serper.dev key — [serper.dev](https://serper.dev)

### 2. Set up Supabase
- Create a new project at [supabase.com](https://supabase.com)
- Open the SQL editor and paste/run the entire [`01_supabase_schema.sql`](01_supabase_schema.sql) file
- (Optional) **Authentication → Providers → Email**: turn off "Confirm email" for instant sign-up during dev
- Copy the **Project URL**, **anon key**, and **service role key** from Settings → API

### 3. Backend
```bash
cd backend
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY, SERPER_API_KEY
npm install
npm run dev   # listens on :3001 with --watch
```

### 4. Frontend
```bash
cd frontend
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev   # opens http://localhost:5173, proxies /api → :3001
```

## Deploying to Cloud Run

This repo includes `cloudbuild.yaml.example` which builds the entire app
into one container and deploys it.

```bash
cp cloudbuild.yaml.example cloudbuild.yaml
# edit cloudbuild.yaml — replace YOUR_* placeholders with real values
# (cloudbuild.yaml is gitignored, so this is safe for local use)

gcloud config set project YOUR_GCP_PROJECT_ID
gcloud builds submit --config cloudbuild.yaml .
```

The first deploy will:
1. Build a multi-stage Docker image (frontend → static, backend → Express server with the static dist mounted at `/public`)
2. Push to GCR with two tags (`:$BUILD_ID` and `:latest`)
3. Deploy to Cloud Run (region: `us-central1`)
4. Print the public URL

After deploy, in your **Supabase Dashboard → Authentication → URL Configuration**:
- **Site URL**: the Cloud Run URL
- **Redirect URLs**: add `https://your-cloudrun-url/**`

> **Security**: `cloudbuild.yaml.example` puts secrets as `--set-env-vars`. For production, move them to **Google Secret Manager** and reference them via `--update-secrets`.

## Project layout

```
AuraGo/
├── 01_supabase_schema.sql    # one-shot DB setup
├── AuraGo_Demo.html          # original static UI demo (no backend)
├── Dockerfile                # multi-stage: frontend build → backend image
├── cloudbuild.yaml.example   # template (real one is gitignored)
├── backend/
│   ├── chatController.js     # /api/chat/turn, /expand-card, /qa, /trips/lock, /public/trip/:id
│   ├── server.js             # Express app (serves SPA + API)
│   └── .env.example
└── frontend/
    ├── index.html
    ├── tailwind.config.js
    ├── vite.config.js
    ├── .env.example
    └── src/
        ├── App.jsx                # router (public /trip/:id vs authed app)
        ├── Auth.jsx               # email + password sign in / sign up
        ├── Sidebar.jsx            # sessions list (max 5), new trip, delete, compare
        ├── ChatInterface.jsx      # main chat + mystery deck + itinerary
        ├── BudgetModal.jsx        # mode/origin/party/days/budget/access/date
        ├── ConciergeChat.jsx      # floating bot for follow-up Q&A
        ├── TripsCompareModal.jsx  # locked-trip comparison bar chart
        ├── PublicTripView.jsx     # read-only share view at /trip/:id
        ├── supabaseClient.js
        └── lib/tripPlanning.js    # client-side route + breakdown maths
```

## API routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/chat/turn` | bearer | Parse intent + generate 5-card mystery deck |
| POST | `/api/chat/expand-card` | bearer | RAG-verify card + generate full day plan, weather, stays, packing, similar destinations |
| POST | `/api/chat/qa` | bearer | Concierge follow-up Q&A grounded in current destination context |
| POST | `/api/trips/lock` | bearer | Finalize a destination (one lock per session, enforced by unique partial index) |
| GET | `/api/public/trip/:id` | **public** | Read-only locked-trip lookup for share links |

## Roadmap / addons

- [ ] PDF export of locked itinerary
- [ ] Calendar (.ics) export of trip dates
- [ ] Photo gallery (Unsplash API) on the deep-dive
- [ ] Currency conversion for international destinations
- [ ] Local-language phrase card per destination
- [ ] Move secrets in `cloudbuild.yaml` to Google Secret Manager
- [ ] CDN-cached public share pages (currently dynamic)

## License

MIT
