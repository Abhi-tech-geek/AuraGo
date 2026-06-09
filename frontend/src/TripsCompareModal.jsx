import { useEffect, useMemo, useState } from "react";
import { BarChart3, Lock, Loader2, X, MapPin } from "lucide-react";
import { supabase } from "./supabaseClient";

// =====================================================================
// TripsCompareModal — Terminal-styled list of every locked trip
// =====================================================================
// Bars are scaled to the most expensive trip in the list so the user
// can eyeball relative cost. Picks up the modal frame from .aura-modal
// + uses the new .totals / .display / mono tokens for the summary +
// .progress class for the fill bar (already theme-aware in index.css).
// =====================================================================

const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n || 0);

export default function TripsCompareModal({ open, onClose, userId }) {
  const [trips, setTrips]     = useState([]);
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
      <div className="aura-modal" style={{ padding: 0 }}>
        {/* Head */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: 12, padding: "22px 24px 14px",
          borderBottom: "1px solid var(--line)",
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              <BarChart3 size={11} style={{ display: "inline-block", marginRight: 6 }} />
              LOCKED TRIPS
            </div>
            <h2 className="display" style={{ fontSize: 30, lineHeight: 1 }}>Trip ledger</h2>
            <p className="trip-sub" style={{ marginTop: 8, color: "var(--ink-soft)", fontSize: 13.5 }}>
              Cost-scaled bars across every trip you've locked. Largest one sets the 100% mark.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ width: 36, height: 36 }} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 24px 24px", maxHeight: "calc(90vh - 110px)", overflowY: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "44px 0", color: "var(--ink-soft)", fontSize: 13.5 }}>
              <Loader2 size={14} className="animate-spin accent" /> Loading trips…
            </div>
          ) : error ? (
            <p style={{
              padding: 11, borderRadius: "var(--r-sm)", fontSize: 13,
              color: "#fb7185",
              border: "1px solid rgba(251,113,133,0.30)",
              background: "rgba(251,113,133,0.08)",
            }}>
              {error}
            </p>
          ) : trips.length === 0 ? (
            <div className="card hud" style={{ textAlign: "center", padding: 28 }}>
              <Lock size={22} className="accent" style={{ display: "inline-block", marginBottom: 10 }} />
              <p style={{ fontSize: 14, fontWeight: 600 }}>No locked trips yet</p>
              <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--ink-soft)" }}>
                Lock a destination from the itinerary view, and it will appear here.
              </p>
            </div>
          ) : (
            <>
              <Summary trips={trips} />
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {trips.map((t) => {
                  const cost = t.estimated_cost_inr ?? 0;
                  const pct = Math.max(4, Math.round((cost / max) * 100));
                  return (
                    <div key={t.id} className="card" style={{ padding: 13 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                        <div style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 8 }}>
                          <MapPin size={13} className="accent" />
                          <span style={{
                            overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                            fontSize: 14, fontWeight: 600,
                          }}>{t.destination}</span>
                          {t.vibe && <span className="pill-accent" style={{ fontSize: 9 }}>{t.vibe}</span>}
                        </div>
                        <span className="display" style={{ fontSize: 16, color: "var(--accent)" }}>
                          ₹{fmtINR(cost)}
                        </span>
                      </div>
                      <div className="progress">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        marginTop: 7, fontSize: 10, color: "var(--ink-dim)",
                        fontFamily: "var(--mono)", letterSpacing: "0.04em",
                      }}>
                        <span>{(t.status === "locked" ? "LOCKED" : t.status || "").toUpperCase()}</span>
                        {t.locked_at && (
                          <span>{new Date(t.locked_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}</span>
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
    </div>
  );
}

function Summary({ trips }) {
  const total = trips.reduce((s, t) => s + (t.estimated_cost_inr ?? 0), 0);
  const avg = total / Math.max(1, trips.length);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, marginBottom: 18 }}>
      <Stat label="TRIPS" value={trips.length} />
      <Stat label="COMBINED" value={`₹${fmtINR(total)}`} />
      <Stat label="AVERAGE" value={`₹${fmtINR(avg)}`} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: 12 }}>
      <div className="eyebrow" style={{ fontSize: 9.5 }}>{label}</div>
      <div className="display" style={{ marginTop: 4, fontSize: 18, lineHeight: 1, color: "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

export { BarChart3 };
