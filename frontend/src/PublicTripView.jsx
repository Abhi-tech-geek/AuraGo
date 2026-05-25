import { useEffect, useMemo, useState } from "react";
import {
  Loader2, MapPin, Sparkles, Lock, ShieldCheck, AlertTriangle,
  CloudSun, Snowflake, Sun, CloudRain, Cloud, Thermometer,
  Hotel, Building2, Star, CheckSquare, Plane, Train, ExternalLink,
  Accessibility, Image as ImageIcon, X,
} from "lucide-react";

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
      <div className="relative flex min-h-screen items-center justify-center text-slate-300">
        <div className="aurora" />
        <div className="grain" />
        <Loader2 size={20} className="animate-spin accent-text" />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4 text-slate-200">
        <div className="aurora" />
        <div className="grain" />
        <div className="glass-strong relative z-10 max-w-md rounded-2xl p-6 text-center">
          <p className="serif mb-2 text-2xl">Trip not found</p>
          <p className="text-sm text-slate-400">
            {error ?? "The shared link may be invalid or the trip has been removed."}
          </p>
          <a
            href="/"
            className="accent-bg accent-glow mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Plan your own trip →
          </a>
        </div>
      </div>
    );
  }

  return <PublicTrip trip={trip} />;
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
  const safeNights = Math.max(1, days.length - 1 || 1);
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(trip.destination ?? "")}&output=embed`;
  const dateForUrl = it.travel_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const [openPhotoIdx, setOpenPhotoIdx] = useState(null);

  const Icon = useMemo(() => weatherIconFor(weather?.feel), [weather]);

  return (
    <div className="relative min-h-screen text-slate-100">
      <div className="aurora" />
      <div className="grain" />

      {/* Header */}
      <header className="glass safe-pt sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-2.5 sm:px-8 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="accent-bg accent-glow grid h-9 w-9 shrink-0 place-items-center rounded-2xl sm:h-10 sm:w-10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-slate-900">
              <path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z" fill="currentColor"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="serif truncate text-xl leading-none sm:text-2xl">AuraGo</h1>
            <p className="hidden text-[11px] text-slate-400 sm:block">Shared trip · view only</p>
          </div>
        </div>
        <a
          href="/"
          className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] hover:bg-white/[0.08] sm:text-xs"
        >
          Plan your own →
        </a>
      </header>

      <main className="safe-px relative z-10 mx-auto max-w-3xl px-3 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
        <div className="glass-strong accent-border accent-glow overflow-hidden rounded-2xl p-5 sm:p-6">
          {/* Title */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Lock size={14} className="accent-text" />
              <h2 className="serif text-2xl">{trip.destination}</h2>
              {trip.vibe && (
                <span className="accent-soft-bg accent-text rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider">
                  {trip.vibe}
                </span>
              )}
            </div>
            {trip.locked_at && (
              <span className="text-[11px] text-slate-500">
                Locked {new Date(trip.locked_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Multi-stop route bar */}
          {routeStops.length >= 2 && (
            <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
                <Sparkles size={11} className="accent-text" />
                Route · {routeStops.length} stops
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {routeStops.map((stop, i) => (
                  <span key={`${stop}-${i}`} className="flex items-center gap-1.5">
                    <span className="accent-soft-bg accent-text rounded-full px-2.5 py-1 text-[12px] font-medium">
                      {stop}
                    </span>
                    {i < routeStops.length - 1 && <span className="text-slate-500">→</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Live verified */}
          {it.rag_summary && (
            <div className="accent-border mb-4 flex items-start gap-2 rounded-lg border bg-white/[0.025] p-3 text-[13px] text-slate-300">
              <ShieldCheck size={14} className="accent-text mt-0.5" />
              <div><span className="font-medium text-slate-100">Live verified · </span>{it.rag_summary}</div>
            </div>
          )}

          {/* Hazard */}
          {it.hazard && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3 text-[13px] text-amber-100">
              <AlertTriangle size={14} className="mt-0.5 text-amber-300" />
              <div><span className="font-medium">Heads up · </span>{it.hazard}</div>
            </div>
          )}

          {/* Weather */}
          {weather && (
            <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Icon size={11} className="accent-text" />
                  Weather · {weather.feel ?? "expected"}
                </div>
                {it.travel_date && <span className="text-slate-500">{it.travel_date}</span>}
              </div>
              <div className="flex items-start gap-3">
                <div className="accent-soft-bg accent-text grid h-12 w-12 shrink-0 place-items-center rounded-xl">
                  <Icon size={22} />
                </div>
                <div className="flex-1">
                  <div className="text-[15px] font-medium text-slate-100">{weather.summary}</div>
                  {weather.temp_c && <div className="text-[12px] text-slate-400">{weather.temp_c}</div>}
                  {weather.advice && (
                    <div className="mt-1 text-[12.5px] text-slate-300">
                      <span className="accent-text font-medium">Tip · </span>{weather.advice}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Map */}
          <div className="mb-4 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400">
              <div className="flex items-center gap-1.5">
                <MapPin size={11} className="accent-text" /> Map
              </div>
              <a
                href={`https://www.google.com/maps?q=${encodeURIComponent(trip.destination ?? "")}`}
                target="_blank" rel="noreferrer"
                className="accent-text hover:underline"
              >
                Open in Google Maps ↗
              </a>
            </div>
            <iframe
              title={`Map of ${trip.destination}`}
              src={mapSrc}
              className="h-56 w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>

          {/* Photos */}
          {photos.length > 0 && (
            <div className="mb-4 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400">
                <div className="flex items-center gap-1.5">
                  <ImageIcon size={11} className="accent-text" /> Photos
                </div>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(trip.destination ?? "")}&tbm=isch`}
                  target="_blank" rel="noreferrer"
                  className="accent-text hover:underline"
                >
                  More on Google ↗
                </a>
              </div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {photos.slice(0, 6).map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setOpenPhotoIdx(i)}
                    className="group relative aspect-[4/3] overflow-hidden bg-white/[0.04]"
                  >
                    <img
                      src={p.thumb || p.url}
                      alt={p.alt || trip.destination}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:opacity-90"
                    />
                  </button>
                ))}
              </div>
              {openPhotoIdx !== null && photos[openPhotoIdx] && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur"
                  onClick={() => setOpenPhotoIdx(null)}
                >
                  <img
                    src={photos[openPhotoIdx].url}
                    alt={photos[openPhotoIdx].alt || trip.destination}
                    className="max-h-[85vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={() => setOpenPhotoIdx(null)}
                    aria-label="Close photo"
                    className="fixed right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-900/80 text-slate-200 backdrop-blur"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Day plan */}
          {days.length > 0 && (
            <div className="mb-5">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
                <Sparkles size={11} className="accent-text" />
                {days.length}-day plan
              </div>
              <div className="grid gap-2">
                {days.map((d) => (
                  <div key={d.day} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="mb-1 flex items-center gap-2 text-[12px]">
                      <span className="accent-soft-bg accent-text rounded-full px-2 py-0.5 text-[10px] font-semibold">Day {d.day}</span>
                      <span className="text-slate-300">{d.title}</span>
                    </div>
                    <ul className="space-y-0.5 text-[13px] text-slate-300">
                      {(d.activities ?? d.acts ?? []).map((a, i) => (
                        <li key={i} className="flex gap-2"><span className="accent-text">•</span>{a}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Accessibility notes */}
          {accessNotes.length > 0 && (
            <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
                <Accessibility size={11} className="accent-text" /> Smart access notes
              </div>
              <ul className="space-y-1 text-[13px] text-slate-200">
                {accessNotes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            </div>
          )}

          {/* Stays */}
          {stays.length > 0 && (
            <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
                <Hotel size={11} className="accent-text" />
                Stay options · {safeNights} {safeNights === 1 ? "night" : "nights"}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {stays.map((s, i) => {
                  const TypeIcon = ((s.type ?? "").toLowerCase().includes("hostel")) ? Building2 : Hotel;
                  const checkout = new Date(new Date(dateForUrl).getTime() + safeNights * 86400000)
                    .toISOString().slice(0, 10);
                  const bookUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${s.name ?? ""} ${trip.destination ?? ""}`.trim())}&checkin=${dateForUrl}&checkout=${checkout}`;
                  return (
                    <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <TypeIcon size={13} className="accent-text shrink-0" />
                            <span className="truncate text-[14px] font-medium text-slate-100">{s.name}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">
                            {s.type}{s.best_for ? ` · ${s.best_for}` : ""}
                          </div>
                        </div>
                        {typeof s.rating === "number" && (
                          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px]">
                            <Star size={10} className="accent-text" fill="currentColor" />
                            <span className="font-medium text-slate-100">{s.rating.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                      {s.blurb && <p className="mb-2 line-clamp-2 text-[12.5px] text-slate-300">{s.blurb}</p>}
                      <div className="flex items-end justify-between border-t border-white/[0.06] pt-2 text-[12px]">
                        <div>
                          <div className="text-slate-400">per night</div>
                          <div className="font-semibold text-slate-100">₹{fmtINR(s.price_per_night_inr)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-slate-500">{safeNights} {safeNights === 1 ? "night" : "nights"}</div>
                          <div className="accent-text font-semibold">₹{fmtINR((s.price_per_night_inr ?? 0) * safeNights)}</div>
                        </div>
                      </div>
                      <a
                        href={bookUrl} target="_blank" rel="noreferrer"
                        className="accent-bg accent-glow mt-2 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold text-slate-900 hover:scale-[1.02]"
                      >
                        Book on Booking.com ↗
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Packing */}
          {packing.length > 0 && (
            <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
                <CheckSquare size={11} className="accent-text" /> Packing checklist
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {packing.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[13px] text-slate-200">
                    <span className="accent-text">·</span>{item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Booking quick links */}
          <div className="mb-5 grid gap-2 sm:grid-cols-2">
            <a
              href={`https://www.skyscanner.co.in/transport/flights-to/${encodeURIComponent((trip.destination ?? "").toLowerCase().slice(0,3))}/`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.05]"
            >
              <Plane size={14} className="accent-text" />
              <span className="text-[13px] text-slate-100">Search flights</span>
              <ExternalLink size={11} className="ml-auto text-slate-400" />
            </a>
            <a
              href={`https://www.confirmtkt.com/`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.05]"
            >
              <Train size={14} className="accent-text" />
              <span className="text-[13px] text-slate-100">Search trains</span>
              <ExternalLink size={11} className="ml-auto text-slate-400" />
            </a>
          </div>

          {/* Total */}
          <div className="accent-soft-bg flex items-center justify-between rounded-lg p-3 text-sm">
            <span className="font-medium">Estimated total</span>
            <span className="serif text-xl">₹{fmtINR(totalEstimate)}</span>
          </div>

          {/* Similar */}
          {similar.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
                <Sparkles size={11} className="accent-text" /> Similar places to explore
              </div>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {similar.map((s, i) => (
                  <div
                    key={i}
                    className="flex w-[180px] shrink-0 flex-col gap-1 rounded-xl border border-white/[0.08] p-3"
                    style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }}
                  >
                    <span className="text-2xl">{s.emoji ?? "✦"}</span>
                    <div className="text-[13px] font-medium text-slate-100">{s.name}</div>
                    <div className="line-clamp-2 text-[11px] text-slate-400">{s.tagline}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-6 text-center text-[11px] text-slate-500">
            Shared via AuraGo · <a href="/" className="accent-text hover:underline">plan your own trip</a>
          </p>
        </div>
      </main>
    </div>
  );
}
