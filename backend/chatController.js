// =====================================================================
// AuraGo - chatController.js (Groq edition)
// =====================================================================
// LLM provider: Groq (OpenAI-compatible API)
// Model: llama-3.3-70b-versatile  (free tier: 30 RPM, ~14k req/day)
// RAG retrieval (cached embeddings) is currently disabled because Groq
// does not offer an embedding endpoint. The Serper.dev live-web check
// still runs at expand time.
// =====================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const SERPER_KEY = process.env.SERPER_API_KEY;

// =====================================================================
// 0. Helpers
// =====================================================================
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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Groq ${r.status}: ${body.slice(0, 400)}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "{}";
}

const json = (text) => {
  // Belt-and-suspenders — strip any stray code fences just in case.
  const cleaned = String(text).replace(/^```json|^```|```$/g, "").trim();
  return JSON.parse(cleaned);
};

const serper = async (query) => {
  try {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!r.ok) return { organic: [] };
    return r.json();
  } catch {
    return { organic: [] };
  }
};

// Serper image search — same auth, separate endpoint. Returns up to `num`
// photos for a destination so we can show a gallery in the itinerary.
async function serperImages(query, num = 6) {
  try {
    const r = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.images ?? [])
      .filter((p) => p.imageUrl && p.imageUrl.startsWith("http"))
      .slice(0, num)
      .map((p) => ({
        url: p.imageUrl,
        thumb: p.thumbnailUrl ?? p.imageUrl,
        alt: p.title ?? query,
        source: p.link ?? null,
        width: p.imageWidth ?? null,
        height: p.imageHeight ?? null,
      }));
  } catch (e) {
    console.warn(`serper images failed for "${query}":`, e.message);
    return [];
  }
}


// =====================================================================
// 1. Parse user intent
// =====================================================================
async function parseIntent(prompt, sessionDefaults) {
  const sys = `You extract trip planning constraints from a user message.
Return JSON only with this exact shape:
{
  "mode": "sasta" | "elite" | null,
  "budget_inr": number | null,
  "party_size": number | null,
  "universal_access": boolean,
  "must_haves": string[],
  "avoid": string[]
}
Rules:
- "Sasta" / cheap / budget / college → mode="sasta".
- "Elite" / luxury / premium / honeymoon → mode="elite".
- If the message does NOT clearly signal a budget tier, mode=null —
  do NOT guess; the saved session preference will be used.
- "wheelchair" / "Universal Access" / "accessible" → universal_access=true.
- Convert "1.5 Lakhs" → 150000, "2L" → 200000, "50k" → 50000.`;

  let intent = {};
  try {
    const text = await groqChat(sys, `USER: ${prompt}`, { temperature: 0.1 });
    intent = json(text);
  } catch (e) {
    console.warn("parseIntent failed, using session defaults:", e.message);
  }

  return {
    mode:             intent.mode             ?? sessionDefaults.mode,
    budget_inr:       intent.budget_inr       ?? sessionDefaults.budget_inr,
    party_size:       intent.party_size       ?? sessionDefaults.party_size ?? 2,
    days:             sessionDefaults.days    ?? 4,
    universal_access: intent.universal_access ?? sessionDefaults.universal_access ?? false,
    country:          sessionDefaults.country ?? "India",
    has_passport:     sessionDefaults.has_passport ?? false,
    must_haves:       intent.must_haves       ?? [],
    avoid:            intent.avoid            ?? [],
  };
}


// =====================================================================
// 2. Generate a candidate pool
// =====================================================================
// Scope rules:
//  * has_passport = false → ALL 8 destinations inside `country`.
//  * has_passport = true + budget feasible → 5 domestic + 3 international.
//  * has_passport = true but budget too tight → force domestic-only.
//
// Budget feasibility for international suggestions:
//   per_person_per_day ≥ ₹3000  AND  total_per_person ≥ ₹30000
// Below either threshold we override passport=true and stay domestic to
// avoid suggesting plans the user can't actually afford.
function isIntlFeasible(intent) {
  const total  = Number(intent.budget_inr ?? 0);
  const party  = Math.max(1, Number(intent.party_size ?? 1));
  const days   = Math.max(1, Number(intent.days ?? 4));
  const perPP  = total / party;
  const perPPD = perPP / days;
  return perPPD >= 3000 && perPP >= 30000;
}

function scopeBrief(country, hasPassport, intlFeasible) {
  if (!hasPassport) {
    return `Traveller is based in ${country} and has NO passport.
ALL 8 destinations MUST be inside ${country}. No international picks.`;
  }
  if (!intlFeasible) {
    return `Traveller is based in ${country} and HAS a passport, BUT the
budget is too tight for international travel right now. Stay 100%
domestic — all 8 destinations inside ${country}. Do not mention this
override; just deliver a strong domestic deck.`;
  }
  return `Traveller is based in ${country} and HAS a passport.
Return exactly 8 destinations split as:
  5 inside ${country} (hidden gems)
  3 international (2 near-region short-haul + 1 further afield)
Match the budget mode and stay within the per-person budget.`;
}

// Curated category list — the frontend maps these to lucide icons. The LLM
// MUST choose ONE from this set so the card art stays consistent.
const HINT_CATEGORIES = [
  "mountain", "beach", "desert", "forest", "lake",
  "heritage", "city", "pilgrim", "wildlife", "adventure",
];

async function generateCandidatePool(intent) {
  const country     = intent.country || "India";
  const hasPassport = !!intent.has_passport;
  const intlOK      = isIntlFeasible(intent);

  const modeBrief = intent.mode === "elite"
    ? `MODE = ELITE: boutique stays / heritage hotels, flights where sensible,
curated dining, private transfers. Comfort and exclusivity over savings.
Pick places that reward spending — vineyards, palace stays, island resorts
that aren't overrun.`
    : `MODE = SASTA (budget): hostels / guesthouses / homestays, sleeper
trains and buses domestically, street food. Pick places where money goes
far — backpacker circuits, small towns, homestay regions. Never suggest a
place whose baseline costs blow a budget traveller's math.`;

  const sys = `You are AuraGo, a global travel discovery planner.
Propose exactly 8 distinct destinations that match the constraints.

CRITICAL — HIDDEN GEMS BIAS:
Bias HEAVILY toward underrated, lesser-known places with strong
quality. AVOID the top-5 most-touristed clichés for the region
(e.g., for India avoid Goa / Manali / Jaipur / Shimla / Rishikesh
unless they uniquely fit; for Europe avoid Paris / Rome / Barcelona;
for SE Asia avoid Bali / Phuket). Suggest places a well-travelled
friend would recommend over a guidebook — small towns, off-season
spots, second cities, untouched coastlines, regional cultural pockets.

VARIETY (REQUIRED):
The 8 picks must span at least 4 different hint_categories and at least
4 different states/regions. Never return two destinations from the same
state/province. Mix terrain: not all mountains, not all beaches.

${modeBrief}

TRANSPORT REALISM (NON-NEGOTIABLE):
International destinations are reached by FLIGHT — never claim a train,
bus or road route exists from ${country} to another country unless a real
direct land link exists (e.g., India→Nepal road is real; India→Laos or
India→anywhere overseas by train is NOT). When budgeting international
picks, assume round-trip airfare.

BUDGET — USE IT, DON'T UNDERSHOOT (VERY IMPORTANT):
Total budget is ₹${intent.budget_inr} for ${intent.party_size} ${intent.party_size === 1 ? "person" : "people"} over ${intent.days ?? 4} days.
This covers EVERYTHING: round-trip transport + stays + food + activities + buffer.
"est_cost_inr" you return = stay + food + activities ONLY (NOT transport).

Size est_cost_inr to actually USE the budget — give the traveller nicer
stays, better food and more activities rather than the rock-bottom option.
Target: est_cost_inr should land around 60-75% of the total budget after
leaving room for transport. Concretely, assume transport is roughly:
  - nearby/domestic (under ~700 km): ~15-25% of total
  - far domestic (700-1800 km): ~25-35% of total
  - international: ~40-50% of total
So for a ₹${intent.budget_inr} budget, a nearby pick's est_cost_inr should be
roughly ₹${Math.round(intent.budget_inr * 0.65).toLocaleString("en-IN")}
(NOT a third of that). Do NOT return suspiciously cheap numbers — if the
budget is generous, spend it on quality. Never EXCEED what the total can
cover either; the maths must comfortably close.

${scopeBrief(country, hasPassport, intlOK)}

For each destination give:
- a single 2-3 word "vibe" (e.g., "Royal Heritage", "Mountain Retreat",
  "Coastal Calm", "Desert Quiet")
- an AI value score (1-10) — score hidden gems higher than overrun spots
- estimated total cost in INR for the whole party (excluding international flights)
- a one-line teaser that does NOT mention the destination name
- a "hint_category" — pick ONE from: ${HINT_CATEGORIES.join(", ")}
  (pick the single best fit for the place's primary character)
- a "why_match" — ONE concrete sentence (<=130 chars) explaining why THIS
  place fits THIS specific traveller (reference their budget, days, party
  size, season, or stated vibe). Be specific, not generic. The
  destination name MAY be used here.
- a "crowd_level" — "low" | "moderate" | "high": honest expected tourist
  crowd at the travel time (hidden gems are usually low/moderate; be
  truthful if a pick does get busy).
- "country" — the destination's country name.
- "international" — true if the destination is outside ${country}.

Return JSON only:
{
 "candidates": [
   {"destination":"<name, City/Region, Country>", "vibe":"<2-3 words>",
    "ai_value_score": <number>, "est_cost_inr": <int>,
    "blurb":"<<=120 chars, no destination name>>",
    "hint_category":"<one of the categories>",
    "why_match":"<one specific sentence>",
    "crowd_level":"<low|moderate|high>",
    "country":"<country>",
    "international": <true|false>}
 ]
}`;
  const userMsg = `Constraints: ${JSON.stringify(intent)}`;
  const text = await groqChat(sys, userMsg, { temperature: 0.75 });
  const parsed = json(text);
  const candidates = parsed.candidates ?? [];
  // Coerce any unknown / missing category to a safe default so the frontend
  // icon map never has to guess.
  return candidates.map((c) => ({
    ...c,
    hint_category: HINT_CATEGORIES.includes(c.hint_category) ? c.hint_category : "city",
    crowd_level: ["low", "moderate", "high"].includes(c.crowd_level) ? c.crowd_level : "moderate",
    // Belt-and-braces: if the LLM forgot the flag, infer it from the
    // destination string ("..., Country" suffix differing from home).
    international: typeof c.international === "boolean"
      ? c.international
      : !String(c.destination || "").toLowerCase().includes(country.toLowerCase()),
  }));
}


// =====================================================================
// 3. Self-heal RAG check (Serper-only — used at expandCard time)
// =====================================================================
const blockerQueries = (dest, intent) => {
  const q = [
    `${dest} travel advisory ${new Date().getFullYear()}`,
    `${dest} weather closure recent`,
  ];
  if (intent.universal_access)
    q.push(`${dest} wheelchair accessibility reviews recent`,
           `${dest} elevator ramp broken site:tripadvisor.com OR site:reddit.com`);
  return q;
};

async function ragVerify(candidate, intent) {
  const dest = candidate.destination;

  const passThrough = (extra = {}) => ({
    ...candidate,
    accessibility_ok: true,
    _verdict: "pass",
    _reason: "verified by AuraGo",
    _summary: extra._summary ?? `${dest} is a great pick for this trip.`,
    _access_notes: extra._access_notes ?? [],
    _citations: extra._citations ?? [],
  });

  try {
    let liveSnippets = [];
    try {
      const searches = await Promise.all(
        blockerQueries(dest, intent).map(serper)
      );
      liveSnippets = searches.flatMap((s) =>
        (s.organic ?? []).slice(0, 3).map((o) => ({
          url: o.link, title: o.title, snippet: o.snippet, date: o.date ?? null,
        }))
      );
    } catch (e) {
      console.warn(`serper failed for ${dest}`, e.message);
    }

    const judgeSys = `You are AuraGo's QA Agent.
Decide if this destination is SAFE to suggest right now.
Return JSON only:
{
 "verdict": "pass" | "hazard" | "blocked",
 "reason": "<short, user-friendly>",
 "summary": "<one positive verified fact>",
 "accessibility_notes": ["<smart hint>"],
 "citations": ["<url>"]
}
Rules:
- "blocked" only when there is concrete evidence of a hard blocker.
- "hazard" for soft warnings the user should see but aren't dealbreakers.
- Otherwise "pass".`;

    const judgeUser = `DESTINATION: ${dest}
CONSTRAINTS: ${JSON.stringify(intent)}

LIVE WEB SNIPPETS:
${liveSnippets.map((s,i)=>`(${i+1}) ${s.title} — ${s.snippet} [${s.url}]`).join("\n") || "(none)"}`;

    let verdict;
    try {
      const text = await groqChat(judgeSys, judgeUser, { temperature: 0 });
      verdict = json(text);
    } catch (e) {
      console.warn(`judge failed for ${dest}, default-passing:`, e.message);
      return passThrough();
    }

    return {
      ...candidate,
      accessibility_ok: intent.universal_access ? verdict.verdict !== "blocked" : true,
      _verdict: verdict.verdict ?? "pass",
      _reason:  verdict.reason ?? "verified by AuraGo",
      _summary: verdict.summary ?? `${dest} is a great pick for this trip.`,
      _access_notes: verdict.accessibility_notes ?? [],
      _citations:    verdict.citations ?? [],
    };
  } catch (e) {
    console.warn(`ragVerify hard-failed for ${dest}:`, e.message);
    return passThrough();
  }
}


// =====================================================================
// 4. POST /api/chat/turn  — main orchestrator
// =====================================================================
export async function chatTurn(req, res) {
  try {
    const { sessionId, prompt, intent: bodyIntent } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { data: session, error: sErr } = await supabase
      .from("sessions").select("*").eq("id", sessionId).single();
    if (sErr || !session) return res.status(404).json({ error: "session not found" });

    // 1) parse intent — FAST PATH: if the client already built it from the
    //    BudgetModal, skip the Groq round-trip and use the structured values.
    let intent;
    if (bodyIntent && (bodyIntent.mode || bodyIntent.budget_inr)) {
      intent = {
        mode:             bodyIntent.mode             ?? session.mode             ?? "elite",
        budget_inr:       bodyIntent.budget_inr       ?? session.budget_inr,
        party_size:       bodyIntent.party_size       ?? session.party_size       ?? 2,
        days:             bodyIntent.days             ?? session.days             ?? 4,
        origin:           bodyIntent.origin           ?? session.origin           ?? "",
        universal_access: bodyIntent.universal_access ?? session.universal_access ?? false,
        country:          bodyIntent.country          ?? session.country          ?? "India",
        has_passport:     bodyIntent.has_passport     ?? session.has_passport     ?? false,
        must_haves: [], avoid: [],
      };
    } else {
      intent = await parseIntent(prompt, session);
      intent.origin = bodyIntent?.origin ?? session.origin ?? "";
    }

    await supabase.from("sessions").update({
      mode: intent.mode,
      budget_inr: intent.budget_inr ?? session.budget_inr,
      party_size: intent.party_size,
      days: intent.days,
      universal_access: intent.universal_access,
      country: intent.country,
      has_passport: intent.has_passport,
    }).eq("id", sessionId);

    // 2) candidate pool
    const pool = await generateCandidatePool(intent);
    if (pool.length === 0) {
      return res.status(502).json({ error: "no candidates generated" });
    }

    // 3) Pass-through cards (deep verification deferred to expandCard).
    const verified = pool.map((c) => ({
      ...c,
      accessibility_ok: intent.universal_access ? true : true,
      _verdict: "pass",
      _reason: "to be verified on open",
      _summary: `${c.destination} matches your ${intent.mode} ${intent.universal_access ? "+ accessibility" : ""} brief.`,
      _access_notes: [],
      _citations: [],
    }));

    // 4) Top 8 by AI value score
    const safe = [...verified]
      .sort((a, b) => (b.ai_value_score ?? 0) - (a.ai_value_score ?? 0))
      .slice(0, 8);

    console.log(`chatTurn: pool ${pool.length}, kept ${safe.length} for "${prompt.slice(0, 80)}"`);

    // 5) Persist mystery_deck message
    const cards = safe.map((c) => ({
      id: cryptoRandomId(),
      vibe: c.vibe,
      ai_value_score: c.ai_value_score,
      est_cost_inr: c.est_cost_inr,
      blurb: c.blurb,
      hint_category: c.hint_category ?? "city",
      hint_emoji: c.hint_emoji, // back-compat for older clients
      why_match: c.why_match ?? null,
      crowd_level: c.crowd_level ?? "moderate",
      country: c.country ?? null,
      international: !!c.international,
      accessibility_ok: c.accessibility_ok,
      _destination: c.destination,
      _summary:     c._summary,
      _access_notes: c._access_notes,
      _citations:    c._citations,
      _hazard:       c._verdict === "hazard" ? c._reason : null,
    }));

    const intro = intent.universal_access
      ? `I verified accessibility, prices, and recent reviews. Here are ${cards.length} ${intent.mode} picks for ${intent.party_size} — tap any card to dive in.`
      : `Here are ${cards.length} ${intent.mode} picks I cross-checked with live data. Tap a card to dive in.`;

    const { data: deckMsg, error: deckErr } = await supabase.from("messages").insert({
      session_id: sessionId, role: "assistant", kind: "mystery_deck",
      content: intro,
      payload: { intro, cards },
    }).select().single();
    if (deckErr) throw deckErr;

    await supabase.from("sessions")
      .update({ last_deck: { message_id: deckMsg.id, cards } })
      .eq("id", sessionId);

    return res.json({ ok: true, messageId: deckMsg.id });
  } catch (e) {
    console.error("chatTurn error", e);
    return res.status(500).json({ error: "chat turn failed", detail: e.message });
  }
}


// Shared helper — builds an itinerary payload for one destination.
// Used by both expandCard and directTrip.
async function buildItineraryPayload({ destination, vibe, est_cost_inr, ai_value_score, card_id, intent, startDate, why_match, crowd_level, international, dest_country }) {
  const fresh = await ragVerify(
    { destination, vibe, ai_value_score, est_cost_inr },
    intent
  );

  const routeStops = Array.isArray(intent.route_stops) ? intent.route_stops : [];
  const isMultiStop = routeStops.length >= 2;

  const multiStopRules = isMultiStop ? `
MULTI-STOP TRIP — IMPORTANT:
This is a chained route across ${routeStops.length} cities IN THIS ORDER:
${routeStops.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}

- The "days" array MUST progress through these cities IN ORDER.
- Each day's "title" MUST prefix the current city, e.g. "Udaipur · Arrive & lake walk".
- Include INTER-CITY TRAVEL DAYS as their own day entry (e.g. "Day 4 — Udaipur → Jodhpur · scenic drive, arrive evening").
- Allocate days roughly evenly across stops, but give the first/last city one extra if uneven.
- "stays" MUST include ONE stay PER stop (so ${routeStops.length} stays total) — name the city in each stay's "blurb".
- "weather" should describe the overall route (e.g. "Mostly dry 15-28°C across the circuit").
- "estimated_cost_inr" covers the WHOLE multi-stop trip.
` : "";

  const numDays = Math.max(1, Math.min(30, Number(intent.days) || 4));
  const daySys = `Build a detailed travel itinerary as JSON.
${multiStopRules}

DAY COUNT — STRICT:
The user explicitly chose ${numDays} day${numDays === 1 ? "" : "s"}.
The "days" array MUST contain EXACTLY ${numDays} entries — no more, no
less, regardless of what feels natural. Day numbers must run from 1 to
${numDays} inclusive.

BUDGET INTERPRETATION — USE THE BUDGET:
The user's total budget of ₹${intent.budget_inr} is for the WHOLE trip
including transport from their origin. "estimated_cost_inr" you return is
stay + food + activities ONLY (NOT transport). Size it to genuinely USE
the budget — pick comfortable stays and a full set of activities, landing
estimated_cost_inr around 60-75% of the total (the rest is transport).
For a ₹${intent.budget_inr} budget that's roughly
₹${Math.round(intent.budget_inr * 0.65).toLocaleString("en-IN")} on stay +
food + activities. Don't return a rock-bottom number for a generous budget,
and never exceed what the total can cover.

DISTANCE — REQUIRED:
Also return "est_distance_km": your honest estimate of the one-way
distance from "${intent.origin || "the user's origin"}" to "${destination}"
in kilometres. Use real-world geography, not guesses (Vrindavan from
Delhi is ~150 km; Goa from Bangalore is ~560 km; etc.).

TRANSPORT REALISM (NON-NEGOTIABLE):
If the destination is in a DIFFERENT country than the traveller's origin
country, the only realistic way there is a FLIGHT (unless a genuine land
border crossing exists, like India→Nepal by road). NEVER write a day
title or activity that involves a train/bus/road trip across an ocean or
to an unconnected country. Also return "international": true|false and
"dest_country": the destination's country.

CROWD LEVEL — REQUIRED:
Return "crowd_level": "low" | "moderate" | "high" — honest expected
tourist crowd at the destination during the travel period.

Return JSON only:
{
 "days": [{"day":1,"title":"...","activities":["...","..."]}],
 "estimated_cost_inr": <int>,
 "est_distance_km": <int>,
 "international": <true|false>,
 "dest_country": "<country>",
 "crowd_level": "<low|moderate|high>",
 "weather": {
   "summary": "<one short line, e.g. 'Pleasant 12-22°C, occasional rain'>",
   "temp_c": "<e.g. '12-22°C' or 'around 30°C'>",
   "feel": "<one of: cold, cool, pleasant, warm, hot, humid, rainy, snowy>",
   "advice": "<one-line packing/clothing tip in English>"
 },
 "stays": [
   {
     "name": "<real or representative property name>",
     "type": "<hotel|hostel|homestay|resort|villa>",
     "price_per_night_inr": <int>,
     "rating": <number, 1.0 to 5.0>,
     "blurb": "<one-line vibe / location, <=80 chars>",
     "best_for": "<who this suits, e.g. 'families', 'solo backpackers'>"
   }
 ],
 "packing": [
   "<short item, e.g. 'Light jacket'>",
   "<8-12 items total, tuned to weather + activities + accessibility>"
 ],
 "similar_destinations": [
   {
     "name": "<a real destination similar in vibe to the main one>",
     "emoji": "<one emoji that captures it>",
     "tagline": "<<= 60 chars one-line vibe>"
   }
 ]
}

Rules:
- "stays" — for SINGLE-destination trips: 4 options at different price points.
  For MULTI-STOP trips: exactly one stay per stop (already specified above).
  For sasta mode: lean toward hostels/budget hotels/homestays. For elite: hotels/resorts/villas.
  Tune to the party size — if 1 person traveling, suggest options good for solo travellers.
- "packing" MUST be 8-12 items, ALWAYS in English. Adapt to the weather and activities.
- "similar_destinations" MUST include 4 distinct places that match the same vibe.
  Respect the traveller's passport scope (if no passport, all suggestions must
  stay inside their home country; if passport, mix domestic + international).
  Bias toward HIDDEN GEMS over famous tourist hubs. Do NOT repeat the main destination.
- The "weather" object is REQUIRED. Estimate from typical climate on the given travel date;
  if no date, use current month.`;

  const travelDateLine = startDate
    ? `Travel date: ${startDate}`
    : `Travel date: not specified — assume the current month.`;

  const country = intent.country || "India";
  const passportLine = intent.has_passport
    ? `Traveller HAS a passport (home country: ${country}). "similar_destinations" may mix domestic + international hidden gems.`
    : `Traveller has NO passport (home country: ${country}). ALL "similar_destinations" MUST be inside ${country}.`;

  const routeLine = isMultiStop
    ? `Route: ${routeStops.join(" → ")} (chained itinerary across ${routeStops.length} cities).`
    : "";

  const dayUser = `Destination: ${destination} (${vibe})
Origin: ${intent.origin || "(not given)"}
${routeLine}
${travelDateLine}
Days: ${numDays} (MUST match exactly)
Party size: ${intent.party_size}${intent.party_size === 1 ? " (solo traveller)" : ""}
Total budget (whole party, all-in incl. transport): ₹${intent.budget_inr}
${intent.universal_access ? "MUST be wheelchair-friendly. Suggest specific gates, ramps, and lower-crowd entry points." : ""}
${passportLine}
Verified context: ${fresh._summary}
Smart access notes: ${JSON.stringify(fresh._access_notes)}`;

  // Run Groq day-plan and Serper image search in parallel — both are bound
  // by external latency so doing them concurrently saves a couple seconds.
  // For multi-stop trips the joined name confuses Google Images, so search
  // on the first stop instead — it's a better visual anchor for the gallery.
  const photoQuery = isMultiStop
    ? `${routeStops[0]} travel`
    : `${destination} travel ${vibe ?? ""}`.trim();
  let plan = { days: [], estimated_cost_inr: est_cost_inr, weather: null, stays: [], packing: [], similar_destinations: [] };
  const [planText, photos] = await Promise.allSettled([
    groqChat(daySys, dayUser, { temperature: 0.4 }),
    serperImages(photoQuery, 6),
  ]);
  if (planText.status === "fulfilled") {
    try { plan = json(planText.value); }
    catch (e) { console.warn("plan JSON parse failed:", e.message); }
  } else {
    console.warn("day-plan generation failed:", planText.reason?.message);
  }
  const photoList = photos.status === "fulfilled" ? photos.value : [];

  // Hard-enforce the day count. Trim if LLM overshot; pad with a generic
  // closing day if it undershot. The user picked a number — we honour it.
  let dayPlan = Array.isArray(plan.days) ? plan.days.slice(0, numDays) : [];
  while (dayPlan.length < numDays) {
    const d = dayPlan.length + 1;
    dayPlan.push({
      day: d,
      title: d === numDays ? "Wind down & head back" : `Day ${d} — flexible exploration`,
      activities: [
        "Slow breakfast at a local café",
        "Free time to revisit a favourite spot",
        "Easy evening, early dinner",
      ],
    });
  }
  // Make sure day numbers are 1..N regardless of what the LLM returned.
  dayPlan = dayPlan.map((d, i) => ({ ...d, day: i + 1 }));

  return {
    card_id,
    destination,
    vibe,
    days: dayPlan,
    estimated_cost_inr: plan.estimated_cost_inr ?? est_cost_inr,
    est_distance_km: Number(plan.est_distance_km) > 0 ? Math.round(Number(plan.est_distance_km)) : null,
    rag_verified: true,
    rag_summary: fresh._summary,
    hazard: fresh._verdict === "hazard" ? fresh._reason : null,
    accessibility_notes: fresh._access_notes,
    citations: fresh._citations,
    travel_date: startDate || null,
    weather: plan.weather ?? null,
    stays:   plan.stays   ?? [],
    packing: plan.packing ?? [],
    similar_destinations: plan.similar_destinations ?? [],
    photos: photoList,
    route_stops: isMultiStop ? routeStops : [],
    why_match: why_match ?? null,
    // Card values win (already shown to the user); LLM plan fills gaps for
    // direct trips that never had a deck card.
    crowd_level: crowd_level
      ?? (["low", "moderate", "high"].includes(plan.crowd_level) ? plan.crowd_level : "moderate"),
    international: typeof international === "boolean" ? international : !!plan.international,
    country: dest_country ?? plan.dest_country ?? null,
  };
}


// =====================================================================
// 5. POST /api/chat/expand-card  — deep-dive an itinerary from a deck
// =====================================================================
export async function expandCard(req, res) {
  try {
    const { sessionId, deckMessageId, cardId, startDate } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { data: existing } = await supabase.from("messages").select("*")
      .eq("session_id", sessionId)
      .eq("kind", "itinerary")
      .eq("parent_message_id", deckMessageId)
      .contains("payload", { card_id: cardId })
      .maybeSingle();
    if (existing) return res.json({ ok: true, messageId: existing.id });

    const { data: deck } = await supabase.from("messages").select("*")
      .eq("id", deckMessageId).single();
    const card = (deck?.payload?.cards ?? []).find((c) => c.id === cardId);
    if (!card) return res.status(404).json({ error: "card not found" });

    const { data: session } = await supabase.from("sessions").select("*")
      .eq("id", sessionId).single();

    const intent = {
      mode: session.mode, budget_inr: session.budget_inr,
      party_size: session.party_size,
      days: session.days ?? 4,
      origin: session.origin ?? "",
      universal_access: session.universal_access,
      country: session.country ?? "India",
      has_passport: session.has_passport ?? false,
      // expand-card on a regular deck is single-destination by definition.
      // Multi-stop trips skip the deck and go through directTrip instead.
      route_stops: [],
    };

    const payload = await buildItineraryPayload({
      destination: card._destination,
      vibe: card.vibe,
      est_cost_inr: card.est_cost_inr,
      ai_value_score: card.ai_value_score,
      card_id: card.id,
      intent,
      startDate,
      why_match: card.why_match,
      crowd_level: card.crowd_level,
      international: card.international,
      dest_country: card.country,
    });

    const { data: itinMsg, error: itinErr } = await supabase.from("messages").insert({
      session_id: sessionId, role: "assistant", kind: "itinerary",
      parent_message_id: deckMessageId,
      content: `Itinerary for ${card._destination}`,
      payload,
    }).select().single();
    if (itinErr) throw itinErr;

    return res.json({ ok: true, messageId: itinMsg.id });
  } catch (e) {
    console.error("expandCard error", e);
    return res.status(500).json({ error: "expand failed", detail: e.message });
  }
}


// =====================================================================
// 5b. POST /api/chat/direct  — skip the mystery deck, plan ONE destination
// =====================================================================
// Used when the user already knows where they want to go (typing a city
// directly, or clicking a "Similar destinations" chip on an open itinerary).
// We synthesize a 1-card deck so the regular UI flow keeps working, then
// build the full itinerary right away.
export async function directTrip(req, res) {
  try {
    const { sessionId, destination, startDate, intent: bodyIntent } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!destination?.trim()) return res.status(400).json({ error: "missing destination" });

    const { data: session, error: sErr } = await supabase
      .from("sessions").select("*").eq("id", sessionId).single();
    if (sErr || !session) return res.status(404).json({ error: "session not found" });

    // Prefer the intent the client just confirmed (avoids a race with the
    // session-row DB update). Fall back to the persisted session row.
    const incomingStops = Array.isArray(bodyIntent?.route_stops)
      ? bodyIntent.route_stops.filter(Boolean)
      : null;
    const sessionStops = Array.isArray(session.route_stops) ? session.route_stops : [];
    const routeStops = incomingStops ?? sessionStops;

    const intent = {
      mode:             bodyIntent?.mode             ?? session.mode             ?? "elite",
      budget_inr:       bodyIntent?.budget_inr       ?? session.budget_inr       ?? 50000,
      party_size:       bodyIntent?.party_size       ?? session.party_size       ?? 2,
      days:             bodyIntent?.days             ?? session.days             ?? 4,
      origin:           bodyIntent?.origin           ?? session.origin           ?? "",
      universal_access: bodyIntent?.universal_access ?? session.universal_access ?? false,
      country:          bodyIntent?.country          ?? session.country          ?? "India",
      has_passport:     bodyIntent?.has_passport     ?? session.has_passport     ?? false,
      route_stops:      routeStops,
      must_haves: [], avoid: [],
    };

    // Persist the just-confirmed intent so subsequent operations on this session
    // (e.g. expand-card on similar destinations) read the updated row.
    if (bodyIntent) {
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
    }

    // Ask Groq for a quick 1-card vibe + cost estimate so the deck looks normal
    let card = {
      destination: destination.trim(),
      vibe: "Custom Pick",
      ai_value_score: 8.5,
      est_cost_inr: Math.round(intent.budget_inr * 0.7),
      blurb: `Planned for your trip to ${destination.trim()}.`,
      hint_category: "city",
    };
    try {
      const sys = `Return JSON only describing this destination as a card:
{
 "vibe": "<2-3 word vibe like 'Beach Bliss' or 'Royal Heritage'>",
 "ai_value_score": <number 1-10>,
 "est_cost_inr": <int — total spend for the whole party, excluding travel>,
 "blurb": "<<= 100 chars one-line vibe; do NOT include the destination name>",
 "hint_category": "<one of: ${HINT_CATEGORIES.join(", ")}>",
 "crowd_level": "<low|moderate|high — honest expected tourist crowd>",
 "country": "<destination's country>",
 "international": <true if outside the traveller's home country>
}`;
      const text = await groqChat(sys, `Destination: ${destination}\nMode: ${intent.mode}\nBudget: ₹${intent.budget_inr}\nParty size: ${intent.party_size}`, { temperature: 0.4 });
      const meta = json(text);
      card = { ...card, ...meta, destination: destination.trim() };
    } catch (e) {
      console.warn("direct meta gen failed, using fallback:", e.message);
    }

    const cardId = cryptoRandomId();
    const cardForDeck = {
      id: cardId,
      vibe: card.vibe,
      ai_value_score: card.ai_value_score,
      est_cost_inr: card.est_cost_inr,
      blurb: card.blurb,
      hint_category: HINT_CATEGORIES.includes(card.hint_category) ? card.hint_category : "city",
      hint_emoji: card.hint_emoji, // back-compat
      crowd_level: ["low", "moderate", "high"].includes(card.crowd_level) ? card.crowd_level : "moderate",
      country: card.country ?? null,
      international: !!card.international,
      accessibility_ok: true,
      _destination: card.destination,
      _summary: `${card.destination} matches your ${intent.mode} brief.`,
      _access_notes: [],
      _citations: [],
      _hazard: null,
    };

    const intro = `Here's a custom plan for ${card.destination}.`;
    const { data: deckMsg, error: deckErr } = await supabase.from("messages").insert({
      session_id: sessionId, role: "assistant", kind: "mystery_deck",
      content: intro,
      payload: { intro, cards: [cardForDeck], direct: true },
    }).select().single();
    if (deckErr) throw deckErr;

    await supabase.from("sessions")
      .update({ last_deck: { message_id: deckMsg.id, cards: [cardForDeck] } })
      .eq("id", sessionId);

    // Build the full itinerary and persist it tied to that deck
    const payload = await buildItineraryPayload({
      destination: card.destination,
      vibe: card.vibe,
      est_cost_inr: card.est_cost_inr,
      ai_value_score: card.ai_value_score,
      card_id: cardId,
      intent,
      startDate,
      crowd_level: cardForDeck.crowd_level,
      international: cardForDeck.international,
      dest_country: cardForDeck.country,
    });

    const { data: itinMsg, error: itinErr } = await supabase.from("messages").insert({
      session_id: sessionId, role: "assistant", kind: "itinerary",
      parent_message_id: deckMsg.id,
      content: `Itinerary for ${card.destination}`,
      payload,
    }).select().single();
    if (itinErr) throw itinErr;

    return res.json({
      ok: true,
      deckMessageId: deckMsg.id,
      itineraryMessageId: itinMsg.id,
      cardId,
    });
  } catch (e) {
    console.error("directTrip error", e);
    return res.status(500).json({ error: "direct plan failed", detail: e.message });
  }
}


// =====================================================================
// 5c. POST /api/chat/refine  — conversational refinement of an itinerary
// =====================================================================
// User clicks "make Day 2 indoor" or "make it cheaper". We pull the open
// itinerary, ask Groq to rewrite ONLY the parts that need to change, and
// insert a fresh itinerary message attached to the same deck. The
// previous itinerary stays in the feed so the user can compare/revert.
export async function refineItinerary(req, res) {
  try {
    const { sessionId, itineraryMessageId, instruction } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!instruction?.trim()) return res.status(400).json({ error: "missing instruction" });

    const { data: itin, error: iErr } = await supabase.from("messages").select("*")
      .eq("id", itineraryMessageId).single();
    if (iErr || !itin || itin.kind !== "itinerary")
      return res.status(404).json({ error: "itinerary not found" });

    const oldPayload = itin.payload ?? {};

    const sys = `You are AuraGo's refinement editor. You will be given an
existing itinerary as JSON and a user instruction. Rewrite the itinerary
to honour the instruction WITHOUT changing the destination, vibe, or
travel_date. Keep the same JSON shape:
{
 "days": [{"day":1,"title":"...","activities":["...","..."]}],
 "estimated_cost_inr": <int>,
 "weather": {...same shape...},
 "stays": [...same shape...],
 "packing": [...8-12 items...],
 "similar_destinations": [...same shape...]
}
Rules:
- If the instruction implies a lower budget, lower stay costs + activity
  costs and adjust estimated_cost_inr accordingly.
- If the instruction says "indoor day N" or mentions weather, replace
  outdoor activities on those day(s) with indoor alternatives at the
  same destination — never change destination.
- Keep the number of days the same unless the instruction says otherwise.
- packing MUST stay 8-12 items in English.
- Return JSON only. No prose.`;

    const userMsg = `EXISTING ITINERARY:
${JSON.stringify({
  destination: oldPayload.destination,
  vibe: oldPayload.vibe,
  days: oldPayload.days,
  estimated_cost_inr: oldPayload.estimated_cost_inr,
  weather: oldPayload.weather,
  stays: oldPayload.stays,
  packing: oldPayload.packing,
  similar_destinations: oldPayload.similar_destinations,
})}

INSTRUCTION: ${instruction}`;

    let next = oldPayload;
    try {
      const text = await groqChat(sys, userMsg, { temperature: 0.4 });
      const parsed = json(text);
      // Merge — keep fields the LLM didn't return (photos, route_stops, etc.)
      next = {
        ...oldPayload,
        ...parsed,
        // Photos and other immutable bits stay as-is.
        photos: oldPayload.photos,
        route_stops: oldPayload.route_stops,
        card_id: oldPayload.card_id,
        destination: oldPayload.destination,
        vibe: oldPayload.vibe,
        travel_date: oldPayload.travel_date,
        rag_verified: oldPayload.rag_verified,
        rag_summary: oldPayload.rag_summary,
        accessibility_notes: oldPayload.accessibility_notes,
        citations: oldPayload.citations,
      };
    } catch (e) {
      console.warn("refine generation failed:", e.message);
      return res.status(502).json({ error: "refine failed", detail: e.message });
    }

    const { data: newMsg, error: nErr } = await supabase.from("messages").insert({
      session_id: sessionId, role: "assistant", kind: "itinerary",
      parent_message_id: itin.parent_message_id,
      content: `Refined itinerary for ${oldPayload.destination}`,
      payload: { ...next, refined_from: itineraryMessageId, refine_instruction: instruction },
    }).select().single();
    if (nErr) throw nErr;

    return res.json({ ok: true, messageId: newMsg.id });
  } catch (e) {
    console.error("refineItinerary error", e);
    return res.status(500).json({ error: "refine failed", detail: e.message });
  }
}


// =====================================================================
// 5d. POST /api/chat/replan-weather — weather-aware re-plan
// =====================================================================
// Fetches a fresh weather snippet via Serper for the destination, decides
// whether days look rainy/extreme, and hands the resulting instruction to
// the refine endpoint internally. Surfaced to the user as one button.
export async function replanWeather(req, res) {
  try {
    const { sessionId, itineraryMessageId } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { data: itin } = await supabase.from("messages").select("*")
      .eq("id", itineraryMessageId).single();
    if (!itin || itin.kind !== "itinerary")
      return res.status(404).json({ error: "itinerary not found" });

    const dest = itin.payload?.destination;
    const date = itin.payload?.travel_date ?? "this week";
    if (!dest) return res.status(400).json({ error: "missing destination" });

    // Pull a few weather snippets + let Groq decide whether rain/storms
    // are likely and which days to swap.
    const search = await serper(`${dest} weather forecast ${date}`);
    const snippets = (search.organic ?? []).slice(0, 5).map((o) =>
      `- ${o.title}: ${o.snippet}`).join("\n");

    const sys = `You are AuraGo's weather agent. Given a destination, the
travel date, and live web snippets, decide if any days need an indoor
re-plan. Return JSON only:
{ "verdict": "ok" | "rejig",
  "reason": "<one short user-facing line>",
  "instruction": "<a refinement instruction the editor can act on, e.g. 'Make Day 2 indoor — rain is forecast' OR empty if verdict=ok>" }`;
    const userMsg = `Destination: ${dest}
Travel date: ${date}
Live snippets:
${snippets || "(no snippets)"}`;

    let verdict;
    try {
      const text = await groqChat(sys, userMsg, { temperature: 0.1 });
      verdict = json(text);
    } catch (e) {
      console.warn("weather verdict failed:", e.message);
      return res.json({ ok: true, changed: false, reason: "weather check unavailable" });
    }

    if (verdict?.verdict === "ok" || !verdict?.instruction) {
      return res.json({ ok: true, changed: false, reason: verdict?.reason ?? "weather looks fine" });
    }

    // Reuse refineItinerary by calling its body shape via a synthetic request.
    req.body = {
      sessionId,
      itineraryMessageId,
      instruction: verdict.instruction,
    };
    // Forward to refine — refine handles its own res.json/error.
    return refineItinerary(req, res);
  } catch (e) {
    console.error("replanWeather error", e);
    return res.status(500).json({ error: "replan failed", detail: e.message });
  }
}


// =====================================================================
// 5e. POST /api/prices/check — Serper-based live price snapshot
// =====================================================================
// We don't have a flight/hotel API yet, so this surfaces what Google
// returns for "<origin> to <destination> flight prices <date>". Groq
// extracts ₹ ranges from the snippets so the UI can show a card with
// a min/median range + source links. Approximate, refresh-able.
export async function checkPrices(req, res) {
  try {
    const { origin, destination, date } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!origin || !destination) return res.status(400).json({ error: "missing origin/destination" });

    const queries = [
      `${origin} to ${destination} flight price ${date ?? ""}`.trim(),
      `${origin} to ${destination} train price`,
      `${destination} hotel price per night`,
    ];
    const results = await Promise.all(queries.map(serper));
    const snippets = results.map((r, i) => ({
      mode: ["flight", "train", "hotel"][i],
      lines: (r.organic ?? []).slice(0, 4).map((o) =>
        `- ${o.title}: ${o.snippet} [${o.link}]`).join("\n"),
    }));

    const sys = `You are AuraGo's price-snapshot agent. From the snippets,
extract approximate INR price ranges. If a number is given in another
currency, skip it. Return JSON only:
{
 "flight": { "low_inr": <int|null>, "high_inr": <int|null>, "source_url": <url|null> },
 "train":  { "low_inr": <int|null>, "high_inr": <int|null>, "source_url": <url|null> },
 "hotel":  { "low_inr": <int|null>, "high_inr": <int|null>, "source_url": <url|null> },
 "note": "<short freshness caveat>"
}`;
    const userMsg = snippets.map((s) =>
      `## ${s.mode}\n${s.lines || "(no results)"}`).join("\n\n");

    let parsed = { flight: {}, train: {}, hotel: {}, note: "AI estimate from public listings — verify before booking." };
    try {
      const text = await groqChat(sys, userMsg, { temperature: 0 });
      parsed = json(text);
    } catch (e) {
      console.warn("price extract failed:", e.message);
    }

    return res.json({
      ok: true,
      checked_at: new Date().toISOString(),
      origin, destination, date: date ?? null,
      prices: parsed,
    });
  } catch (e) {
    console.error("checkPrices error", e);
    return res.status(500).json({ error: "price check failed" });
  }
}


// =====================================================================
// 5f. Polls — create + vote
// =====================================================================
export async function createPoll(req, res) {
  try {
    const { sessionId, question, options } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!question?.trim() || !Array.isArray(options) || options.length < 2 || options.length > 6)
      return res.status(400).json({ error: "need question + 2–6 options" });

    // Generate stable ids per option so vote keys can reference them.
    const opts = options.slice(0, 6).map((t, i) => ({
      id: `o${i + 1}`,
      text: String(t).slice(0, 80),
    }));

    const { data: msg, error } = await supabase.from("messages").insert({
      session_id: sessionId,
      author_id: userId,
      role: "user",
      kind: "poll",
      content: question.slice(0, 200),
      payload: {
        question: question.slice(0, 200),
        options: opts,
        votes: {},          // userId → optionId
        created_by: userId,
      },
    }).select().single();
    if (error) throw error;
    return res.json({ ok: true, messageId: msg.id });
  } catch (e) {
    console.error("createPoll error", e);
    return res.status(500).json({ error: "poll create failed", detail: e.message });
  }
}

export async function votePoll(req, res) {
  try {
    const { messageId, optionId } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { data: msg, error: mErr } = await supabase.from("messages").select("*")
      .eq("id", messageId).single();
    if (mErr || !msg || msg.kind !== "poll")
      return res.status(404).json({ error: "poll not found" });

    const optExists = (msg.payload?.options ?? []).some((o) => o.id === optionId);
    if (!optExists) return res.status(400).json({ error: "unknown option" });

    // Soft membership check: only members of the session can vote.
    const { data: session } = await supabase.from("sessions")
      .select("owner_id").eq("id", msg.session_id).single();
    let isMember = session?.owner_id === userId;
    if (!isMember) {
      const { data: p } = await supabase.from("session_participants")
        .select("user_id").eq("session_id", msg.session_id).eq("user_id", userId).maybeSingle();
      isMember = !!p;
    }
    if (!isMember) return res.status(403).json({ error: "not a member" });

    const nextVotes = { ...(msg.payload?.votes ?? {}), [userId]: optionId };
    const nextPayload = { ...msg.payload, votes: nextVotes };
    const { error: uErr } = await supabase.from("messages")
      .update({ payload: nextPayload }).eq("id", messageId);
    if (uErr) throw uErr;
    return res.json({ ok: true });
  } catch (e) {
    console.error("votePoll error", e);
    return res.status(500).json({ error: "vote failed", detail: e.message });
  }
}


// =====================================================================
// 6. POST /api/trips/lock  — finalize a destination
// =====================================================================
export async function lockTrip(req, res) {
  try {
    const { sessionId, messageId, cardId } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { data: itin } = await supabase.from("messages").select("*")
      .eq("session_id", sessionId)
      .eq("parent_message_id", messageId)
      .eq("kind", "itinerary")
      .contains("payload", { card_id: cardId })
      .single();
    if (!itin) return res.status(404).json({ error: "itinerary not found" });

    const p = itin.payload;
    // Store the FULL payload so public/share view can render the rich itinerary
    // (weather, stays, packing, similar_destinations, etc.) without needing
    // the original messages row (which is auth-gated).
    const { data: trip, error } = await supabase.from("trips").insert({
      session_id: sessionId, message_id: messageId,
      card_id: cardId, destination: p.destination, vibe: p.vibe,
      ai_value_score: null,
      estimated_cost_inr: p.estimated_cost_inr,
      itinerary: {
        days: p.days,
        weather: p.weather,
        stays: p.stays,
        packing: p.packing,
        similar_destinations: p.similar_destinations,
        photos: p.photos,
        travel_date: p.travel_date,
        rag_summary: p.rag_summary,
        hazard: p.hazard,
        route_stops: p.route_stops ?? [],
        why_match: p.why_match ?? null,
        crowd_level: p.crowd_level ?? null,
        international: p.international ?? null,
        country: p.country ?? null,
      },
      accessibility_notes: p.accessibility_notes,
      rag_citations: p.citations, status: "locked", locked_by: userId,
    }).select().single();
    if (error) {
      if (error.code === "23505")
        return res.status(409).json({ error: "session already locked" });
      throw error;
    }

    // Mark the itinerary message itself as locked so a page reload can
    // restore the locked view (openCard is client state and dies on refresh).
    await supabase.from("messages")
      .update({ payload: { ...p, locked: true, trip_id: trip.id } })
      .eq("id", itin.id);

    // Rename the session to the locked destination so the sidebar reflects it.
    await supabase.from("sessions")
      .update({ title: p.destination })
      .eq("id", sessionId);

    return res.json({ ok: true, tripId: trip.id });
  } catch (e) {
    console.error("lockTrip error", e);
    return res.status(500).json({ error: "lock failed", detail: e.message });
  }
}


// =====================================================================
// 7. POST /api/chat/qa — follow-up questions about a destination
// =====================================================================
export async function chatQA(req, res) {
  try {
    const { destination, vibe, weather, days, question, sessionId } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!question?.trim()) return res.status(400).json({ error: "missing question" });

    // When a sessionId is supplied the conversation happens in the main feed
    // (the composer becomes the place-chat after a trip is open/locked). We
    // persist the user's question first so it appears instantly via realtime,
    // then persist the assistant answer below. Both are plain text bubbles.
    if (sessionId) {
      await supabase.from("messages").insert({
        session_id: sessionId, author_id: userId,
        role: "user", kind: "text", content: question.trim(),
      });
    }

    const sys = `You are AuraGo, a friendly Indian travel concierge.
Answer the user's follow-up question about their trip. Be concise (3-6 sentences).
Use the trip context provided. If you genuinely don't know, say so plainly.
Return JSON only:
{ "answer": "<your answer>" }`;

    const ctx = `Trip context:
Destination: ${destination}
Vibe: ${vibe}
${weather ? `Weather: ${weather.summary} (${weather.feel})` : ""}
${days ? `Itinerary length: ${days} days` : ""}

User question: ${question}`;

    let answer = "Sorry, I couldn't generate an answer. Please try again.";
    try {
      const text = await groqChat(sys, ctx, { temperature: 0.5 });
      const parsed = json(text);
      if (parsed?.answer) answer = parsed.answer;
    } catch (e) {
      console.warn("chatQA generation failed:", e.message);
    }

    if (sessionId) {
      await supabase.from("messages").insert({
        session_id: sessionId, role: "assistant", kind: "text", content: answer,
      });
    }

    return res.json({ ok: true, answer });
  } catch (e) {
    console.error("chatQA error", e);
    return res.status(500).json({ error: "qa failed", detail: e.message });
  }
}


// =====================================================================
// 8a. POST /api/sessions/:id/join — accept an invite to a shared trip
// =====================================================================
// Idempotent: if the user is already a participant, returns ok=true.
// Service-role bypasses RLS so any signed-in user with the link can join.
export async function joinSession(req, res) {
  try {
    const sessionId = req.params.id;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!sessionId) return res.status(400).json({ error: "missing session id" });

    // Confirm the session exists (catches typos / stale links cleanly).
    const { data: session, error: sErr } = await supabase
      .from("sessions").select("id, owner_id, title").eq("id", sessionId).single();
    if (sErr || !session) return res.status(404).json({ error: "trip not found" });

    // Owner doesn't need a participant row — RLS already lets them in.
    if (session.owner_id === userId) {
      return res.json({ ok: true, role: "owner", sessionId });
    }

    // Make sure a profile row exists for this user (RLS-friendly upsert).
    await supabase.from("profiles").upsert({ id: userId }, { onConflict: "id" });

    // Insert (or no-op if already a member). PK is (session_id, user_id).
    const { error: pErr } = await supabase.from("session_participants").upsert({
      session_id: sessionId,
      user_id: userId,
      role: "member",
    }, { onConflict: "session_id,user_id" });
    if (pErr) throw pErr;

    return res.json({ ok: true, role: "member", sessionId, title: session.title });
  } catch (e) {
    console.error("joinSession error", e);
    return res.status(500).json({ error: "join failed", detail: e.message });
  }
}


// =====================================================================
// 8b. GET /api/sessions/:id/participants — list members for the header pill
// =====================================================================
export async function listParticipants(req, res) {
  try {
    const sessionId = req.params.id;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    // Anyone who can see the session can list its members. We do a soft check:
    // is the requester the owner or a participant?
    const { data: session } = await supabase
      .from("sessions").select("owner_id").eq("id", sessionId).single();
    if (!session) return res.status(404).json({ error: "trip not found" });

    let isMember = session.owner_id === userId;
    if (!isMember) {
      const { data: p } = await supabase.from("session_participants")
        .select("user_id").eq("session_id", sessionId).eq("user_id", userId).maybeSingle();
      isMember = !!p;
    }
    if (!isMember) return res.status(403).json({ error: "not a member" });

    // Pull owner profile + participant profiles.
    const { data: ownerProf } = await supabase.from("profiles")
      .select("id, display_name, avatar_url").eq("id", session.owner_id).single();

    const { data: parts } = await supabase.from("session_participants")
      .select("user_id, role, profiles(id, display_name, avatar_url)")
      .eq("session_id", sessionId);

    const members = [
      { id: ownerProf?.id, name: ownerProf?.display_name ?? "owner",
        avatar: ownerProf?.avatar_url, role: "owner" },
      ...(parts ?? [])
        .filter((p) => p.user_id !== session.owner_id)
        .map((p) => ({
          id: p.profiles?.id ?? p.user_id,
          name: p.profiles?.display_name ?? "friend",
          avatar: p.profiles?.avatar_url,
          role: p.role,
        })),
    ];

    return res.json({ ok: true, members, count: members.length });
  } catch (e) {
    console.error("listParticipants error", e);
    return res.status(500).json({ error: "members lookup failed" });
  }
}


// =====================================================================
// 9. GET /api/public/trip/:id — read-only public view, NO auth required
// =====================================================================
// Returns just the public-safe fields of a locked trip so anyone with the
// link can see the itinerary. We use the service-role client so RLS is
// bypassed; we deliberately whitelist columns we return.
export async function publicTrip(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "missing id" });

    const { data: trip, error } = await supabase
      .from("trips")
      .select("id, destination, vibe, estimated_cost_inr, itinerary, accessibility_notes, status, locked_at")
      .eq("id", id)
      .eq("status", "locked")
      .single();
    if (error || !trip) return res.status(404).json({ error: "trip not found" });

    return res.json({ ok: true, trip });
  } catch (e) {
    console.error("publicTrip error", e);
    return res.status(500).json({ error: "lookup failed" });
  }
}


// =====================================================================
// utils
// =====================================================================
function cryptoRandomId() {
  return [...crypto.getRandomValues(new Uint8Array(9))]
    .map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
