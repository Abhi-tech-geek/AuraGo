import { useEffect, useMemo, useState } from "react";
import { Accessibility, CalendarDays, Globe, Route as RouteIcon } from "lucide-react";
import { budgetHintLabel, fmtINR } from "./lib/tripPlanning";

// Convert textarea / array → cleaned ordered list of stop strings.
function normalizeStops(input) {
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean);
  return String(input ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Countries we have decent destination coverage for. "Other" falls back to a
// generic global plan (no domestic bias).
const COUNTRY_OPTIONS = [
  "India", "Australia", "United States", "United Kingdom",
  "UAE", "Singapore", "Canada", "Germany", "Japan",
  "Thailand", "Indonesia", "Other",
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoPlusDays = (d) =>
  new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// Find the next Friday from today (a "weekend" trip).
function nextWeekendISO() {
  const today = new Date();
  const dow = today.getDay(); // 0 = Sun, 5 = Fri
  const daysUntilFri = (5 - dow + 7) % 7 || 7;
  return isoPlusDays(daysUntilFri);
}

const formatPretty = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

export default function BudgetModal({ open, initial, destinationHint, onClose, onSubmit }) {
  const [mode, setMode]                 = useState(initial?.mode ?? "elite");
  const [country, setCountry]           = useState(initial?.country ?? "India");
  const [origin, setOrigin]             = useState(initial?.origin ?? "Delhi");
  const [hasPassport, setHasPassport]   = useState(initial?.has_passport ?? false);
  const [partySize, setPartySize]       = useState(initial?.party_size ?? 4);
  const [days, setDays]                 = useState(initial?.days ?? 4);
  const [startDate, setStartDate]       = useState(initial?.start_date ?? "");
  const [budget, setBudget]             = useState(initial?.budget_inr ?? 150000);
  const [universalAccess, setAccess]    = useState(initial?.universal_access ?? false);
  // Multi-stop route: when 2+ stops are listed we skip the mystery deck and
  // build a chained itinerary instead.
  const initialStops = normalizeStops(initial?.route_stops ?? []);
  const [multiStop, setMultiStop]       = useState(initialStops.length >= 2);
  const [stopsText, setStopsText]       = useState(initialStops.join("\n"));

  // Reset to incoming initial when re-opened
  useEffect(() => {
    if (!open || !initial) return;
    setMode(initial.mode ?? "elite");
    setCountry(initial.country ?? "India");
    setOrigin(initial.origin ?? "Delhi");
    setHasPassport(initial.has_passport ?? false);
    setPartySize(initial.party_size ?? 4);
    setDays(initial.days ?? 4);
    setStartDate(initial.start_date ?? "");
    setBudget(initial.budget_inr ?? 150000);
    setAccess(initial.universal_access ?? false);
    const stops = normalizeStops(initial.route_stops ?? []);
    setMultiStop(stops.length >= 2);
    setStopsText(stops.join("\n"));
  }, [open, initial]);

  // Sensible default budget when toggling mode
  const handleModeChange = (m) => {
    setMode(m);
    if (m === "sasta" && budget > 80000) setBudget(Math.max(5000, Math.min(40000, budget)));
    if (m === "elite" && budget < 80000) setBudget(150000);
  };

  const hint = useMemo(
    () => budgetHintLabel({ mode, budget, partySize, days }),
    [mode, budget, partySize, days]
  );

  if (!open) return null;

  return (
    <div
      className="aura-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="aura-modal glass-strong rounded-3xl p-5 sm:p-8">
        <div className="mb-5">
          {destinationHint ? (
            <>
              <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] uppercase tracking-wider text-slate-300">
                <span className="text-sm">📍</span> Destination
              </div>
              <h2 className="serif text-3xl">Trip to {destinationHint}</h2>
              <p className="mt-1 text-sm text-slate-400">
                Confirm a few details so AuraGo plans the right kind of trip.
              </p>
            </>
          ) : (
            <>
              <h2 className="serif text-3xl">Tell me your trip</h2>
              <p className="mt-1 text-sm text-slate-400">
                I'll generate 5 verified options based on what you pick here.
              </p>
            </>
          )}
        </div>

        {/* mode */}
        <div className="mb-5">
          <label className="mb-2 block text-[11px] uppercase tracking-wider text-slate-400">
            Style
          </label>
          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              active={mode === "sasta"}
              onClick={() => handleModeChange("sasta")}
              title="Sasta" emoji="💸"
              caption="Hostels, trains, street food magic"
            />
            <ModeCard
              active={mode === "elite"}
              onClick={() => handleModeChange("elite")}
              title="Elite" emoji="👑"
              caption="5-star, flights, fine dining"
            />
          </div>
        </div>

        {/* country + origin */}
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-2 block text-[11px] uppercase tracking-wider text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Globe size={11} /> Home country
              </span>
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="accent-ring w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none [color-scheme:dark]"
            >
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[11px] uppercase tracking-wider text-slate-400">
              Starting city
            </label>
            <input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="e.g. Delhi"
              className="accent-ring w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none"
            />
          </div>
        </div>

        {/* passport toggle — unlocks international suggestions */}
        <div className="mb-5 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-base">🛂</span> Got a passport?
            </div>
            <p className="text-xs text-slate-400">
              {hasPassport
                ? "I'll mix in international hidden gems."
                : `I'll stick to ${country} only.`}
            </p>
          </div>
          <button
            type="button"
            aria-pressed={hasPassport}
            className={`aura-toggle ${hasPassport ? "on" : ""}`}
            onClick={() => setHasPassport(!hasPassport)}
          />
        </div>

        {/* multi-stop route — chained itinerary across 2+ cities */}
        <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <RouteIcon size={14} className="accent-text" />
                Multi-stop trip
              </div>
              <p className="text-xs text-slate-400">
                {multiStop
                  ? "List the cities you want to chain (one per line)."
                  : "Want to visit multiple cities back-to-back?"}
              </p>
            </div>
            <button
              type="button"
              aria-pressed={multiStop}
              className={`aura-toggle ${multiStop ? "on" : ""}`}
              onClick={() => setMultiStop(!multiStop)}
            />
          </div>
          {multiStop && (
            <textarea
              value={stopsText}
              onChange={(e) => setStopsText(e.target.value)}
              placeholder={"e.g.\nUdaipur\nJodhpur\nJaisalmer"}
              rows={3}
              className="accent-ring mt-3 w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none"
            />
          )}
        </div>

        {/* party + days */}
        <div className="mb-5 grid grid-cols-2 gap-3">
          <Counter label="How many people" value={partySize}
                   onChange={(v) => setPartySize(Math.max(1, Math.min(20, v)))} />
          <Counter label="Days" value={days}
                   onChange={(v) => setDays(Math.max(1, Math.min(30, v)))} />
        </div>

        {/* travel date */}
        <div className="mb-5">
          <label className="mb-2 block text-[11px] uppercase tracking-wider text-slate-400">
            When are you going?
          </label>

          {/* Quick-picks for fast date entry */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[
              { label: "Today",      iso: todayISO() },
              { label: "Tomorrow",   iso: isoPlusDays(1) },
              { label: "This weekend", iso: nextWeekendISO() },
              { label: "In 2 weeks", iso: isoPlusDays(14) },
              { label: "Next month", iso: isoPlusDays(30) },
            ].map((q) => {
              const active = startDate === q.iso;
              return (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setStartDate(active ? "" : q.iso)}
                  className="rounded-full border px-2.5 py-1 text-[11px] transition"
                  style={{
                    borderColor: active ? "var(--accent)" : "rgba(255,255,255,0.10)",
                    background: active ? "var(--accent-soft)" : "rgba(255,255,255,0.03)",
                    color: active ? "var(--accent)" : "rgb(203 213 225)",
                  }}
                >
                  {q.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition focus-within:border-white/30">
            <CalendarDays size={16} className="text-slate-400" />
            <input
              type="date"
              min={todayISO()}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex-1 bg-transparent text-sm text-slate-100 focus:outline-none [color-scheme:dark]"
            />
            {startDate ? (
              <>
                <span className="hidden text-[11px] text-slate-400 sm:inline">{formatPretty(startDate)}</span>
                <button
                  type="button"
                  onClick={() => setStartDate("")}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >Clear</button>
              </>
            ) : (
              <span className="text-[11px] text-slate-500">optional</span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            With a date, AuraGo tunes the plan to expected weather (thand / garmi / barish).
          </p>
        </div>

        {/* budget slider */}
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[11px] uppercase tracking-wider text-slate-400">
              Total budget
            </label>
            <span className="text-lg font-semibold">₹{fmtINR(budget)}</span>
          </div>
          <input
            type="range"
            min={5000} max={500000} step={1000}
            value={budget}
            onChange={(e) => setBudget(+e.target.value)}
            className="w-full"
          />
          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>₹5k</span><span>₹50k</span><span>₹2L</span><span>₹5L</span>
          </div>

          {/* Hint copy — phrasing depends on whether it's a solo trip */}
          <p className="mt-2 text-xs text-slate-400">
            {hint.isSolo
              ? <>≈ ₹{fmtINR(hint.perPersonPerDay)}/day · {hint.label}</>
              : <>≈ ₹{fmtINR(hint.perPerson)} per person · ₹{fmtINR(hint.perPersonPerDay)}/person/day · {hint.label}</>}
          </p>

          {/* Severity warning chip */}
          {hint.severity === "very_tight" && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-2.5 text-[12px] text-amber-100">
              <span className="text-base leading-none">⚠️</span>
              <div>
                <div className="font-medium">Heads up — this budget is really tight.</div>
                <div className="text-amber-200/80">
                  {partySize > 1
                    ? `For ${partySize} people across ${days} ${days === 1 ? "day" : "days"}, comfortable plans usually need at least ₹${fmtINR(partySize * days * (mode === "elite" ? 3500 : 1500))}. AuraGo will still try, but expect basic stays + local transport.`
                    : `AuraGo will lean toward hostels, day-trips and budget eateries. For more options, bump it up a notch.`}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* universal access */}
        <div className="mb-6 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Accessibility size={14} className="accent-text" />
              Universal Access
            </div>
            <p className="text-xs text-slate-400">Wheelchair-friendly venues, ramps, lifts</p>
          </div>
          <button
            type="button"
            aria-pressed={universalAccess}
            className={`aura-toggle ${universalAccess ? "on" : ""}`}
            onClick={() => setAccess(!universalAccess)}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/10 py-3 text-sm hover:bg-white/[0.05]"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit({
              mode,
              country,
              has_passport: hasPassport,
              origin,
              party_size: partySize,
              days,
              start_date: startDate,
              budget_inr: budget,
              universal_access: universalAccess,
              route_stops: multiStop ? normalizeStops(stopsText) : [],
            })}
            className="accent-bg accent-glow flex-1 rounded-xl py-3 text-sm font-semibold text-slate-900"
          >
            {destinationHint
              ? `Plan ${destinationHint} →`
              : (multiStop && normalizeStops(stopsText).length >= 2
                  ? `Plan my ${normalizeStops(stopsText).length}-stop route →`
                  : "Find my 5 options →")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, title, caption, emoji }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border p-3 text-left transition"
      style={{
        borderColor: active ? "var(--accent)" : "rgba(255,255,255,0.10)",
        background: active ? "var(--accent-soft)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{title}</span>
        <span className="text-lg">{emoji}</span>
      </div>
      <div className="mt-1 text-xs text-slate-400">{caption}</div>
    </button>
  );
}

function Counter({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-2 block text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(value - 1)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 hover:bg-white/[0.06]"
        >−</button>
        <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] py-2 text-center font-semibold">
          {value}
        </div>
        <button
          onClick={() => onChange(value + 1)}
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 hover:bg-white/[0.06]"
        >+</button>
      </div>
    </div>
  );
}
