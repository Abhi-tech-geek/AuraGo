import { useEffect, useMemo, useState } from "react";
import { BarChart3, Lock, Loader2, X, MapPin } from "lucide-react";
import { supabase } from "./supabaseClient";

const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n || 0);

export default function TripsCompareModal({ open, onClose, userId }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("trips")
          .select("id, destination, vibe, estimated_cost_inr, status, locked_at")
          .eq("locked_by", userId)
          .order("locked_at", { ascending: false })
          .limit(20);
        if (error) throw error;
        if (!cancelled) setTrips(data ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message ?? "Could not load locked trips.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  const max = useMemo(
    () => Math.max(1, ...trips.map((t) => t.estimated_cost_inr ?? 0)),
    [trips]
  );

  if (!open) return null;
  return (
    <div className="aura-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="aura-modal glass-strong rounded-3xl p-6 sm:p-8">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="serif text-3xl">Locked trips</h2>
            <p className="mt-1 text-sm text-slate-400">
              Compare your finalized trips by cost. Bars are scaled to the most expensive.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-slate-300 hover:bg-white/[0.08]"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Loading trips…
          </div>
        ) : error ? (
          <p className="rounded-lg border border-red-400/30 bg-red-400/[0.06] p-3 text-sm text-red-200">
            {error}
          </p>
        ) : trips.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
            <Lock size={20} className="accent-text mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-200">No locked trips yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Lock a destination from the itinerary view, and it will appear here.
            </p>
          </div>
        ) : (
          <>
            <Summary trips={trips} />
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {trips.map((t) => {
                const cost = t.estimated_cost_inr ?? 0;
                const pct = Math.max(4, Math.round((cost / max) * 100));
                return (
                  <div key={t.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <MapPin size={12} className="accent-text shrink-0" />
                        <span className="truncate text-[14px] font-medium text-slate-100">{t.destination}</span>
                        {t.vibe && (
                          <span className="accent-soft-bg accent-text rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                            {t.vibe}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-[13px] font-semibold text-slate-100">
                        ₹{fmtINR(cost)}
                      </span>
                    </div>
                    <div className="progress">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{t.status === "locked" ? "Locked" : t.status}</span>
                      {t.locked_at && (
                        <span>{new Date(t.locked_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Summary({ trips }) {
  const total = trips.reduce((s, t) => s + (t.estimated_cost_inr ?? 0), 0);
  const avg = total / Math.max(1, trips.length);
  return (
    <div className="mb-4 grid grid-cols-3 gap-2">
      <Stat label="Total trips" value={trips.length} />
      <Stat label="Combined cost" value={`₹${fmtINR(total)}`} />
      <Stat label="Average" value={`₹${fmtINR(avg)}`} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="serif mt-1 text-lg leading-none">{value}</div>
    </div>
  );
}

export { BarChart3 };
