// =====================================================================
// Live-rail teasers for the welcome screen
// =====================================================================
// Two sets:
//   PLACE_TEASERS — used in I-know-where mode. Real hidden-gem cities
//                   with an AI score (purely cosmetic, gives the rail
//                   that "departures board" energy). Clicking populates
//                   the composer with the city name.
//   VIBE_TEASERS  — used in Surprise mode. Mood-led prompts that fill
//                   the composer with a free-text "describe a trip"
//                   request. No place names — that's the whole point
//                   of Surprise mode.
// =====================================================================

export const PLACE_TEASERS = [
  { name: "Ziro",      region: "Arunachal",  score: 9.6, tag: "Hidden valley" },
  { name: "Spiti",     region: "Himachal",   score: 9.4, tag: "High desert" },
  { name: "Majuli",    region: "Assam",      score: 9.1, tag: "River island" },
  { name: "Hampi",     region: "Karnataka",  score: 9.3, tag: "Boulder ruins" },
  { name: "Khirsu",    region: "Uttarakhand", score: 9.0, tag: "Slow forest" },
  { name: "Chettinad", region: "Tamil Nadu", score: 9.2, tag: "Mansion food" },
  { name: "Tawang",    region: "Arunachal",  score: 9.3, tag: "Monastery sky" },
  { name: "Gokarna",   region: "Karnataka",  score: 8.9, tag: "Quieter Goa" },
  { name: "Khajuraho", region: "MP",         score: 9.0, tag: "Sandstone art" },
  { name: "Munsiyari", region: "Uttarakhand", score: 9.1, tag: "Glacier view" },
  { name: "Mawlynnong", region: "Meghalaya", score: 9.2, tag: "Cleanest village" },
  { name: "Pondicherry", region: "Puducherry", score: 8.8, tag: "French quiet" },
];

export const VIBE_TEASERS = [
  { title: "Weekend escape",      tag: "≤ ₹15k · near city",    prompt: "Plan a weekend escape from my city under ₹15k for 2 people." },
  { title: "Mountain solitude",   tag: "Cold · slow · solo",    prompt: "I want mountain solitude — slow pace, cold air, minimal people, solo trip." },
  { title: "Offbeat Northeast",   tag: "5+ days · monastery",   prompt: "Take me through the Northeast — offbeat, 5–7 days, monasteries and rivers." },
  { title: "Secret coast",        tag: "No Goa · calm beach",   prompt: "Find me a quiet coast that isn't Goa — beach, calm, decent food." },
  { title: "Heritage week",       tag: "Forts · old cities",    prompt: "Plan a heritage trip — forts, old cities, slow walks, 6 days." },
  { title: "Food pilgrimage",     tag: "Street + traditional",  prompt: "Plan a food-led trip — local dishes I can't get back home, 5 days." },
  { title: "Solo backpacker",     tag: "Hostels · ₹10k",        prompt: "Solo backpacker mode — hostels, public transport, under ₹10k for 5 days." },
  { title: "Wild + wildlife",     tag: "Forests · sanctuaries", prompt: "Take me into a wildlife sanctuary or national park for 4–5 days." },
];
