import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Dice5, MapPin, LayoutGrid, Wand2, Users, X, ArrowRight, ArrowLeft, Check,
} from "lucide-react";

// =====================================================================
// Onboarding — a first-run guided tour. Centered step cards (robust
// across desktop/mobile, no fragile element anchoring) with Next /
// Back / Skip. Shown once per device (localStorage flag); re-openable
// via the "?" button in the sidebar.
// =====================================================================

const ONBOARD_KEY = "aurago.onboarded.v1";

export function hasSeenOnboarding() {
  try { return localStorage.getItem(ONBOARD_KEY) === "1"; } catch { return false; }
}
export function markOnboardingSeen() {
  try { localStorage.setItem(ONBOARD_KEY, "1"); } catch {}
}

const STEPS = [
  {
    icon: Sparkles,
    title: "Welcome to AuraGo",
    body: "Tell me your budget and vibe — I hand you 8 verified hidden-gem destinations with full day-by-day plans, live weather, prices and booking links. In about 30 seconds.",
  },
  {
    icon: Dice5,
    title: "Two ways to start",
    body: "Pick a mode in the bar at the bottom. “Surprise me” — describe a vibe and I'll find places you've never heard of. “I know where” — name a destination and I'll plan it (plus similar gems nearby).",
  },
  {
    icon: LayoutGrid,
    title: "The departures board",
    body: "Your 8 picks land on a live board — ranked by AI value, each with a vibe, score and starting cost. Tap any row to flip it open into the full boarding-pass itinerary.",
  },
  {
    icon: Wand2,
    title: "Make it yours",
    body: "Inside a plan you can refine it (“make it cheaper”, “indoor Day 2”), shuffle a day's activities, re-plan around live weather, and ask the concierge bot anything about the destination.",
  },
  {
    icon: Users,
    title: "Plan together, then lock it",
    body: "Invite friends with one link — everyone edits live, votes in polls and chats. Happy with a trip? Lock it in to get a shareable read-only link. Start anytime with “New trip” up top.",
  },
];

export default function Onboarding({ open, onClose }) {
  const [i, setI] = useState(0);
  if (!open) return null;

  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const Icon = step.icon;

  const finish = () => { markOnboardingSeen(); onClose?.(); };

  return (
    <div className="aura-backdrop" style={{ zIndex: 250 }}>
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        className="aura-modal glass-strong"
        style={{ maxWidth: 440, padding: 0, overflow: "hidden" }}
      >
        {/* top accent strip with skip */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--line)",
        }}>
          <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Sparkles size={11} className="accent" /> QUICK TOUR · {i + 1}/{STEPS.length}
          </span>
          <button onClick={finish} className="btn-icon" style={{ width: 32, height: 32 }} aria-label="Skip tour">
            <X size={14} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "26px 24px 8px" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22 }}
            >
              <div
                className="grid place-items-center"
                style={{
                  width: 56, height: 56, borderRadius: 14, marginBottom: 18,
                  background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
                  color: "var(--accent)",
                }}
              >
                <Icon size={26} strokeWidth={1.6} />
              </div>
              <h2 className="serif" style={{ fontSize: 26, lineHeight: 1.1, marginBottom: 10 }}>
                {step.title}
              </h2>
              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-soft)" }}>
                {step.body}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* progress dots */}
          <div style={{ display: "flex", gap: 6, marginTop: 22, marginBottom: 4 }}>
            {STEPS.map((_, idx) => (
              <span
                key={idx}
                onClick={() => setI(idx)}
                style={{
                  height: 5, borderRadius: 3, cursor: "pointer", transition: "all 0.2s",
                  width: idx === i ? 22 : 6,
                  background: idx === i ? "var(--accent)" : "var(--line-2)",
                }}
              />
            ))}
          </div>
        </div>

        {/* footer nav */}
        <div style={{ display: "flex", gap: 10, padding: "14px 24px 22px" }}>
          {i > 0 ? (
            <button onClick={() => setI(i - 1)} className="btn btn-ghost" style={{ flex: "0 0 auto" }}>
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <button onClick={finish} className="btn btn-ghost" style={{ flex: "0 0 auto" }}>
              Skip
            </button>
          )}
          <button
            onClick={() => (last ? finish() : setI(i + 1))}
            className="btn btn-primary btn-cta"
            style={{ flex: 1 }}
          >
            {last ? (<><Check size={14} /> Start exploring</>) : (<>Next <ArrowRight size={14} /></>)}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
