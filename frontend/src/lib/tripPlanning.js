// Client-side trip planning helpers — same logic as the demo.
// Routes, budget breakdown, and distances are computed locally so the
// existing backend (which only returns destination + cost) can stay simple.

// Static fallback distances from Delhi for popular Indian destinations.
// We use this only when the backend itinerary payload didn't carry an
// est_distance_km (older flows, multi-stop routes, etc.). The match is
// case-insensitive and uses substring inclusion so "Vrindavan, India"
// still resolves to the "Vrindavan" entry.
export const KNOWN_DESTINATIONS = {
  // Around Delhi NCR / pilgrim circuit
  "Vrindavan":  { km: 150,  roadVia: "NH19 (Mathura)" },
  "Mathura":    { km: 145,  roadVia: "NH19" },
  "Agra":       { km: 230,  roadVia: "Yamuna Expressway" },
  "Jaipur":     { km: 280,  roadVia: "NH48" },
  "Rishikesh":  { km: 240,  roadVia: "NH334" },
  "Haridwar":   { km: 215,  roadVia: "NH334" },
  "Pushkar":    { km: 410,  roadVia: "NH48 (Ajmer)" },
  "Nainital":   { km: 305,  roadVia: "NH109" },
  "Mussoorie":  { km: 290,  roadVia: "via Dehradun" },
  "Shimla":     { km: 350,  roadVia: "NH5 (Chandigarh)" },
  "Manali":     { km: 540,  roadVia: "NH3 (Chandigarh, Kullu)" },
  "Amritsar":   { km: 450,  roadVia: "NH44 (Ambala)" },
  "Dharamshala":{ km: 475,  roadVia: "NH154" },
  "Khajuraho":  { km: 620,  roadVia: "via Jhansi" },
  "Varanasi":   { km: 820,  roadVia: "NH19 / NH35" },
  "Udaipur":    { km: 670,  roadVia: "NH48 (Jaipur)" },
  "Jaisalmer":  { km: 800,  roadVia: "via Jodhpur" },
  "Spiti":      { km: 720,  roadVia: "Manali-Spiti highway" },
  "Ziro":       { km: 2400, roadVia: "too far for road" },
  "Tawang":     { km: 2300, roadVia: "too far for road" },
  // Long-haul destinations from Delhi
  "Puducherry": { km: 2200, roadVia: "too far for road" },
  "Coorg":      { km: 2200, roadVia: "too far for road" },
  "Goa":        { km: 1900, roadVia: "too far for road" },
  "Hampi":      { km: 1900, roadVia: "too far for road" },
  "Gokarna":    { km: 2000, roadVia: "too far for road" },
  "Ladakh":     { km: 1010, roadVia: "Manali-Leh highway" },
  "Kerala":     { km: 2700, roadVia: "too far for road" },
  "Munnar":     { km: 2600, roadVia: "too far for road" },
  "Darjeeling": { km: 1500, roadVia: "too far for road" },
  "Shillong":   { km: 1900, roadVia: "too far for road" },
  "Sikkim":     { km: 1700, roadVia: "too far for road" },
  "Tirupati":   { km: 2000, roadVia: "too far for road" },
  "Hyderabad":  { km: 1550, roadVia: "too far for road" },
  "Bangalore":  { km: 2100, roadVia: "too far for road" },
  "Chennai":    { km: 2200, roadVia: "too far for road" },
  "Mumbai":     { km: 1400, roadVia: "NH48" },
  "Pune":       { km: 1450, roadVia: "NH48" },
  "Kolkata":    { km: 1500, roadVia: "NH19" },
  "Lucknow":    { km: 555,  roadVia: "NH9" },
  "Bhopal":     { km: 780,  roadVia: "NH44" },
};

function lookupKnown(destination) {
  if (!destination) return null;
  const norm = String(destination).toLowerCase();
  for (const key of Object.keys(KNOWN_DESTINATIONS)) {
    if (norm.includes(key.toLowerCase())) return KNOWN_DESTINATIONS[key];
  }
  return null;
}

// `payloadKm` lets the caller pass the backend's est_distance_km estimate,
// which is the most accurate option when available — the static map is
// only a fallback for older trips and for safe defaults.
export function distanceFromOrigin(_origin, destination, payloadKm = null) {
  if (Number(payloadKm) > 0) return Math.round(Number(payloadKm));
  const known = lookupKnown(destination);
  if (known) return known.km;
  // Conservative fallback when the destination is truly unknown.
  return 800;
}

export function roadViaLabel(destination) {
  return lookupKnown(destination)?.roadVia ?? "scenic route";
}

// =====================================================================
// Budget breakdown — adapts ratios by mode, optionally reactive to route
// =====================================================================
const BREAKDOWN_META = {
  transport:  { label: "Transport",     icon: "🚆" },
  stay:       { label: "Stay",          icon: "🏨" },
  food:       { label: "Food & Drink",  icon: "🍽️" },
  activities: { label: "Activities",    icon: "🎟️" },
  buffer:     { label: "Buffer",        icon: "💼" },
};

// destinationCost = stay + food + activities + buffer (excludes travel)
// transportCost   = optional override (the actually-selected route total)
export function computeBudgetBreakdown(destinationCost, mode, transportCost = null) {
  const elite = mode === "elite";
  // Sub-ratios that sum to 1.0 over the destination-only spend
  const destRatios = elite
    ? { stay: 0.572, food: 0.214, activities: 0.143, buffer: 0.071 }
    : { stay: 0.461, food: 0.308, activities: 0.154, buffer: 0.077 };

  // If no actual route picked yet, derive a sensible default transport value
  const defaultTransport = elite
    ? Math.round(destinationCost * (0.30 / 0.70))
    : Math.round(destinationCost * (0.35 / 0.65));
  const transport = transportCost ?? defaultTransport;
  const grand = destinationCost + transport;

  const rows = [{
    key: "transport",
    label: BREAKDOWN_META.transport.label,
    icon:  BREAKDOWN_META.transport.icon,
    amount: transport,
    pct: grand ? Math.round((transport / grand) * 100) : 0,
  }];
  for (const [k, r] of Object.entries(destRatios)) {
    const amount = Math.round((destinationCost * r) / 100) * 100;
    rows.push({
      key: k,
      label: BREAKDOWN_META[k].label,
      icon:  BREAKDOWN_META[k].icon,
      amount,
      pct: grand ? Math.round((amount / grand) * 100) : 0,
    });
  }
  return rows;
}

// =====================================================================
// Route options — flight / train / road
// =====================================================================
export function computeRoutes({ origin, destination, mode, totalBudget, partySize, payloadKm }) {
  const km = distanceFromOrigin(origin, destination, payloadKm);
  const elite = mode === "elite";

  const flightOk  = km > 400;
  const flightCost = Math.round(((elite ? 14000 : 7500) * (km / 1000)) / 500) * 500;
  const trainCost  = Math.round(((elite ? 4500  : 1800) * (km / 1000)) / 100) * 100;
  const roadCost   = Math.round((km * 18) / partySize / 100) * 100;
  const flightHrs  = Math.round((km / 700) * 10) / 10 + 2;
  const trainHrs   = Math.round((km / 70)  * 10) / 10;
  const roadHrs    = Math.round((km / 60)  * 10) / 10;

  const opts = [];
  if (flightOk) {
    opts.push({
      mode: "flight", icon: "✈️", label: "Flight",
      cost_pp: flightCost, time: `${flightHrs.toFixed(1)} hr`,
      via: `${origin} → ${destination} (direct)`,
      pros: ["Fastest", elite ? "Comfortable for elite trips" : "Saves a day each way"],
      cons: km < 600 ? ["Overkill for short distance"] : [],
      score: elite ? 9.2 : 7.5,
    });
  }
  opts.push({
    mode: "train", icon: "🚆", label: "Train (AC)",
    cost_pp: trainCost, time: `${trainHrs.toFixed(1)} hr`,
    via: `${origin} → ${destination} via Rajdhani / Vande Bharat`,
    pros: ["Sweet spot of cost & comfort", "Sightseeing en route"],
    cons: trainHrs > 18 ? ["Long journey"] : [],
    score: 8.8,
  });
  if (km < 1000) {
    opts.push({
      mode: "road", icon: "🚗", label: "Road trip",
      cost_pp: roadCost, time: `${roadHrs.toFixed(1)} hr`,
      via: `Self-drive / shared cab via ${roadViaLabel(destination)}`,
      pros: ["Stop wherever you want", "Best for groups"],
      cons: roadHrs > 10 ? ["Long drive — split across 2 days"] : [],
      score: partySize >= 4 ? 8.5 : 7.0,
    });
  }

  // mark recommended
  opts.forEach((o) => { o.recommended = false; });
  const sorted = [...opts].sort((a, b) =>
    elite ? b.score - a.score : a.cost_pp - b.cost_pp
  );
  if (sorted[0]) sorted[0].recommended = true;
  return { km, options: opts };
}

// =====================================================================
// Smart per-person/day budget label for the modal hint.
// Returns severity so the UI can colour-code warnings.
// =====================================================================
export function budgetHintLabel({ mode, budget, partySize, days }) {
  const safeParty = Math.max(1, partySize);
  const safeDays  = Math.max(1, days);
  const pp  = Math.round(budget / safeParty);
  const ppd = Math.round(pp / safeDays);
  const isSolo = safeParty === 1;

  // severity: "ok" | "tight" | "very_tight"
  let severity = "ok";
  let label = "";
  if (mode === "elite") {
    if (ppd < 3000) {
      severity = "very_tight";
      label = isSolo
        ? "very tight for an elite solo trip — consider Sasta mode or more budget"
        : "very tight for elite — consider Sasta mode or more budget";
    } else if (ppd < 8000) {
      severity = "tight";
      label = "good for mid-tier elite trips";
    } else {
      label = "comfortable for elite trips";
    }
  } else {
    if (ppd < 800) {
      severity = "very_tight";
      label = isSolo
        ? "really tight even solo — try a closer destination or 1-2 days"
        : `really tight for ${safeParty} people — split rooms, public transport only`;
    } else if (ppd < 1500) {
      severity = "tight";
      label = isSolo
        ? "doable solo with hostels + local food"
        : "tight — hostels and shared transport";
    } else if (ppd < 2500) {
      label = "solid for backpacker style";
    } else {
      label = "comfortable for sasta trips";
    }
  }
  return { perPerson: pp, perPersonPerDay: ppd, label, severity, isSolo };
}

export const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n || 0);

// Build a plain-English prompt the backend already knows how to parse.
export function promptFromPrefs(p) {
  const accessTxt = p.universal_access ? " with wheelchair access" : "";
  const modeTxt = p.mode === "elite" ? "Elite" : "Sasta";
  const country = p.country || "India";
  const scope = p.has_passport
    ? `Surprise me with hidden gems — mix domestic (${country}) and international.`
    : `Stay within ${country} only — I don't have a passport. Lean toward hidden gems, not the obvious tourist spots.`;
  return `Plan a ${modeTxt} trip from ${p.origin}, ${country}, for ${p.party_size} ` +
         `people, ${p.days} days, budget ₹${p.budget_inr}${accessTxt}. ${scope}`;
}
