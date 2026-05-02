import { useEffect, useMemo, useState } from "react";
import { Accessibility, CalendarDays } from "lucide-react";
import { budgetHintLabel, fmtINR } from "./lib/tripPlanning";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function BudgetModal({ open, initial, onClose, onSubmit }) {
  const [mode, setMode]                 = useState(initial?.mode ?? "elite");
  const [origin, setOrigin]             = useState(initial?.origin ?? "Delhi");
  const [partySize, setPartySize]       = useState(initial?.party_size ?? 4);
  const [days, setDays]                 = useState(initial?.days ?? 4);
  const [startDate, setStartDate]       = useState(initial?.start_date ?? "");
  const [budget, setBudget]             = useState(initial?.budget_inr ?? 150000);
  const [universalAccess, setAccess]    = useState(initial?.universal_access ?? false);

  // Reset to incoming initial when re-opened
  useEffect(() => {
    if (!open || !initial) return;
    setMode(initial.mode ?? "elite");
    setOrigin(initial.origin ?? "Delhi");
    setPartySize(initial.party_size ?? 4);
    setDays(initial.days ?? 4);
    setStartDate(initial.start_date ?? "");
    setBudget(initial.budget_inr ?? 150000);
    setAccess(initial.universal_access ?? false);
  }, [open, initial]);

  // Sensible default budget when toggling mode
  const handleModeChange = (m) => {
    setMode(m);
    if (m === "sasta" && budget > 80000) setBudget(40000);
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
      <div className="aura-modal glass-strong rounded-3xl p-6 sm:p-8">
        <div className="mb-5">
          <h2 className="serif text-3xl">Tell me your trip</h2>
          <p className="mt-1 text-sm text-slate-400">
            Main aapke jawab se 5 verified options bana ke dikhaunga.
          </p>
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

        {/* origin */}
        <div className="mb-5">
          <label className="mb-2 block text-[11px] uppercase tracking-wider text-slate-400">
            Starting from
          </label>
          <input
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="e.g. Delhi"
            className="accent-ring w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none"
          />
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
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <CalendarDays size={16} className="text-slate-400" />
            <input
              type="date"
              min={todayISO()}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex-1 bg-transparent text-sm text-slate-100 focus:outline-none [color-scheme:dark]"
            />
            {startDate && (
              <button
                type="button"
                onClick={() => setStartDate("")}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >Clear</button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Date dene par AuraGo us samay ke mausam (thand / garmi / barish) ke liye plan tune karega.
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
            min={20000} max={500000} step={5000}
            value={budget}
            onChange={(e) => setBudget(+e.target.value)}
            className="w-full"
          />
          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>₹20k</span><span>₹1L</span><span>₹2.5L</span><span>₹5L</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            ≈ ₹{fmtINR(hint.perPerson)} per person · ₹{fmtINR(hint.perPersonPerDay)}/person/day · {hint.label}
          </p>
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
              origin,
              party_size: partySize,
              days,
              start_date: startDate,
              budget_inr: budget,
              universal_access: universalAccess,
            })}
            className="accent-bg accent-glow flex-1 rounded-xl py-3 text-sm font-semibold text-slate-900"
          >
            Find my 5 options →
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
