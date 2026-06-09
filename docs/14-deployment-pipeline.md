# 14 · Deployment pipeline

## The whole pipeline in one diagram

```
git push origin main                                   (developer)
        │
        │  manual trigger:
        │  gcloud builds submit --config cloudbuild.yaml .
        ▼
Cloud Build picks up the repo                          (~10 s)
        │
        ▼
Step 1: docker build -t aurago .                       (~80 s)
        │
        ▼
Step 2: docker push gcr.io/PROJECT/aurago:TAG           (~30 s)
        │
        ▼
Step 3: gcloud run deploy aurago --image=gcr.io/...    (~30 s)
            --region us-central1
            --set-env-vars SUPABASE_URL=...,GROQ_API_KEY=...
        │
        ▼
Cloud Run rolls a new revision (aurago-NN-xyz)
        │
        ▼
Old revision drains, new revision takes 100% traffic   (~10 s)
        │
        ▼
Live at https://aurago-13196505521.us-central1.run.app
```

Total time: 2–3 minutes.

## The Dockerfile

Multi-stage build to keep the final image small:

```dockerfile
# ----- Stage 1: build the React app -----
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# ----- Stage 2: runtime -----
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend ./backend
# pipe the built React output into the backend's static folder
COPY --from=builder /app/frontend/dist ./backend/public
ENV PORT=8080
EXPOSE 8080
WORKDIR /app/backend
CMD ["node", "server.js"]
```

Why this shape:
- **Stage 1** installs dev dependencies and builds the React bundle.
- **Stage 2** keeps only runtime dependencies (Express, supabase-js, cookie-parser, etc.). No Vite, no Tailwind compiler.
- **Final image**: ~150 MB. Pulls fast on Cloud Run cold starts.

## The cloudbuild.yaml

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/aurago:$BUILD_ID', '.']

  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/aurago:$BUILD_ID']

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: 'gcloud'
    args:
      - 'run'
      - 'deploy'
      - 'aurago'
      - '--image=gcr.io/$PROJECT_ID/aurago:$BUILD_ID'
      - '--region=us-central1'
      - '--platform=managed'
      - '--allow-unauthenticated'
      - '--set-env-vars'
      - 'SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,GROQ_API_KEY=...,SERPER_API_KEY=...'

images:
  - 'gcr.io/$PROJECT_ID/aurago:$BUILD_ID'
```

Important:
- `$BUILD_ID` is a unique Cloud Build identifier — each deploy produces a new image tag.
- The real keys are filled in via `cloudbuild.yaml` which is **gitignored**. `cloudbuild.yaml.example` is the template.
- `--allow-unauthenticated` makes the URL publicly accessible (auth happens at the app level via Supabase JWTs).

## How a deploy happens

From the project root:

```bash
gcloud builds submit --config cloudbuild.yaml .
```

This:
1. Uploads the repo to a GCS bucket Cloud Build uses as source.
2. Triggers the three steps.
3. Streams logs to the terminal.
4. On success, the new Cloud Run revision serves all traffic.

We deploy **manually**, not on every git push. Reasons:
- A side project doesn't need CI on every commit.
- We sometimes want to test locally before deploying.
- Cost stays predictable.

## Cloud Run configuration

Set on the service in the GCP console:

| Setting | Value | Why |
|---|---|---|
| Minimum instances | 0 | Free when idle |
| Maximum instances | 5 | Plenty for a side project; caps cost |
| Concurrency | 80 | Default — Express handles concurrent requests fine |
| CPU | 1 vCPU | Default; bumps automatically during cold start |
| Memory | 512 MB | Express + Node fits comfortably |
| Timeout | 300 s | Long enough for the slowest itinerary build (~20 s) plus margin |
| Region | us-central1 | Lowest latency from India after asia-south1 (which we'll move to later) |

## Domain and HTTPS

We use the default Cloud Run URL: `https://aurago-13196505521.us-central1.run.app`. Cloud Run handles HTTPS automatically with a Google-managed certificate.

If we wanted a custom domain (e.g., `aurago.com`):
- Verify the domain in the GCP console.
- Add a CNAME or A record pointing to Cloud Run.
- Cloud Run provisions a managed cert (free).

## Logs

`console.log` and `console.error` from the backend automatically appear in Cloud Logging. You can:

- Search them with `gcloud logging read 'resource.type="cloud_run_revision"' --limit 100`.
- View them in the Cloud Run UI under "Logs".

There's no structured logging today — just plain text. Acceptable.

## Local development workflow

```bash
# Terminal 1: backend
cd backend
cp .env.example .env       # fill in keys
npm install
npm run dev                # nodemon on port 3001

# Terminal 2: frontend
cd frontend
cp .env.example .env.local # mostly SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm run dev                # Vite on port 5173
```

Vite proxies `/api/*` to `localhost:3001` in dev. Production uses the same path because Express serves both static files and `/api/*`.

## Costs (real numbers as of this writing)

| Service | Plan | Monthly cost at our usage |
|---|---|---|
| Cloud Run | Pay-per-request | ₹0 — under free tier |
| Cloud Build | First 120 build-minutes/day free | ₹0 |
| Container Registry | First 0.5 GB free | ₹0 |
| Supabase | Free tier | ₹0 |
| Groq | Free tier (30 RPM, 14k req/day) | ₹0 |
| Serper.dev | 2500 free queries to start | ₹0 |
| Total | | **₹0** |

When we outgrow free tiers:
- Cloud Run: a few hundred rupees a month.
- Supabase Pro: $25/month.
- Groq: pay-per-token at competitive rates.
- Serper: $50/month for 25k queries.

A side project staying inside free tiers indefinitely is realistic if traffic stays modest.

## Rollback

Cloud Run keeps every previous revision. To roll back:

```bash
gcloud run services update-traffic aurago \
  --to-revisions aurago-00042-hgw=100 \
  --region us-central1
```

That takes ~10 seconds and reverts to a specific revision. No rebuild required.

## What we explicitly don't have

| Thing | Why we skipped |
|---|---|
| Staging environment | Not worth the second URL for a side project |
| Blue/green deploys | Cloud Run does graceful traffic shifting anyway |
| Helm / Kubernetes | We're not on K8s — Cloud Run is managed |
| GitHub Actions CI | Cloud Build is fine and runs in GCP |
| Sentry / error tracking | Cloud Logging captures errors; we read it on incidents |
| Performance monitoring (New Relic / Datadog) | Cloud Run gives basic metrics |

## Interview soundbites

> "Deployment is a single container on Cloud Run. Cloud Build does multi-stage Docker — Node 20 base, React build piped into the backend's static folder. The whole thing is ~150 MB and ~2 minutes to deploy."

> "We deploy manually with `gcloud builds submit` because automatic deploys on every commit aren't worth the extra complexity for a side project. Rolling back is one `update-traffic` command — Cloud Run keeps every revision."

> "Total infrastructure cost is ₹0/month at current usage. Cloud Run scales to zero when idle, Supabase and Groq free tiers cover the rest."

---

**Next file:** `15-performance-optimizations.md` — the tricks we use to keep latency tolerable inside single HTTP requests.
