# 16 · Future improvements

This file is the honest roadmap. Each item describes what AuraGo would look like if we built it, what new tech is involved, and the trigger that would make it worth doing.

## Tier 1 — Things that would change the product feel

### 1. Cross-session personalisation via embeddings

Today every session starts cold — AuraGo doesn't remember that you've already planned 3 Himalayan trips and might prefer a coast next time.

**What we'd build:**
- Embed each locked trip's `destination + vibe + days + activities` into a 1536-dim vector.
- Store in `rag_documents` (the table is already there).
- On new session creation, retrieve top-3 similar past trips for the user.
- Inject as context into `generateCandidatePool`: "User has previously enjoyed: Spiti (mountain quiet), Hampi (heritage stones). Bias toward similar vibes."

**New tech needed:** OpenAI's `text-embedding-3-small` (or Cohere Free). About 2 hours of work.

**Trigger:** when users have ≥ 3 locked trips on average. Today most users have 0–1.

### 2. Voice input

"Plan a weekend trip from Bangalore for 4 people under 25k" is faster to say than to type.

**What we'd build:**
- Web Speech API integration in the composer.
- Existing `parseIntent` already handles unstructured input.

**New tech needed:** None. Web Speech API is in browsers.

**Trigger:** mobile usage > 60%. Today desktop dominates.

### 3. Real-time price alerts

"Goa flight prices dropped 15% — re-plan?"

**What we'd build:**
- Cloud Scheduler runs daily.
- For each locked trip with travel_date in the next 60 days, refresh `checkPrices`.
- If a price drops more than 10%, insert an `alert` message (this kind is already allowed in `messages.kind`).
- Frontend renders alerts as a notification chip.

**New tech needed:** Cloud Scheduler + a cron-only endpoint.

**Trigger:** when users actually book through our links (currently we don't track that).

### 4. PWA install + offline locked trips

Make AuraGo installable like a native app, and let users view their locked itinerary even on a flight without wifi.

**What we'd build:**
- `manifest.json` with icons, name, theme color.
- Service worker that caches the React bundle + the locked trip's JSON for offline.

**New tech needed:** None beyond a service worker file.

**Trigger:** mobile share rate above 30%. Right now most shares happen via WhatsApp link, which doesn't need install.

### 5. WhatsApp share format

In India, 90% of trip planning happens in WhatsApp groups. A "Share to WhatsApp" button that produces a pre-formatted card would 10× share rate.

**What we'd build:**
- A `/share/whatsapp/<tripId>` route that returns a formatted text + image.
- Uses WhatsApp's `wa.me/?text=` URL scheme.

**New tech needed:** Maybe a small image-rendering service (Vercel OG or Cloud Run + Puppeteer).

**Trigger:** any time. Cheap and high-impact for India market.

## Tier 2 — Things that would move AuraGo toward actual agents

### 6. Replace the orchestrator with a real agent framework

Today, Express decides every step. The LLM never picks the next step. To make AuraGo genuinely "agentic":

**What we'd build:**
- Migrate `chatTurn / expandCard / refineItinerary` to **LangGraph** nodes.
- Define one "planner" agent that decides which sub-prompts to run.
- Define a "critic" agent that reviews itineraries and re-prompts the planner if budget is exceeded.

**New tech needed:** LangGraph (or CrewAI). ~2 weeks of refactoring.

**Trigger:** when the orchestration logic gets too tangled for the controller pattern (probably never for a side project; possible in a v2 startup).

### 7. Tool use — LLM picks which API to call

Today, the controller decides "use Serper for destination images". A true tool-using agent would let the LLM decide: "the user asked about prices, so I need to call the prices tool."

**What we'd build:**
- A tool registry: `search_web`, `get_weather`, `get_prices`, `get_images`, `lock_trip`.
- The LLM picks tools via function-calling (Groq supports it; OpenAI-compatible).
- The orchestrator becomes a thin loop that calls whichever tool the LLM requested.

**Trigger:** when there are more than ~5 distinct tools. Today we have 4 controllers worth of tools.

### 8. Real agent memory via Mem0 or Letta

Currently the LLM is stateless. Cross-session preferences (vegetarian, hates cold weather, prefers train over flight) would need an actual memory store.

**What we'd build:**
- Add Mem0 SDK.
- Per user, store extracted preferences from conversations.
- Inject relevant memories into the system prompt for `generateCandidatePool` and `chatQA`.

**New tech needed:** Mem0 (free tier exists) or self-hosted Letta.

**Trigger:** when manual preference-saving becomes annoying. Right now we cover this with explicit profile fields.

## Tier 3 — Things that would make AuraGo a real product

### 9. Real flight/hotel inventory

Today, "Booking links" go out to Skyscanner/Booking.com etc. and the "Live price snapshot" is AI-extracted from Google snippets.

**What we'd build:**
- Affiliate partnerships with Skyscanner / Booking.com / MakeMyTrip / Cleartrip.
- Real-time API integrations for flights (Amadeus / Sabre wholesale) and hotels (Booking Affiliate API).
- Price snapshot becomes real inventory.

**Trigger:** when we're ready to take revenue. This is the entire business model of a real OTA.

### 10. Booking-inside-the-app

Today, clicking a booking link sends users to Skyscanner. To capture conversion, we'd need to take payments.

**What we'd build:**
- Stripe or Razorpay integration.
- Custom checkout for stays first (highest-margin, simplest inventory).
- We'd be a real OTA.

**Trigger:** when we have enough monthly active users that 1% conversion is meaningful revenue (~10k MAUs at ₹200 avg margin per booking = ₹20k/month, the bar to bother).

### 11. Pro tier with billing

A free product needs a business model. Pro tier candidates:

| Feature | Price |
|---|---|
| Unlimited trips (vs current 5) | $5/month |
| Priority AI generation (no rate limits) | $5/month |
| Hide ads | $5/month |
| Higher-quality LLM (Claude 3.5 vs Llama 3.3) | $10/month |

**New tech needed:** Stripe + a `subscriptions` table + webhook handling.

**Trigger:** when there's value worth paying for. Today the free tier is plenty.

## Tier 4 — Quality-of-life polish

### 12. Real i18n for Hindi UI

The product has Hinglish baked into the copy (`thand / garmi / barish`). A true Hindi UI would mean:

- Add `react-i18next`.
- Translate all copy into `en` + `hi` JSON files.
- Toggle in sidebar.

**Trigger:** when ≥ 20% of users are Hindi-first.

### 13. Multi-city plans inside the same itinerary

Multi-stop trips work in 1 itinerary today. Going further — automatic city-to-city optimisation, multi-day inter-city splits — would need:

- A "route optimiser" prompt or actual algorithm.
- UI changes to show the chained map more clearly.

**Trigger:** when users request 4+ stop trips regularly.

### 14. Visa requirement detection for international trips

For users with passport=true, automatically detect visa requirements based on (home country, destination).

**What we'd build:**
- Static JSON of visa rules per country pair (~200 KB).
- Surface as a "Visa: Required / Visa on Arrival / Visa-free" chip in the itinerary header.

**Trigger:** when international planning hits 10% of sessions.

### 15. Hindi + English voice concierge

Phone in hand, ask AuraGo a question, get a spoken answer.

**What we'd build:**
- Web Speech API for input.
- ElevenLabs or browser TTS for output.

**Trigger:** when mobile usage dominates.

## Tier 5 — Infrastructure maturity

### 16. Move secrets to Google Secret Manager

Currently in `cloudbuild.yaml`. For production maturity:

**What we'd build:**
- Add secrets to Secret Manager.
- Cloud Run mounts them via `--update-secrets`.

**Trigger:** before showing to investors. Easy upgrade.

### 17. Sentry / error tracking

Cloud Logging is enough for debugging; Sentry would alert us on errors.

**Trigger:** when we have paying users and need an SLA.

### 18. Rate limiting

`express-rate-limit` or Cloud Armor. Protects against abuse and surprise bills.

**Trigger:** first abuse incident.

### 19. Move to asia-south1 region

Cloud Run is in `us-central1` today (~250 ms RTT from India). Moving to `asia-south1` cuts that to ~30 ms.

**Trigger:** when users notice. Most don't because Groq latency dominates anyway.

## What we will NOT do

| Idea | Why not |
|---|---|
| Build our own LLM | Cost, expertise, and no measurable advantage |
| Build a mobile app (React Native) | PWA covers it for now |
| Real-time presence (cursors, "X is typing") | Cool, not value-additive |
| Crypto / NFT / blockchain anything | No |
| AI travel agent that books for you autonomously | Liability, trust, regulatory issues |
| Generate fake reviews | Ethically out |
| Scrape competitor data | Out |

## How to decide what to build next

Three questions for any new feature:

1. **Does it materially change product perception?** ("8 hidden gems in 30 seconds" did. "Add a settings toggle" doesn't.)
2. **Can it be built in under a week?** If not, it usually shouldn't be next.
3. **Is the trigger condition actually met?** Don't build for hypothetical scale.

If yes to all three, build it. Otherwise, document it here and move on.

---

**Next file:** `17-build-from-scratch-guide.md` — step-by-step rebuild from a fresh repo.
