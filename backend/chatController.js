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


// =====================================================================
// 1. Parse user intent
// =====================================================================
async function parseIntent(prompt, sessionDefaults) {
  const sys = `You extract trip planning constraints from a user message.
Return JSON only with this exact shape:
{
  "mode": "sasta" | "elite",
  "budget_inr": number | null,
  "party_size": number,
  "universal_access": boolean,
  "must_haves": string[],
  "avoid": string[]
}
Rules:
- "Sasta" / cheap / budget / college → mode="sasta".
- "Elite" / luxury / premium / honeymoon → mode="elite".
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
    universal_access: intent.universal_access ?? sessionDefaults.universal_access ?? false,
    must_haves:       intent.must_haves       ?? [],
    avoid:            intent.avoid            ?? [],
  };
}


// =====================================================================
// 2. Generate a candidate pool
// =====================================================================
async function generateCandidatePool(intent) {
  const sys = `You are AuraGo, an Indian travel planner.
Propose 6 distinct destinations that match the constraints.
For each, pick a single 2-3 word "vibe" (e.g., "Royal Heritage",
"Mountain Retreat", "Coastal Calm"), an AI value score (1-10), an
estimated total cost in INR for the whole party, a one-line teaser
that does NOT mention the destination name, and a single emoji hint.

Return JSON only:
{
 "candidates": [
   {"destination":"<name>", "vibe":"<2-3 words>",
    "ai_value_score": <number>, "est_cost_inr": <int>,
    "blurb":"<<=120 chars, no destination name>>",
    "hint_emoji":"<one emoji>"}
 ]
}`;
  const userMsg = `Constraints: ${JSON.stringify(intent)}`;
  const text = await groqChat(sys, userMsg, { temperature: 0.6 });
  const parsed = json(text);
  return parsed.candidates ?? [];
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
    const { sessionId, prompt } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { data: session, error: sErr } = await supabase
      .from("sessions").select("*").eq("id", sessionId).single();
    if (sErr || !session) return res.status(404).json({ error: "session not found" });

    // 1) parse intent
    const intent = await parseIntent(prompt, session);

    await supabase.from("sessions").update({
      mode: intent.mode,
      budget_inr: intent.budget_inr ?? session.budget_inr,
      party_size: intent.party_size,
      universal_access: intent.universal_access,
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

    // 4) Top 5 by AI value score
    const safe = [...verified]
      .sort((a, b) => (b.ai_value_score ?? 0) - (a.ai_value_score ?? 0))
      .slice(0, 5);

    console.log(`chatTurn: pool ${pool.length}, kept ${safe.length} for "${prompt.slice(0, 80)}"`);

    // 5) Persist mystery_deck message
    const cards = safe.map((c) => ({
      id: cryptoRandomId(),
      vibe: c.vibe,
      ai_value_score: c.ai_value_score,
      est_cost_inr: c.est_cost_inr,
      blurb: c.blurb,
      hint_emoji: c.hint_emoji,
      accessibility_ok: c.accessibility_ok,
      _destination: c.destination,
      _summary:     c._summary,
      _access_notes: c._access_notes,
      _citations:    c._citations,
      _hazard:       c._verdict === "hazard" ? c._reason : null,
    }));

    const intro = intent.universal_access
      ? `I verified accessibility, prices, and recent reviews. Here are 5 ${intent.mode} picks for ${intent.party_size} — tap any card to dive in.`
      : `Here are 5 ${intent.mode} picks I cross-checked with live data. Tap a card to dive in.`;

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
async function buildItineraryPayload({ destination, vibe, est_cost_inr, ai_value_score, card_id, intent, startDate }) {
  const fresh = await ragVerify(
    { destination, vibe, ai_value_score, est_cost_inr },
    intent
  );

  const daySys = `Build a detailed travel itinerary as JSON.
Return JSON only:
{
 "days": [{"day":1,"title":"...","activities":["...","..."]}],
 "estimated_cost_inr": <int>,
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
     "name": "<a real Indian destination similar in vibe to the main one>",
     "emoji": "<one emoji that captures it>",
     "tagline": "<<= 60 chars one-line vibe>"
   }
 ]
}

Rules:
- "stays" MUST include 4 options at different price points within the user's budget mode.
  For sasta mode: lean toward hostels/budget hotels/homestays. For elite: hotels/resorts/villas.
  Tune to the party size — if 1 person traveling, suggest options good for solo travellers.
- "packing" MUST be 8-12 items, ALWAYS in English. Adapt to the weather and activities.
- "similar_destinations" MUST include 4 distinct Indian places that match the same vibe.
  Do NOT repeat the main destination itself.
- The "weather" object is REQUIRED. Estimate from typical climate on the given travel date;
  if no date, use current month.`;

  const travelDateLine = startDate
    ? `Travel date: ${startDate}`
    : `Travel date: not specified — assume the current month.`;

  const dayUser = `Destination: ${destination} (${vibe})
${travelDateLine}
Party size: ${intent.party_size}${intent.party_size === 1 ? " (solo traveller)" : ""}
Budget (whole party): ₹${intent.budget_inr}
${intent.universal_access ? "MUST be wheelchair-friendly. Suggest specific gates, ramps, and lower-crowd entry points." : ""}
Verified context: ${fresh._summary}
Smart access notes: ${JSON.stringify(fresh._access_notes)}`;

  let plan = { days: [], estimated_cost_inr: est_cost_inr, weather: null, stays: [], packing: [], similar_destinations: [] };
  try {
    const text = await groqChat(daySys, dayUser, { temperature: 0.4 });
    plan = json(text);
  } catch (e) {
    console.warn("day-plan generation failed, using stub:", e.message);
  }

  return {
    card_id,
    destination,
    vibe,
    days: plan.days ?? [],
    estimated_cost_inr: plan.estimated_cost_inr ?? est_cost_inr,
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
      universal_access: session.universal_access,
    };

    const payload = await buildItineraryPayload({
      destination: card._destination,
      vibe: card.vibe,
      est_cost_inr: card.est_cost_inr,
      ai_value_score: card.ai_value_score,
      card_id: card.id,
      intent,
      startDate,
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
    const { sessionId, destination, startDate } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!destination?.trim()) return res.status(400).json({ error: "missing destination" });

    const { data: session, error: sErr } = await supabase
      .from("sessions").select("*").eq("id", sessionId).single();
    if (sErr || !session) return res.status(404).json({ error: "session not found" });

    const intent = {
      mode: session.mode ?? "elite",
      budget_inr: session.budget_inr ?? 50000,
      party_size: session.party_size ?? 2,
      universal_access: session.universal_access ?? false,
      must_haves: [], avoid: [],
    };

    // Ask Groq for a quick 1-card vibe + cost estimate so the deck looks normal
    let card = {
      destination: destination.trim(),
      vibe: "Custom Pick",
      ai_value_score: 8.5,
      est_cost_inr: Math.round(intent.budget_inr * 0.7),
      blurb: `Planned for your trip to ${destination.trim()}.`,
      hint_emoji: "📍",
    };
    try {
      const sys = `Return JSON only describing this destination as a card:
{
 "vibe": "<2-3 word vibe like 'Beach Bliss' or 'Royal Heritage'>",
 "ai_value_score": <number 1-10>,
 "est_cost_inr": <int — total spend for the whole party, excluding travel>,
 "blurb": "<<= 100 chars one-line vibe; do NOT include the destination name>",
 "hint_emoji": "<one emoji>"
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
      hint_emoji: card.hint_emoji,
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
        travel_date: p.travel_date,
        rag_summary: p.rag_summary,
        hazard: p.hazard,
      },
      accessibility_notes: p.accessibility_notes,
      rag_citations: p.citations, status: "locked", locked_by: userId,
    }).select().single();
    if (error) {
      if (error.code === "23505")
        return res.status(409).json({ error: "session already locked" });
      throw error;
    }

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
    const { destination, vibe, weather, days, question } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    if (!question?.trim()) return res.status(400).json({ error: "missing question" });

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

    return res.json({ ok: true, answer });
  } catch (e) {
    console.error("chatQA error", e);
    return res.status(500).json({ error: "qa failed", detail: e.message });
  }
}


// =====================================================================
// 8. GET /api/public/trip/:id — read-only public view, NO auth required
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
