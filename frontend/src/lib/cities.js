// =====================================================================
// Cities by country — used by BudgetModal's starting-city autocomplete.
// =====================================================================
// Curated list of common origin cities per country (top ~25-30 each).
// Kept inline so autocomplete is instant and works offline; no API key.
// Order roughly by population / travel-hub relevance.
// =====================================================================

export const CITIES_BY_COUNTRY = {
  India: [
    "Delhi", "Mumbai", "Bangalore", "Bengaluru", "Hyderabad", "Chennai",
    "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh",
    "Surat", "Indore", "Bhopal", "Patna", "Nagpur", "Visakhapatnam",
    "Kochi", "Coimbatore", "Thiruvananthapuram", "Goa", "Guwahati",
    "Bhubaneswar", "Dehradun", "Amritsar", "Vadodara", "Ranchi",
    "Raipur", "Mysuru",
  ],
  Australia: [
    "Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast",
    "Canberra", "Hobart", "Darwin", "Cairns", "Newcastle", "Wollongong",
    "Geelong", "Sunshine Coast", "Townsville",
  ],
  "United States": [
    "New York", "Los Angeles", "Chicago", "San Francisco", "Seattle",
    "Boston", "Washington DC", "Miami", "Houston", "Atlanta", "Dallas",
    "Denver", "Las Vegas", "Phoenix", "Philadelphia", "San Diego",
    "Austin", "Portland", "Minneapolis", "Detroit", "Nashville",
    "Charlotte", "Orlando", "Pittsburgh", "St. Louis",
  ],
  "United Kingdom": [
    "London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Liverpool",
    "Bristol", "Leeds", "Newcastle", "Sheffield", "Cardiff", "Belfast",
    "Brighton", "Cambridge", "Oxford", "York", "Nottingham", "Aberdeen",
    "Southampton", "Leicester",
  ],
  UAE: [
    "Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain", "Fujairah",
    "Ras Al Khaimah", "Umm Al Quwain",
  ],
  Singapore: ["Singapore"],
  Canada: [
    "Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton",
    "Quebec City", "Winnipeg", "Halifax", "Victoria", "Hamilton", "Kitchener",
    "Saskatoon", "Regina", "St. John's",
  ],
  Germany: [
    "Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart",
    "Düsseldorf", "Dresden", "Leipzig", "Hanover", "Nuremberg", "Bremen",
    "Heidelberg", "Freiburg", "Bonn",
  ],
  Japan: [
    "Tokyo", "Osaka", "Kyoto", "Yokohama", "Nagoya", "Sapporo", "Fukuoka",
    "Hiroshima", "Sendai", "Kobe", "Nara", "Kanazawa", "Nikko", "Hakone",
    "Okinawa",
  ],
  Thailand: [
    "Bangkok", "Chiang Mai", "Phuket", "Pattaya", "Krabi", "Koh Samui",
    "Ayutthaya", "Hua Hin", "Chiang Rai", "Sukhothai", "Kanchanaburi",
    "Koh Phangan", "Koh Tao", "Pai",
  ],
  Indonesia: [
    "Jakarta", "Bali", "Yogyakarta", "Bandung", "Surabaya", "Medan",
    "Semarang", "Makassar", "Lombok", "Ubud", "Seminyak", "Canggu",
    "Komodo", "Flores", "Bintan",
  ],
  Other: [],
};

// Lookup helper — case-insensitive country key match, returns empty array
// if the country isn't in our static map (UI just shows no suggestions).
export function citiesFor(country) {
  if (!country) return [];
  const key = Object.keys(CITIES_BY_COUNTRY).find(
    (k) => k.toLowerCase() === String(country).toLowerCase(),
  );
  return key ? CITIES_BY_COUNTRY[key] : [];
}
