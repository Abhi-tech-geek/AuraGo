# 08 · Prompt engineering

This file is **what we tell the LLM, and why**. If `06-ai-agents-explained.md` named the roles and `07-orchestration-and-workflows.md` ordered them, this file is the actual prompt design.

## Three rules we follow for every prompt

### Rule 1 — Always request JSON
We call Groq with `response_format: { type: "json_object" }` so the API enforces JSON-only output. Every system prompt ends with the exact JSON shape we expect.

This means our code parses with `JSON.parse(text)` and uses the result like a normal object. **No regex, no markdown stripping, no "extract the part between curly braces" hacks.**

### Rule 2 — Show the shape, don't describe it
We don't say "return an array of destinations with name, description, etc." We literally show the JSON:

```
{
 "candidates": [
   {"destination":"<name>", "vibe":"<2-3 words>",
    "ai_value_score": <number>, "est_cost_inr": <int>,
    "blurb":"<<=120 chars, no destination name>>",
    "hint_category":"<one of: mountain, beach, ...>"}
 ]
}
```

LLMs imitate examples better than they follow descriptions.

### Rule 3 — Lead with constraints, end with shape
Every system prompt has three parts in this order:
1. **Role** ("You are AuraGo, a global travel discovery planner.")
2. **Hard rules** (what to do, what to avoid)
3. **Output shape** (the JSON schema)

The model honours whatever is repeated most. Putting rules above the shape makes them dominant.

## Notable prompts in detail

### A. `generateCandidatePool` (8 destinations)

```
You are AuraGo, a global travel discovery planner.
Propose exactly 8 distinct destinations that match the constraints.

CRITICAL — HIDDEN GEMS BIAS:
Bias HEAVILY toward underrated, lesser-known places with strong
quality. AVOID the top-5 most-touristed clichés for the region
(e.g., for India avoid Goa / Manali / Jaipur / Shimla / Rishikesh
unless they uniquely fit; for Europe avoid Paris / Rome / Barcelona;
for SE Asia avoid Bali / Phuket). Suggest places a well-travelled
friend would recommend over a guidebook.

BUDGET REALISM — VERY IMPORTANT:
Total budget is ₹{budget} for {N} people over {D} days.
This budget covers EVERYTHING: round-trip transport from their
starting city + stays + food + activities + buffer.
"est_cost_inr" you return = stay + food + activities ONLY (NOT transport),
and it MUST be small enough that the user's transport ALSO fits
inside the total budget. For nearby destinations leave ≥ 25% of total
for transport; for far/international leave ≥ 45%.

{scope brief: domestic-only or 5 domestic + 3 international}

For each destination give:
- vibe (2-3 words)
- ai_value_score (1-10; score hidden gems higher)
- est_cost_inr (whole party, exc. flights)
- blurb (<=120 chars, NO destination name)
- hint_category (one of: mountain, beach, desert, forest, lake,
  heritage, city, pilgrim, wildlife, adventure)

Return JSON only:
{"candidates":[{...},{...}]}
```

**What this prompt teaches the model:**
- Strong negative examples ("avoid Goa, Manali, Paris…") work better than positive ones.
- The budget rule explicitly tells the model **what's in scope** ("estimated_cost_inr is stay + food + activities, NOT transport") — this fixed a major v1 bug where users saw "₹18k plan" but the breakdown said ₹31k because transport was added on top.
- The category enum (`mountain`, `beach`, etc.) makes the output trivially mappable to lucide icons in the frontend.

Temperature 0.75 — we want variety so each refresh feels different.

### B. `parseIntent` (free text → structured)

```
You extract trip planning constraints from a user message.
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
- "Sasta"/cheap/budget/college → mode="sasta".
- "Elite"/luxury/premium/honeymoon → mode="elite".
- "wheelchair"/"accessible" → universal_access=true.
- Convert "1.5 Lakhs" → 150000, "2L" → 200000, "50k" → 50000.
```

Temperature 0.1 — deterministic extraction. We **fall back to session defaults** if any field is missing, so the LLM is free to skip what it can't infer.

### C. `buildItineraryPayload` (the day plan)

```
Build a detailed travel itinerary as JSON.

{multi-stop rules if route_stops≥2: "must progress through cities IN ORDER, ..."}

DAY COUNT — STRICT:
The user explicitly chose {N} day(s).
The "days" array MUST contain EXACTLY {N} entries — no more, no less,
regardless of what feels natural. Day numbers must run from 1 to N inclusive.

BUDGET INTERPRETATION:
The user's total budget of ₹{B} is for the WHOLE trip including
transport from their origin. "estimated_cost_inr" is stay + food +
activities ONLY (NOT transport). Pick stays and activities priced so
that estimated_cost_inr + a realistic round-trip transport from origin
still fits inside the total budget.

DISTANCE — REQUIRED:
Also return "est_distance_km": one-way road distance from "{origin}"
to "{destination}". Use real-world geography, not guesses (Vrindavan
from Delhi is ~150 km; Goa from Bangalore is ~560 km; etc.).

Return JSON only:
{
 "days": [{"day":1,"title":"...","activities":["...","..."]}],
 "estimated_cost_inr": <int>,
 "est_distance_km": <int>,
 "weather": {summary, temp_c, feel, advice},
 "stays": [...],
 "packing": [...],
 "similar_destinations": [...]
}

Rules:
- "stays": for SINGLE: 4 options at different price points.
  For MULTI-STOP: one stay per stop.
- "packing": 8-12 items, always English.
- "similar_destinations": 4 places matching the vibe.
  Respect passport scope (if no passport, all domestic).
- "weather" required; estimate from typical climate.
```

**Why the explicit examples in "DISTANCE — REQUIRED"?** Because earlier versions hallucinated. Showing 2–3 concrete grounded examples ("Vrindavan from Delhi ~150 km") drops the error rate dramatically.

Temperature 0.4 — balanced creativity and grounding.

### D. `ragVerify` (destination safety check)

```
You are AuraGo's QA Agent.
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
- Otherwise "pass".
```

User prompt fed in:
```
DESTINATION: {dest}
CONSTRAINTS: {intent JSON}

LIVE WEB SNIPPETS:
(1) {title} — {snippet} [{url}]
(2) {title} — {snippet} [{url}]
...
```

This is the closest thing AuraGo has to a true RAG step. Serper provides the snippets; Groq decides.

Temperature 0 — no creativity, just judgement.

### E. `refineItinerary` (in-place edit)

```
You are AuraGo's refinement editor. Rewrite the itinerary to honour
the instruction WITHOUT changing the destination, vibe, or travel_date.
Keep the same JSON shape.

Rules:
- Lower budget → lower stay + activity costs + estimated_cost_inr.
- "indoor day N" → swap outdoor activities for indoor at same destination.
- Keep day count unchanged unless the instruction says otherwise.
- packing 8-12 items in English.
- Return JSON only.
```

The user prompt includes the *existing* itinerary plus the instruction. We **merge** the response into the old payload back-end side (preserving photos, citations, route_stops, etc.) so the LLM doesn't have to regenerate immutable parts.

Temperature 0.4.

### F. `chatQA` (concierge)

```
You are AuraGo, a friendly Indian travel concierge.
Answer the user's follow-up question about their trip. Be concise (3-6 sentences).
Use the trip context provided. If you genuinely don't know, say so plainly.
Return JSON only:
{ "answer": "<your answer>" }
```

User prompt:
```
Trip context:
Destination: {dest}
Vibe: {vibe}
Weather: {summary} ({feel})
Itinerary length: {N} days

User question: {question}
```

Temperature 0.5 — slightly creative for friendly tone, low enough to stay grounded.

## What we explicitly DO NOT do in prompts

- **No few-shot examples for the full itinerary.** A 4 KB schema is enough; adding a sample itinerary would balloon the prompt and bias outputs.
- **No chain-of-thought "think step by step" preamble.** Llama 3.3 is strong enough that explicit CoT slows responses without quality gains.
- **No persona scripting beyond the role line.** ("You are a friendly Indian concierge" is plenty.)
- **No safety disclaimers in the prompt.** Groq enforces safety on its side.
- **No format negotiation.** We tell it exactly which JSON; no "feel free to add fields".

## How we handle prompt failures

Three safety nets:

1. **`JSON.parse` in try/catch.** If the LLM returns malformed JSON despite the `response_format` constraint, the controller falls back to a default object.
2. **Field-level defaults** in `parseIntent`. Missing fields use the session row's saved values.
3. **Post-processing** for hard invariants. The day plan is **trimmed/padded** to exactly N entries after the LLM responds. The hint_category is coerced to a known enum.

## Tuning advice

If you ever need to bias outputs without changing prompts:

- **Variety up** → raise temperature, change `seed`, or add an explicit "avoid repeating: {recent picks}" line.
- **Safety up** → lower temperature, repeat critical rules at the bottom of the prompt.
- **Latency down** → shorten the system prompt; the input tokens dominate cost and latency.
- **Quality up** → upgrade the model. Llama 3.3 70B → 405B, or swap to Claude 3.5 Sonnet for the day plan only.

---

**Next file:** `09-rag-and-retrieval.md` — Serper as live retrieval, and the honest story about pgvector.
