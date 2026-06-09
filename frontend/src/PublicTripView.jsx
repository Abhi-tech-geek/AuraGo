import { useEffect, useMemo, useState } from "react";
import {
  Loader2, Sparkles, ShieldCheck, AlertTriangle,
  CloudSun, Snowflake, Sun, CloudRain, Cloud, Thermometer,
  Accessibility, Image as ImageIcon, X, ExternalLink,
  Briefcase, Calendar, Bed, MapPin as Pin, Tag,
} from "lucide-react";

// =====================================================================
// PublicTripView — read-only share page for a locked trip.
// =====================================================================
// Renders the SAME Terminal sections as ItineraryView (boarding pass,
// HUD route map, vertical day timeline, stays grid, packing, totals)
// but stripped of every interactive control — no Lock, Invite, Poll,
// Chat, Refine, Shuffle. Anyone with the link sees the plan exactly
// as it was locked in.
// =====================================================================

const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n || 0);

const weatherIconFor = (feel) => {
  const f = (feel ?? "").toLowerCase();
  if (f.includes("snow") || f.includes("cold")) return Snowflake;
  if (f.includes("rain")) return CloudRain;
  if (f.includes("hot") || f.includes("warm")) return Sun;
  if (f.includes("humid") || f.includes("cloud")) return Cloud;
  if (f.includes("cool")) return CloudSun;
  return Thermometer;
};

export default function PublicTripView({ tripId }) {
  const [trip, setTrip]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/public/trip/${encodeURIComponent(tripId)}`);
        if (!r.ok) {
          const body = await r.text();
          throw new Error(body || `HTTP ${r.status}`);
        }
        const data = await r.json();
        if (!cancelled) setTrip(data.trip);
      } catch (e) {
        if (!cancelled) setError(e.message ?? "Could not load trip.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  if (loading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center">
        <div className="aurora" />
        <div className="grain" />
        <div className="spinner relative z-10" />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4" style={{ color: "var(--ink)" }}>
        <div className="aurora" />
        <div className="grain" />
        <div className="glass-strong relative z-10 max-w-md rounded-2xl p-6 text-center" style={{ borderRadius: "var(--r-lg)" }}>
          <p className="display" style={{ fontSize: 30, marginBottom: 8 }}>TRIP NOT FOUND</p>
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            {error ?? "The shared link may be invalid or the trip has been removed."}
          </p>
          <a href="/" className="btn btn-primary btn-cta" style={{ marginTop: 18 }}>
            Plan your own trip →
          </a>
        </div>
      </div>
    );
  }

  return <PublicTrip trip={trip} />;
}

// ---------------------------------------------------------------------
// Inline HudMap helper (smaller copy of the one in ChatInterface so the
// public bundle doesn't need to import it across files).
// ---------------------------------------------------------------------
function HudMap({ stops, dest, mapsHref }) {
  const layouts = [
    [[50, 50]],
    [[18, 76], [82, 26]],
    [[12, 80], [50, 50], [88, 22]],
    [[10, 82], [38, 58], [66, 40], [90, 18]],
  ];
  const safeStops = Array.isArray(stops) && stops.length > 0 ? stops.slice(0, 4) : [dest || "Destination"];
  const pos = layouts[Math.min(safeStops.length, 4) - 1] || [[50, 50]];
  const pts = safeStops.map((s, i) => ({ s, x: pos[i][0], y: pos[i][1] }));
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + " " + p.x + " " + p.y).join(" ");
  return (
    <div className="hudmap hud">
      <div className="hudmap-topo" />
      <div className="hudmap-meta mono">
        <span className="hudmap-led" /> LIVE MAP · {(dest || "").toUpperCase()}
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="hudmap-svg">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="0.5"
              strokeDasharray="2 2" opacity="0.7" vectorEffect="non-scaling-stroke" />
      </svg>
      {pts.map((p, i) => (
        <div key={i} className={"hudpin" + (i === pts.length - 1 ? " dest" : "")}
             style={{ left: p.x + "%", top: p.y + "%" }}>
          <span className="hudpin-dot" />
          <span className="hudpin-lab mono">{i === pts.length - 1 ? "★ " : ""}{p.s}</span>
        </div>
      ))}
      {mapsHref && (
        <a className="hudmap-open btn btn-ghost btn-sm" href={mapsHref} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Open in Maps
        </a>
      )}
    </div>
  );
}

function SectionTitle({ icon, title, sub }) {
  return (
    <div className="sec-title">
      {icon}
      <h3 className="serif">{title}</h3>
      {sub && <span className="trip-sub">{sub}</span>}
    </div>
  );
}

function PublicTrip({ trip }) {
  const it = trip.itinerary ?? {};
  const days = it.days ?? [];
  const weather = it.weather;
  const stays = it.stays ?? [];
  const packing = it.packing ?? [];
  const similar = it.similar_destinations ?? [];
  const photos = it.photos ?? [];
  const routeStops = Array.isArray(it.route_stops) ? it.route_stops : [];
  const accessNotes = trip.accessibility_notes ?? [];
  const totalEstimate = trip.estimated_cost_inr ?? 0;
  const [openPhotoIdx, setOpenPhotoIdx] = useState(null);
  const WIcon = useMemo(() => weatherIconFor(weather?.feel), [weather]);

  // Boarding-pass code — first 3 letters of destination + day count.
  const code = "AG-" + (trip.destination || "").replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() + "-" + days.length + "D";
  const mapStops = routeStops.length >= 2 ? routeStops : [trip.destination || "Destination"];
  const mapsHref = `https://www.google.com/maps?q=${encodeURIComponent(trip.destination ?? "")}`;

  return (
    <div className="relative min-h-screen" style={{ color: "var(--ink)" }}>
      <div className="aurora" />
      <div className="grain" />

      {/* Header strip */}
      <header
        className="safe-pt sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 sm:px-8"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--line)", backdropFilter: "blur(8px)" }}
      >
        <a href="/" className="brand" style={{ "--bz": "20px", textDecoration: "none" }}>
          <span className="brand-mark" style={{ width: 32, height: 32 }}>
            <Sparkles size={16} />
          </span>
          <span className="brand-word" style={{ fontSize: 20 }}>
            <span className="bw-1">AURA</span>
            <span className="bw-2">GO</span>
          </span>
        </a>
        <span className="pill">
          <Lock /> · Shared trip
        </span>
        <a href="/" className="btn btn-primary btn-cta btn-sm">
          Plan your own →
        </a>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-3 py-6 sm:px-6 sm:py-10">
        <section className="itin glass-strong rise">
          {/* BOARDING PASS */}
          <div className="pass hud">
            <div className="pass-l">
              {trip.vibe && <span className="pill-accent">{trip.vibe}</span>}
              <h2 className="serif-i itin-title">{trip.destination}</h2>
              <div className="itin-meta">
                {it.travel_date && (
                  <span>{new Date(it.travel_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}</span>
                )}
                {it.travel_date && <span className="dot">/</span>}
                <span>LOCKED {new Date(trip.locked_at || Date.now()).toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase()}</span>
              </div>
            </div>
            <div className="pass-stub">
              <div className="stub-row">
                <span className="stub-k">BOOKING</span>
                <span className="stub-v">{code}</span>
              </div>
              <div className="stub-row">
                <span className="stub-k">DAYS</span>
                <span className="stub-big">{days.length}</span>
              </div>
              <div className="stub-barcode" />
            </div>
          </div>

          {/* MULTI-STOP ROUTE PILLS (only when applicable) */}
          {routeStops.length >= 2 && (
            <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-soft)", textTransform: "uppercase" }}>
                Route · {routeStops.length} stops
              </span>
              {routeStops.map((stop, i) => (
                <span key={`${stop}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className="pill-accent" style={{ fontSize: 11, padding: "4px 10px" }}>{stop}</span>
                  {i < routeStops.length - 1 && <span style={{ color: "var(--ink-dim)" }}>→</span>}
                </span>
              ))}
            </div>
          )}

          {/* HUD MAP */}
          <HudMap stops={mapStops} dest={trip.destination} mapsHref={mapsHref} />

          {/* Live verified summary */}
          {it.rag_summary && (
            <div className="verified">
              <ShieldCheck size={16} className="accent" />
              <div>
                <span className="vtag mono">LIVE-VERIFIED</span>
                <p>{it.rag_summary}</p>
              </div>
            </div>
          )}

          {it.hazard && (
            <div className="hazard">
              <AlertTriangle size={16} />
              <div><strong>Heads up</strong><p>{it.hazard}</p></div>
            </div>
          )}

          {/* WEATHER */}
          {weather && (
            <div className="card">
              <div className="weather-top">
                <WIcon size={32} className="accent" />
                <div>
                  <div className="display weather-temp">{weather.temp_c || weather.summary}</div>
                  <div className="trip-sub">{weather.summary}</div>
                </div>
              </div>
              {weather.advice && (
                <div className="weather-pack"><Tag size={13} className="accent" /> {weather.advice}</div>
              )}
            </div>
          )}

          {/* PHOTO GALLERY */}
          {photos.length > 0 && (
            <>
              <SectionTitle icon={<ImageIcon size={14} className="accent" />} title="Snapshots" />
              <div className="gallery snap-x no-scrollbar">
                {photos.map((p, i) => (
                  <img
                    key={i}
                    src={p.thumb || p.url}
                    alt={p.alt || trip.destination}
                    className="gallery-ph"
                    style={{ height: 120, minWidth: 180, objectFit: "cover", cursor: "pointer" }}
                    onClick={() => setOpenPhotoIdx(i)}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ))}
              </div>
            </>
          )}

          {/* ACCESS NOTES */}
          {accessNotes.length > 0 && (
            <div className="access-note">
              <Accessibility size={16} className="accent" />
              <div>
                <strong>Smart access notes</strong>
                <ul style={{ marginTop: 4, paddingLeft: 0, listStyle: "none" }}>
                  {accessNotes.map((n, i) => (
                    <li key={i} style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>· {n}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* DAY PLAN — vertical timeline */}
          {days.length > 0 && (
            <>
              <SectionTitle icon={<Calendar size={14} className="accent" />}
                title={`${days.length}-day plan`}
                sub="tap any activity → maps" />
              <div className="timeline">
                {days.map((d) => {
                  const acts = (d.activities ?? d.acts ?? []).filter(Boolean);
                  return (
                    <div className="tl-day" key={d.day}>
                      <div className="tl-rail">
                        <span className="tl-node display">{d.day}</span>
                      </div>
                      <div className="tl-body">
                        <div className="tl-head">
                          <span className="tl-daylabel mono">DAY {String(d.day).padStart(2, "0")}</span>
                          <h4 className="serif tl-title">{d.title}</h4>
                        </div>
                        <ul className="tl-acts">
                          {acts.map((a, i) => {
                            const q = encodeURIComponent(`${a} ${trip.destination ?? ""}`.trim());
                            return (
                              <li key={i}>
                                <a href={`https://www.google.com/maps/search/?api=1&query=${q}`}
                                   target="_blank" rel="noreferrer">
                                  <span className="tl-dot" />{a}
                                  <ExternalLink size={12} className="act-ext" />
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* STAYS */}
          {stays.length > 0 && (
            <>
              <SectionTitle icon={<Bed size={14} className="accent" />} title="Where to stay" sub={`${stays.length} options`} />
              <div className="stays-grid">
                {stays.map((s, i) => (
                  <div key={i} className="stay-card">
                    <div className="stay-tier">{s.tier ?? s.best_for ?? s.type ?? "Stay"}</div>
                    <div className="stay-name">{s.name}</div>
                    {s.blurb && <div className="trip-sub">{s.blurb}</div>}
                    {s.price_per_night_inr && (
                      <div className="stay-price">
                        <span className="display">₹{fmtINR(s.price_per_night_inr)}</span>
                        <span className="su">/ night</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* PACKING */}
          {packing.length > 0 && (
            <>
              <SectionTitle icon={<Briefcase size={14} className="accent" />} title="Packing checklist" sub={`${packing.length} items`} />
              <div className="packing">
                {packing.map((p, i) => (
                  <span key={i} className="pack-item">
                    <span className="pack-box" /> {p}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* SIMILAR HIDDEN GEMS */}
          {similar.length > 0 && (
            <>
              <SectionTitle icon={<Sparkles size={14} className="accent" />} title="Similar hidden gems" />
              <div className="similar">
                {similar.map((s, i) => (
                  <span key={i} className="chip">
                    <Pin size={12} className="accent" /> {s.name ?? s}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* TOTALS */}
          {totalEstimate > 0 && (
            <div className="totals hud">
              <div className="total-row">
                <span>Estimated trip cost</span>
                <span className="mono">₹{fmtINR(totalEstimate)}</span>
              </div>
              <div className="total-row grand">
                <span className="mono grand-k">GRAND TOTAL</span>
                <span className="display grand-v">₹{fmtINR(totalEstimate)}</span>
              </div>
            </div>
          )}
        </section>

        <p className="mono" style={{
          textAlign: "center", marginTop: 20, fontSize: 10.5,
          letterSpacing: "0.14em", color: "var(--ink-dim)",
        }}>
          PLAN GENERATED BY AURAGO · <a href="/" className="accent" style={{ textDecoration: "none" }}>BUILD YOURS →</a>
        </p>
      </main>

      {/* Photo lightbox */}
      {openPhotoIdx !== null && photos[openPhotoIdx] && (
        <div
          className="aura-backdrop"
          onClick={() => setOpenPhotoIdx(null)}
          style={{ background: "rgba(0,0,0,0.92)", padding: 16 }}
        >
          <button
            onClick={() => setOpenPhotoIdx(null)}
            className="btn-icon"
            style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36 }}
            aria-label="Close photo"
          >
            <X size={16} />
          </button>
          <img
            src={photos[openPhotoIdx].url}
            alt={photos[openPhotoIdx].alt || trip.destination}
            style={{ maxWidth: "100%", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// Small Lock-styled icon helper since we used <Lock /> without the lucide
// component in the header pill (avoid the extra import).
function Lock() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
