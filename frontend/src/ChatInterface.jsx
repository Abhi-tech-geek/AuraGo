// =====================================================================
// AuraGo — ChatInterface.jsx
// Visual style ported from AuraGo_Demo.html (aurora bg, glassmorphism v2,
// budget modal, route picker, smart breakdown, mode toggle).
// Backend integration unchanged: Supabase Realtime + /api/chat/* routes.
// =====================================================================

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  Send, Sparkles, Lock, LockOpen, ArrowLeft, ShieldCheck,
  AlertTriangle, Accessibility, Loader2, MapPin, Plus,
  Sliders, Menu, CloudSun, Snowflake, Sun, CloudRain, Cloud, Thermometer,
  Hotel, Star, Plane, Train, Building2, MessageCircle, X, CheckSquare,
  Square, Bot, Share2, Check, Car, ChevronLeft, ChevronRight, ImageIcon,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import BudgetModal from "./BudgetModal";
import ConciergeChat from "./ConciergeChat";
import {
  computeRoutes, computeBudgetBreakdown, fmtINR, promptFromPrefs,
  KNOWN_DESTINATIONS,
} from "./lib/tripPlanning";

const FALLBACK_PREFS = {
  mode: "elite", origin: "Delhi", party_size: 4, days: 4,
  budget_inr: 150000, universal_access: false, start_date: "",
};

export default function ChatInterface({
  sessionId, currentUser, prefs: prefsProp, onPrefsChange,
  onOpenSidebar, onToggleSidebar, sidebarPinned = true,
  onSessionTitleChange,
}) {
  const prefs = prefsProp ?? FALLBACK_PREFS;
  const [session, setSession]     = useState(null);
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState("");
  const [sending, setSending]     = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [openCard, setOpenCard]   = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [composerMode, setComposerMode] = useState("mystery"); // "mystery" | "direct"
  // When user types a destination in direct mode, we open the modal first so
  // they can confirm budget / people / days / date — then we plan with those
  // confirmed prefs instead of using stale session defaults.
  const [pendingDestination, setPendingDestination] = useState(null);

  // Apply mode class to <body> so CSS variables flip globally
  useEffect(() => {
    document.body.classList.toggle("sasta", prefs.mode === "sasta");
    return () => document.body.classList.remove("sasta");
  }, [prefs.mode]);

  // ---- initial load ------------------------------------------------
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const [sessionResult, messagesResult] = await Promise.all([
          supabase.from("sessions").select("*").eq("id", sessionId).single(),
          supabase.from("messages").select("*")
            .eq("session_id", sessionId).order("created_at", { ascending: true }),
        ]);
        if (cancelled) return;
        if (sessionResult.error && sessionResult.error.code !== "PGRST116") {
          throw sessionResult.error;
        }
        if (messagesResult.error) throw messagesResult.error;
        setSession(sessionResult.data);
        setMessages(messagesResult.data ?? []);
      } catch (e) {
        if (cancelled) return;
        console.error("initial chat load failed", e);
        setLoadError("Saved chat could not be loaded.");
        setMessages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // ---- realtime --------------------------------------------------
  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase
      .channel(`session:${sessionId}`)
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "messages",
            filter: `session_id=eq.${sessionId}` },
          (p) => setMessages((prev) =>
            prev.some((x) => x.id === p.new.id) ? prev : [...prev, p.new]))
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "trips",
            filter: `session_id=eq.${sessionId}` },
          (p) => setMessages((prev) =>
            prev.some((x) => x.id === `lock-${p.new.id}`)
              ? prev
              : [...prev, {
                  id: `lock-${p.new.id}`,
                  role: "system", kind: "lock_event",
                  content: `Locked: ${p.new.destination}`,
                  payload: p.new,
                  created_at: p.new.locked_at,
                }]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId]);

  // ---- autoscroll: scroll a sentinel into view at the bottom of the feed.
  // Triggers on message changes, when an itinerary opens, or while sending.
  const bottomRef = useRef(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [messages.length, sending, openCard]);

  // ---- send a turn (free text or modal-built prompt) ---------------
  const sendTurn = useCallback(async (text) => {
    if (!text || sending) return;
    setSending(true);

    const localUserMsg = {
      id: `local-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      session_id: sessionId,
      author_id: currentUser.id,
      role: "user", kind: "text", content: text,
      payload: null, created_at: new Date().toISOString(),
    };

    try {
      const { data: userMsg, error } = await supabase.from("messages").insert({
        session_id: sessionId, author_id: currentUser.id,
        role: "user", kind: "text", content: text,
      }).select().single();
      if (error) throw error;
      setMessages((m) =>
        m.some((x) => x.id === userMsg?.id) ? m : [...m, userMsg ?? localUserMsg]);
    } catch (e) {
      console.error("message insert failed", e);
      setMessages((m) => [...m, localUserMsg]);
    }

    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      const r = await fetch("/api/chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId, prompt: text }),
        credentials: "include",
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body || `Backend returned ${r.status}`);
      }
    } catch (e) {
      console.error(e);
      setMessages((m) => [...m, {
        id: `err-${Date.now()}`,
        session_id: sessionId,
        role: "assistant",
        kind: "text",
        content: `Something went wrong: ${e.message ?? e}. ` +
                 `Try again in a moment — if it keeps failing, ` +
                 `check the backend logs (rate limits / API keys).`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }, [sending, sessionId, currentUser]);

  // sendDirect — plan ONE destination directly (no mystery deck).
  // Reused by both the composer's direct mode and the "Similar destinations" chips.
  // `prefsOverride` lets callers (e.g. the modal submit) hand in the
  // just-confirmed prefs synchronously, sidestepping React render staleness.
  const sendDirect = useCallback(async (destinationName, prefsOverride) => {
    const name = destinationName?.trim();
    if (!name || sending) return;
    const effective = prefsOverride ?? prefs;
    setSending(true);

    const chatLine = {
      id: `local-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      session_id: sessionId, author_id: currentUser.id,
      role: "user", kind: "text",
      content: `Plan ${name} for me`,
      payload: null, created_at: new Date().toISOString(),
    };
    try {
      const { data: userMsg } = await supabase.from("messages").insert({
        session_id: sessionId, author_id: currentUser.id,
        role: "user", kind: "text", content: chatLine.content,
      }).select().single();
      setMessages((m) => m.some((x) => x.id === userMsg?.id) ? m : [...m, userMsg ?? chatLine]);
    } catch {
      setMessages((m) => [...m, chatLine]);
    }

    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      const r = await fetch("/api/chat/direct", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId, destination: name,
          startDate: effective.start_date || null,
          // Send the *just-confirmed* intent so the backend doesn't race
          // against the session-row update.
          intent: {
            mode: effective.mode,
            budget_inr: effective.budget_inr,
            party_size: effective.party_size,
            universal_access: effective.universal_access,
          },
        }),
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      const data = await r.json();
      if (data.deckMessageId && data.cardId) {
        setOpenCard((s2) => ({ ...s2, [data.deckMessageId]: data.cardId }));
      }
    } catch (e) {
      console.error("direct plan failed", e);
      setMessages((m) => [...m, {
        id: `err-${Date.now()}`,
        session_id: sessionId, role: "assistant", kind: "text",
        content: `Couldn't plan that one: ${e.message ?? e}. Try again in a moment.`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }, [sending, sessionId, currentUser, prefs]);

  const handleSendInput = useCallback(() => {
    const text = input.trim();
    if (!text) { setModalOpen(true); return; }
    setInput("");
    if (composerMode === "direct") {
      // For direct destinations, open the budget modal first so the user
      // confirms budget / people / days / date — then plan.
      setPendingDestination(text);
      setModalOpen(true);
    } else {
      sendTurn(text);
    }
  }, [input, composerMode, sendTurn]);

  const handleModalSubmit = useCallback((next) => {
    setModalOpen(false);
    onPrefsChange?.(next);
    if (pendingDestination) {
      const dest = pendingDestination;
      setPendingDestination(null);
      // Pass `next` directly so we don't read stale prefs from closure.
      sendDirect(dest, next);
    } else {
      sendTurn(promptFromPrefs(next));
    }
  }, [onPrefsChange, sendTurn, sendDirect, pendingDestination]);

  const handleModeToggle = useCallback((m) => {
    if (m === prefs.mode) return;
    onPrefsChange?.({ ...prefs, mode: m });
  }, [prefs, onPrefsChange]);

  const onCardOpen = useCallback(async (deckMsgId, card) => {
    setOpenCard((s) => ({ ...s, [deckMsgId]: card.id }));
    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      await fetch("/api/chat/expand-card", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId, deckMessageId: deckMsgId, cardId: card.id,
          startDate: prefs.start_date || null,
        }),
        credentials: "include",
      });
    } catch (e) {
      console.error("expand-card failed", e);
    }
  }, [sessionId, prefs.start_date]);

  const onBackToDeck = useCallback((deckMsgId) => {
    setOpenCard((s) => { const n = { ...s }; delete n[deckMsgId]; return n; });
  }, []);

  // User clicked a "Similar destinations" chip → reuse the direct-plan path.
  const handlePickSimilar = useCallback((s) => {
    if (!s?.name) return;
    sendDirect(s.name);
  }, [sendDirect]);

  const findItinerary = useCallback((deckMsgId, cardId) =>
    messages.find(
      (m) => m.kind === "itinerary"
          && m.parent_message_id === deckMsgId
          && m.payload?.card_id === cardId
    ),
  [messages]);

  return (
    <div className="relative min-h-screen text-slate-100">
      <div className="aurora" />
      <div className="grain" />

      {/* ================= HEADER ================= */}
      <header className="glass safe-pt sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Always-visible sidebar toggle (works on mobile + desktop) */}
          <motion.button
            onClick={onToggleSidebar ?? onOpenSidebar}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 420, damping: 18 }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
            aria-label={sidebarPinned ? "Hide trips" : "Show trips"}
          >
            <Menu size={16} />
          </motion.button>
          {/* Brand block — collapses to icon-only on desktop when sidebar is
              pinned (avoids the duplicate AuraGo) */}
          <div className="accent-bg accent-glow grid h-9 w-9 shrink-0 place-items-center rounded-2xl sm:h-10 sm:w-10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-slate-900">
              <path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z" fill="currentColor"/>
            </svg>
          </div>
          <div className={`min-w-0 ${sidebarPinned ? "md:hidden" : ""}`}>
            <h1 className="serif truncate text-xl leading-none sm:text-2xl">AuraGo</h1>
            <p className="hidden text-[11px] text-slate-400 sm:block">AI travel discovery</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setModalOpen(true)}
            className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs hover:bg-white/[0.08] sm:flex"
          >
            <Plus size={12} /> Trip preferences
          </button>
          <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-0.5 text-[11px] sm:text-xs">
            <ModeBtn active={prefs.mode === "sasta"} onClick={() => handleModeToggle("sasta")}>Sasta</ModeBtn>
            <ModeBtn active={prefs.mode === "elite"} onClick={() => handleModeToggle("elite")}>Elite</ModeBtn>
          </div>
        </div>
      </header>

      {/* ================= FEED ================= */}
      <motion.main
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mx-auto max-w-3xl px-3 py-6 sm:px-6 sm:py-8"
        style={{ paddingBottom: "calc(10rem + env(safe-area-inset-bottom))" }}
      >
        <LayoutGroup>
          <div className="flex flex-col gap-5">
            {messages.length === 0 && !sending && (
              <Welcome loadError={loadError} onOpenModal={() => setModalOpen(true)} />
            )}
            <AnimatePresence initial={false}>
              {messages.map((m) => {
                if (m.kind === "mystery_deck") {
                  const opened = openCard[m.id];
                  const itin = opened ? findItinerary(m.id, opened) : null;
                  return (
                    <motion.div key={m.id} layout
                      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: "easeOut" }}>
                      <MysteryDeck
                        message={m} prefs={prefs} dimmed={!!opened}
                        onCardOpen={(card) => onCardOpen(m.id, card)}
                      />
                      <AnimatePresence>
                        {itin && (
                          <ItineraryView
                            key={itin.id}
                            itinerary={itin}
                            deck={m}
                            prefs={prefs}
                            sessionId={sessionId}
                            onBack={() => onBackToDeck(m.id)}
                            onPickSimilar={handlePickSimilar}
                            onLocked={(destination) => onSessionTitleChange?.(sessionId, destination)}
                          />
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                }
                if (m.kind === "itinerary") return null;
                if (m.kind === "qa_notice") return <QANotice key={m.id} message={m} />;
                if (m.kind === "lock_event") return <LockChip key={m.id} message={m} />;
                return <MessageBubble key={m.id} message={m} />;
              })}
            </AnimatePresence>

            {sending && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin accent-text" />
                Checking live data (Serper + reviews)…
              </div>
            )}
            {/* Auto-scroll sentinel */}
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        </LayoutGroup>
      </motion.main>

      {/* ================= COMPOSER ================= */}
      <footer
        className={`safe-bottom-pad safe-px fixed bottom-0 right-0 z-20 px-3 pt-2 transition-[left] duration-300 ease-out sm:px-8 ${sidebarPinned ? "left-0 md:left-72" : "left-0"}`}
        style={{ background: "linear-gradient(to top, var(--bg-2) 60%, transparent)" }}
      >
        {/* Composer mode switcher — Mystery vs Direct */}
        <div className="mx-auto mb-2 flex max-w-3xl justify-center">
          <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-0.5 text-[11px]">
            <ComposerModeBtn
              active={composerMode === "mystery"}
              onClick={() => setComposerMode("mystery")}
              icon="🎲"
              label="Surprise me"
            />
            <ComposerModeBtn
              active={composerMode === "direct"}
              onClick={() => setComposerMode("direct")}
              icon="📍"
              label="I know where"
            />
          </div>
        </div>

        <div className="glass-strong mx-auto flex max-w-3xl items-end gap-2 rounded-2xl p-2">
          <button
            onClick={() => setModalOpen(true)}
            title="Trip preferences"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 hover:bg-white/[0.06]"
          >
            <Sliders size={16} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault(); handleSendInput();
              }
            }}
            placeholder={composerMode === "direct"
              ? "Type a destination, e.g. Goa or Manali"
              : "Describe your dream trip… (or pick 'I know where' above)"}
            rows={1}
            className="accent-ring max-h-40 flex-1 resize-none rounded-lg bg-transparent px-3 py-2.5 text-[15px] placeholder:text-slate-500 focus:outline-none"
          />
          <motion.button
            onClick={handleSendInput}
            disabled={sending}
            whileHover={{ scale: 1.06, rotate: -3 }}
            whileTap={{ scale: 0.92, rotate: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 18 }}
            className="accent-bg accent-glow grid h-10 w-10 shrink-0 place-items-center rounded-xl disabled:opacity-50"
          >
            <Send size={16} className="text-slate-900" />
          </motion.button>
        </div>
        <ComposerTagline />
      </footer>

      <BudgetModal
        open={modalOpen}
        initial={prefs}
        destinationHint={pendingDestination}
        onClose={() => { setModalOpen(false); setPendingDestination(null); }}
        onSubmit={handleModalSubmit}
      />

      <ConciergeChat context={openItineraryContext(messages, openCard)} />
    </div>
  );
}

// Pick the currently-open itinerary's payload to feed the concierge.
function openItineraryContext(messages, openCard) {
  for (const [deckId, cardId] of Object.entries(openCard)) {
    const itin = messages.find(
      (m) => m.kind === "itinerary"
          && m.parent_message_id === deckId
          && m.payload?.card_id === cardId
    );
    if (itin?.payload) {
      return {
        destination: itin.payload.destination,
        vibe:        itin.payload.vibe,
        weather:     itin.payload.weather,
        days:        itin.payload.days?.length,
      };
    }
  }
  return null;
}


// =====================================================================
// Sub-components
// =====================================================================

function ModeBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-2.5 py-1 transition sm:px-3 sm:py-1.5"
      style={{
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "",
      }}
    >
      {children}
    </button>
  );
}

// Rotating one-liner under the composer. New users see a friendly tagline
// instead of the technical trip-state dump.
const TAGLINES = [
  "Plan smarter, travel softer ✨",
  "Five verified picks. One concierge bot. Zero spreadsheets.",
  "Hand AuraGo the wheel, or just say where.",
  "Live-checked plans. Booking links inside.",
  "From mystery to memory in 30 seconds.",
];

function ComposerTagline() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % TAGLINES.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="mx-auto mt-2 flex h-5 max-w-3xl items-center justify-center overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.p
          key={idx}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="text-[11.5px] text-slate-500"
        >
          {TAGLINES[idx]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function ComposerModeBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition"
      style={{
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "rgb(148 163 184)",
      }}
    >
      <span className="text-[13px] leading-none">{icon}</span>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function Welcome({ loadError, onOpenModal }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass relative mt-[10vh] overflow-hidden rounded-2xl p-5"
    >
      {/* slow drifting accent blob behind the copy */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full blur-3xl"
        style={{ background: "var(--accent-soft)" }}
        animate={{ x: [0, 20, 0], y: [0, 10, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
          <Sparkles size={10} className="accent-text" />
          AuraGo
        </div>
        <motion.p
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.45 }}
          className="serif mb-2 text-2xl leading-tight"
        >
          Hi, I'm AuraGo.
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.45 }}
          className="text-[15px] leading-relaxed text-slate-200"
        >
          I'll plan your trip in 30 seconds. Click <strong>"New trip"</strong>, type a destination, or describe your dream trip below.
        </motion.p>
        <p className="mt-3 text-xs text-slate-400">
          Try: <em>"Plan an elite trip for 4 from Mumbai with wheelchair access"</em> or just <em>"Goa"</em>.
        </p>
        {loadError && <p className="mt-3 text-[12.5px] text-amber-200">{loadError}</p>}
        <motion.button
          onClick={onOpenModal}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          className="accent-bg accent-glow mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-slate-900"
        >
          Start a trip →
        </motion.button>
      </div>
    </motion.div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <motion.div layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={isUser
        ? "max-w-[85%] rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3 text-[15px]"
        : "glass max-w-[88%] rounded-2xl px-4 py-3 text-[15px]"}>
        {!isUser && (
          <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
            <Sparkles size={10} className="accent-text" /> AuraGo
          </div>
        )}
        <p className="whitespace-pre-wrap text-slate-100">{message.content}</p>
      </div>
    </motion.div>
  );
}

function QANotice({ message }) {
  return (
    <motion.div layout
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[12.5px] text-slate-300"
    >
      <ShieldCheck size={13} className="accent-text mt-0.5" />
      <span><span className="font-medium text-slate-100">QA Agent · </span>{message.content}</span>
    </motion.div>
  );
}

function LockChip({ message }) {
  return (
    <motion.div layout
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="mx-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs text-slate-300"
    >
      <Lock size={12} className="accent-text" />
      {message.content}
    </motion.div>
  );
}


// =====================================================================
// MysteryDeck
// =====================================================================
function MysteryDeck({ message, prefs, dimmed, onCardOpen }) {
  const cards = message.payload?.cards ?? [];
  const scrollerRef = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Keep arrow / dot state in sync with scroll position
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanPrev(el.scrollLeft > 4);
      setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
      // active index = nearest card start
      const cardWidth = (el.querySelector("[data-card]")?.clientWidth ?? 240) + 12; // gap-3 = 12px
      setActiveIdx(Math.round(el.scrollLeft / cardWidth));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [cards.length]);

  const scrollBy = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    const cardWidth = (el.querySelector("[data-card]")?.clientWidth ?? 240) + 12;
    el.scrollBy({ left: dir * cardWidth, behavior: "smooth" });
  };

  const scrollToIdx = (i) => {
    const el = scrollerRef.current;
    if (!el) return;
    const cardWidth = (el.querySelector("[data-card]")?.clientWidth ?? 240) + 12;
    el.scrollTo({ left: i * cardWidth, behavior: "smooth" });
  };

  return (
    <motion.div layout
      animate={{ opacity: dimmed ? 0.3 : 1, scale: dimmed ? 0.98 : 1 }}
      transition={{ duration: 0.25 }}
      className={`glass-strong accent-border relative rounded-2xl p-3 sm:p-5 ${dimmed ? "pointer-events-none" : ""}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <Sparkles size={10} className="accent-text" />
          {cards.length} verified mystery options
        </div>
        <div className="text-[11px] text-slate-400">
          From <span className="accent-text font-medium">{prefs.origin}</span> ·
          ₹{fmtINR(prefs.budget_inr)} · {prefs.days} {prefs.days === 1 ? "day" : "days"} · {prefs.party_size} {prefs.party_size === 1 ? "person" : "people"}
        </div>
      </div>
      {message.payload?.intro && (
        <p className="mb-4 text-[15px] leading-relaxed text-slate-100">
          {message.payload.intro}
        </p>
      )}

      {/* Deck + chevron arrows. Arrows hidden on mobile (touch swipe is enough). */}
      <div className="relative">
        <div ref={scrollerRef} className="deck-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {cards.map((c, i) => (
            <MysteryCard
              key={c.id} card={c} index={i}
              onOpen={() => onCardOpen(c)} disabled={dimmed}
            />
          ))}
        </div>

        {/* Prev */}
        <button
          onClick={() => scrollBy(-1)}
          aria-label="Previous card"
          className={`absolute left-0 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-slate-900/80 p-1.5 text-slate-200 backdrop-blur transition hover:bg-slate-900 sm:flex ${canPrev ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <ChevronLeft size={16} />
        </button>
        {/* Next */}
        <button
          onClick={() => scrollBy(1)}
          aria-label="Next card"
          className={`absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-white/10 bg-slate-900/80 p-1.5 text-slate-200 backdrop-blur transition hover:bg-slate-900 sm:flex ${canNext ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Dot indicators */}
      {cards.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {cards.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to card ${i + 1}`}
              onClick={() => scrollToIdx(i)}
              className="rounded-full transition"
              style={{
                width:  i === activeIdx ? 18 : 6,
                height: 6,
                background: i === activeIdx ? "var(--accent)" : "rgba(255,255,255,0.18)",
              }}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function MysteryCard({ card, index, onOpen, disabled }) {
  return (
    <motion.button
      layoutId={`card-${card.id}`}
      data-card
      onClick={onOpen} disabled={disabled}
      initial={{ opacity: 0, y: 14, rotateZ: -1.5 }}
      animate={{ opacity: 1, y: 0, rotateZ: 0 }}
      whileHover={!disabled ? { y: -4, scale: 1.015 } : {}}
      whileTap={!disabled ? { scale: 0.985 } : {}}
      transition={{ delay: 0.07 * index, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="card-hover relative flex w-[260px] shrink-0 flex-col gap-3 overflow-hidden rounded-2xl border border-white/[0.08] p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 sm:w-[240px]"
      style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))" }}
    >
      {/* Animated decorative glow blob in the background */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl"
        style={{ background: "var(--accent-soft)" }}
        animate={{ opacity: [0.5, 0.8, 0.5], scale: [1, 1.1, 1] }}
        transition={{ duration: 4 + index * 0.4, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex items-center justify-between">
        <span className="accent-soft-bg accent-text rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider">
          {card.vibe}
        </span>
        {card.accessibility_ok && <Accessibility size={14} className="accent-text" />}
      </div>

      {/* Mystery illustration — emoji on a layered "puzzle" background */}
      <div className="relative flex h-28 items-center justify-center">
        <PuzzleArt index={index} />
        <motion.div
          className="relative z-10 text-5xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 3 + index * 0.3, repeat: Infinity, ease: "easeInOut" }}
        >
          {card.hint_emoji ?? "✦"}
        </motion.div>
      </div>

      <div className="relative min-h-[40px] text-[13px] leading-snug text-slate-300">
        {card.blurb}
      </div>
      <div className="relative flex items-center justify-between border-t border-white/[0.06] pt-3 text-[12px]">
        <div className="flex items-center gap-1 text-slate-400">
          <Sparkles size={12} className="accent-text" />
          <span className="font-semibold text-slate-100">
            {card.ai_value_score?.toFixed(1)}
          </span>
          <span>/ 10</span>
        </div>
        <div className="font-medium text-slate-300">₹{fmtINR(card.est_cost_inr)}</div>
      </div>
    </motion.button>
  );
}

// Decorative puzzle-shaped backdrop behind each mystery card emoji.
// Pure SVG, no images needed. Each card gets a slightly different rotation
// so the deck feels hand-laid.
function PuzzleArt({ index }) {
  const rot = (index * 7) - 12;
  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 m-auto h-24 w-24 opacity-25"
      style={{ transform: `rotate(${rot}deg)` }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`pa-${index}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {/* classic puzzle-piece silhouette */}
      <path
        fill={`url(#pa-${index})`}
        d="M20 30 h22 v-6 a8 8 0 1 1 16 0 v6 h22 v22 h6 a8 8 0 1 1 0 16 h-6 v22 h-22 v-6 a8 8 0 1 0 -16 0 v6 h-22 v-22 h-6 a8 8 0 1 0 0 -16 h6 z"
      />
    </svg>
  );
}


// =====================================================================
// ItineraryView — deep-dive panel with route picker + budget breakdown
// =====================================================================
function ItineraryView({ itinerary, deck, prefs, sessionId, onBack, onPickSimilar, onLocked }) {
  const p = itinerary.payload || {};
  const [locking, setLocking] = useState(false);
  const [locked, setLocked]   = useState(p.locked ?? false);
  const [tripId, setTripId]   = useState(null);
  const [shareCopied, setShareCopied] = useState(false);

  const card = useMemo(
    () => (deck?.payload?.cards ?? []).find((c) => c.id === p.card_id),
    [deck, p.card_id]
  );

  const totalEstimate = p.estimated_cost_inr ?? card?.est_cost_inr ?? 0;

  const { km, options: routeOpts } = useMemo(
    () => computeRoutes({
      origin: prefs.origin,
      destination: p.destination,
      mode: prefs.mode,
      totalBudget: prefs.budget_inr,
      partySize: prefs.party_size,
    }),
    [prefs.origin, p.destination, prefs.mode, prefs.budget_inr, prefs.party_size]
  );

  const recommendedIdx = Math.max(0, routeOpts.findIndex((r) => r.recommended));
  const [routeIdx, setRouteIdx] = useState(recommendedIdx);
  useEffect(() => { setRouteIdx(recommendedIdx); }, [recommendedIdx]);
  const route = routeOpts[routeIdx] ?? routeOpts[0];

  const totalRouteCost = (route?.cost_pp ?? 0) * (prefs.party_size ?? 1);

  // If a trip already exists for this session/card (locked previously), grab its
  // ID so the Share button works even after a page reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, status")
        .eq("session_id", sessionId)
        .eq("card_id", p.card_id)
        .eq("status", "locked")
        .maybeSingle();
      if (cancelled) return;
      if (data?.id) {
        setTripId(data.id);
        setLocked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, p.card_id]);

  // Breakdown reacts to selected route — transport row + percentages update live
  const breakdown = useMemo(
    () => computeBudgetBreakdown(totalEstimate, prefs.mode, totalRouteCost),
    [totalEstimate, prefs.mode, totalRouteCost]
  );

  const grandTotal = totalEstimate + totalRouteCost;
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(p.destination ?? "")}&output=embed`;

  const handleLock = async () => {
    setLocking(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      const r = await fetch("/api/trips/lock", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId,
          messageId: itinerary.parent_message_id,
          cardId: p.card_id,
        }),
      });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        setLocked(true);
        if (data?.tripId) setTripId(data.tripId);
        // Tell the parent so the sidebar shows the destination name immediately
        if (p.destination) onLocked?.(p.destination);
      }
    } finally { setLocking(false); }
  };

  const handleShare = async () => {
    if (!tripId) return;
    const url = `${window.location.origin}/trip/${tripId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${p.destination} trip on AuraGo`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2000);
      }
    } catch {
      // user cancelled share dialog or clipboard failed — try a textarea fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = url; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy");
        document.body.removeChild(ta);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2000);
      } catch {}
    }
  };

  return (
    <motion.section layout
      initial={{ opacity: 0, y: 16, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: 8, height: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong accent-border accent-glow mt-3 overflow-hidden rounded-2xl p-3 sm:p-6"
    >
      {/* header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs hover:bg-white/[0.08]">
          <ArrowLeft size={12} /> Back to options
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <MapPin size={14} className="accent-text" />
          <h3 className="serif text-xl sm:text-2xl">{p.destination}</h3>
          <span className="accent-soft-bg accent-text rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider">
            {p.vibe}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-300">
            {km} km from {prefs.origin}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {locked && tripId && (
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs hover:bg-white/[0.08]"
              title="Share this trip"
            >
              {shareCopied ? <Check size={12} className="accent-text" /> : <Share2 size={12} />}
              {shareCopied ? "Link copied" : "Share trip"}
            </button>
          )}
          <button
            onClick={handleLock}
            disabled={locked || locking}
            className={`accent-bg accent-glow flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60 ${locked ? "" : "pulse-ring"}`}
          >
            {locked ? <Lock size={12}/> : locking ? <Loader2 size={12} className="animate-spin"/> : <LockOpen size={12}/>}
            {locked ? "Locked" : locking ? "Locking…" : "Lock it in"}
          </button>
        </div>
      </div>

      {/* live verified */}
      {p.rag_verified && p.rag_summary && (
        <div className="accent-border mb-4 flex items-start gap-2 rounded-lg border bg-white/[0.025] p-3 text-[13px] text-slate-300">
          <ShieldCheck size={14} className="accent-text mt-0.5" />
          <div><span className="font-medium text-slate-100">Live verified · </span>{p.rag_summary}</div>
        </div>
      )}

      {/* hazard */}
      {p.hazard && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3 text-[13px] text-amber-100">
          <AlertTriangle size={14} className="mt-0.5 text-amber-300" />
          <div><span className="font-medium">Heads up · </span>{p.hazard}</div>
        </div>
      )}

      {/* WEATHER */}
      {p.weather && <WeatherCard weather={p.weather} travelDate={p.travel_date} />}

      {/* MAP */}
      <div className="mb-4 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400">
          <div className="flex items-center gap-1.5">
            <MapPin size={11} className="accent-text" />
            Map
          </div>
          <a
            href={`https://www.google.com/maps?q=${encodeURIComponent(p.destination ?? "")}`}
            target="_blank" rel="noreferrer"
            className="accent-text text-[11px] hover:underline"
          >
            Open in Google Maps ↗
          </a>
        </div>
        <iframe
          title={`Map of ${p.destination}`}
          src={mapSrc}
          className="h-56 w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      {/* PHOTOS */}
      {p.photos?.length > 0 && <PhotoGallery photos={p.photos} destination={p.destination} />}

      {/* ROUTE PICKER */}
      <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
            <Sparkles size={11} className="accent-text" />
            Route from {prefs.origin}
          </div>
          <div className="text-[11px] text-slate-500">{km} km · pick how to travel</div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {routeOpts.map((r, i) => (
            <button
              key={r.mode}
              onClick={() => setRouteIdx(i)}
              className={`route-pill ${i === routeIdx ? "active" : ""}`}
            >
              <span>{r.icon}</span>
              <span>{r.label}</span>
              <span className="text-slate-500">·</span>
              <span className="font-semibold">~ ₹{fmtINR(r.cost_pp)}/p</span>
              {r.recommended && <span className="accent-text ml-1 text-[9px] uppercase">★ Best</span>}
            </button>
          ))}
        </div>
        {route && (
          <div className="rounded-lg bg-white/[0.03] p-3 text-[13px]">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">{route.icon} {route.label}</span>
              <span className="text-right text-slate-400">
                {route.time} · approx ₹{fmtINR(totalRouteCost)} for {prefs.party_size}
              </span>
            </div>
            <p className="mb-2 text-[12px] text-slate-400">{route.via}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              {route.pros.map((s, i) => <span key={`p${i}`} className="text-emerald-300">✓ {s}</span>)}
              {route.cons.map((s, i) => <span key={`c${i}`} className="text-amber-300">⚠ {s}</span>)}
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              Prices are AuraGo estimates based on distance & class. Confirm the actual fare on the booking site below.
            </p>
          </div>
        )}
      </div>

      {/* BUDGET BREAKDOWN */}
      <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
            <Sparkles size={11} className="accent-text" />
            Where the ₹{fmtINR(grandTotal)} goes
          </div>
          <div className="text-[10px] text-slate-500">
            Updates with your route choice
          </div>
        </div>
        <div className="space-y-2">
          {breakdown.map((b) => (
            <div key={b.key}>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span>{b.icon} {b.label}</span>
                <span>
                  <span className="text-slate-400">{b.pct}%</span> ·{" "}
                  <span className="font-medium">₹{fmtINR(b.amount)}</span>
                </span>
              </div>
              <div className="progress">
                <div className="progress-fill" style={{ width: `${b.pct * 2.5}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DAY PLAN */}
      <div className="mb-5">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <Sparkles size={11} className="accent-text" />
          {(p.days ?? []).length}-day plan
        </div>
        <div className="grid gap-2">
          {(p.days ?? []).map((d) => (
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

      {/* ACCESSIBILITY NOTES */}
      {p.accessibility_notes?.length > 0 && (
        <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
            <Accessibility size={11} className="accent-text" />
            Smart access notes
          </div>
          <ul className="space-y-1 text-[13px] text-slate-200">
            {p.accessibility_notes.map((n, i) => <li key={i}>· {n}</li>)}
          </ul>
        </div>
      )}

      {/* STAYS */}
      {p.stays?.length > 0 && (
        <StaysSection
          stays={p.stays}
          nights={Math.max(1, (p.days?.length ?? prefs.days) - 1)}
          destination={p.destination}
          startDate={p.travel_date || prefs.start_date}
          partySize={prefs.party_size}
        />
      )}

      {/* PACKING */}
      {p.packing?.length > 0 && <PackingChecklist items={p.packing} stickyKey={p.card_id} />}

      {/* BOOKING LINKS */}
      <BookingLinks
        origin={prefs.origin}
        destination={p.destination}
        startDate={p.travel_date || prefs.start_date}
        partySize={prefs.party_size}
        mode={prefs.mode}
      />

      {/* SIMILAR DESTINATIONS */}
      {p.similar_destinations?.length > 0 && (
        <SimilarDestinations
          items={p.similar_destinations}
          onPick={(s) => onPickSimilar?.(s)}
        />
      )}

      {/* TOTALS */}
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-[13px] text-slate-400">
        <span>Stay + food + activities</span>
        <span>₹{fmtINR(totalEstimate)}</span>
      </div>
      <div className="flex items-center justify-between pt-1 text-[13px] text-slate-400">
        <span>Travel ({route?.label ?? "—"})</span>
        <span>₹{fmtINR(totalRouteCost)}</span>
      </div>
      <div className="accent-soft-bg mt-2 flex items-center justify-between rounded-lg p-3 text-sm">
        <span className="font-medium">Grand total</span>
        <span className="serif text-xl">₹{fmtINR(grandTotal)}</span>
      </div>
    </motion.section>
  );
}


// =====================================================================
// StaysSection — 4 stay options at different price points
// =====================================================================
function StaysSection({ stays, nights, destination, startDate, partySize }) {
  const safeNights = Math.max(1, nights || 1);
  const dateForUrl = startDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const checkout = new Date(new Date(dateForUrl).getTime() + safeNights * 86400000)
    .toISOString().slice(0, 10);
  const typeIconFor = (t) => {
    const x = (t ?? "").toLowerCase();
    if (x.includes("hostel")) return Building2;
    if (x.includes("homestay") || x.includes("villa")) return Hotel;
    return Hotel;
  };
  const bookUrlFor = (stayName) => {
    const q = encodeURIComponent(`${stayName ?? ""} ${destination ?? ""}`.trim());
    return `https://www.booking.com/searchresults.html?ss=${q}` +
      `&checkin=${dateForUrl}&checkout=${checkout}` +
      `&group_adults=${partySize ?? 2}`;
  };
  return (
    <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <Hotel size={11} className="accent-text" />
          Stay options · {safeNights} {safeNights === 1 ? "night" : "nights"}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {stays.map((s, i) => {
          const TypeIcon = typeIconFor(s.type);
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
              {s.blurb && (
                <p className="mb-2 line-clamp-2 text-[12.5px] text-slate-300">{s.blurb}</p>
              )}
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
                href={bookUrlFor(s.name)} target="_blank" rel="noreferrer"
                className="accent-bg accent-glow mt-2 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold text-slate-900 transition hover:scale-[1.02]"
              >
                Book on Booking.com ↗
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// SimilarDestinations — chip strip of alternative places to switch to
// =====================================================================
function SimilarDestinations({ items, onPick }) {
  if (!items?.length) return null;
  return (
    <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <Sparkles size={11} className="accent-text" />
          More like this
        </div>
        <div className="text-[10px] text-slate-500">tap to plan a new trip there</div>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {items.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick?.(s)}
            className="card-hover group flex w-[180px] shrink-0 flex-col gap-1 rounded-xl border border-white/[0.08] p-3 text-left transition"
            style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">{s.emoji ?? "✦"}</span>
              <span className="accent-text text-[11px] opacity-0 transition group-hover:opacity-100">→</span>
            </div>
            <div className="text-[13px] font-medium text-slate-100">{s.name}</div>
            <div className="line-clamp-2 text-[11px] text-slate-400">{s.tagline}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// PackingChecklist — local-only checked state, persisted by card_id
// =====================================================================
function PackingChecklist({ items, stickyKey }) {
  const storageKey = `aurago.packing.${stickyKey ?? "default"}`;
  const [checked, setChecked] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const toggle = (item) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item); else next.add(item);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const done = items.filter((i) => checked.has(i)).length;
  return (
    <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <CheckSquare size={11} className="accent-text" />
          Packing checklist
        </div>
        <div className="text-[11px] text-slate-500">{done} / {items.length} packed</div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {items.map((item, i) => {
          const isChecked = checked.has(item);
          const Box = isChecked ? CheckSquare : Square;
          return (
            <button
              key={i}
              onClick={() => toggle(item)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] transition ${
                isChecked
                  ? "accent-soft-bg accent-border text-slate-300 line-through"
                  : "border-white/[0.06] bg-white/[0.02] text-slate-200 hover:bg-white/[0.05]"
              }`}
            >
              <Box size={13} className={isChecked ? "accent-text" : "text-slate-400"} />
              <span className="flex-1">{item}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// BookingLinks — deeplinks to flights / trains / hotels
// =====================================================================
function BookingLinks({ origin, destination, startDate, partySize, mode }) {
  if (!destination) return null;
  const isSasta = mode === "sasta";
  const dateForUrl = startDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const enc = encodeURIComponent;
  const dest = enc(destination);
  const fromCity = enc(origin ?? "Delhi");

  // ---- Flights ----
  const flightLinks = [
    { name: "Skyscanner",  url: `https://www.skyscanner.co.in/transport/flights-from/${fromCity}/${dest}/?adults=${partySize ?? 1}&adultsv2=${partySize ?? 1}&cabinclass=economy` },
    { name: "Google Flights", url: `https://www.google.com/travel/flights?q=Flights+from+${fromCity}+to+${dest}+on+${dateForUrl}` },
    { name: "MakeMyTrip", url: `https://www.makemytrip.com/flight/search?itinerary=${fromCity}-${dest}-${dateForUrl.split("-").reverse().join("/")}&pax=${partySize ?? 1}-0-0&cabinClass=E` },
  ];

  // ---- Trains ----
  const trainLinks = [
    { name: "ConfirmTkt", url: `https://www.confirmtkt.com/rbooking-train-tickets-from-${fromCity}-to-${dest}.html` },
    { name: "IRCTC",      url: `https://www.irctc.co.in/nget/train-search` },
  ];

  // ---- Stays (different sites for sasta vs elite) ----
  const stayLinks = isSasta ? [
    { name: "Booking.com",   url: `https://www.booking.com/searchresults.html?ss=${dest}&checkin=${dateForUrl}&group_adults=${partySize ?? 2}` },
    { name: "OYO",           url: `https://www.oyorooms.com/search?location=${dest}&checkin=${dateForUrl}&guests=${partySize ?? 2}` },
    { name: "Hostelworld",   url: `https://www.hostelworld.com/search?search_keywords=${dest}&date_from=${dateForUrl}` },
    { name: "MakeMyTrip",    url: `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${dateForUrl}&city=${dest}&roomStayQualifier=${partySize ?? 2}e0e` },
  ] : [
    { name: "Booking.com",   url: `https://www.booking.com/searchresults.html?ss=${dest}&checkin=${dateForUrl}&group_adults=${partySize ?? 2}` },
    { name: "Marriott",      url: `https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=${dest}&fromDate=${dateForUrl}&numberOfAdults=${partySize ?? 2}` },
    { name: "Taj Hotels",    url: `https://www.tajhotels.com/en-in/search-hotels?location=${dest}` },
    { name: "Trivago",       url: `https://www.trivago.in/?aDateRange[arr]=${dateForUrl}&iRoomType=7&q=${dest}` },
  ];

  // ---- Cabs / cab-share ----
  const cabLinks = [
    { name: "Uber",       url: `https://m.uber.com/looking?drop[0]={"addr":"${enc(destination)}"}` },
    { name: "Ola",        url: `https://book.olacabs.com/` },
    { name: "InDrive",    url: `https://indrive.com/en-in/` },
    { name: "BlaBlaCar",  url: `https://www.blablacar.in/search?fn=${fromCity}&tn=${dest}&db=${dateForUrl}` },
  ];

  const Group = ({ Icon, title, links }) => (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
        <Icon size={11} className="accent-text" />
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <a
            key={l.name}
            href={l.url} target="_blank" rel="noreferrer"
            className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            {l.name} ↗
          </a>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <Sparkles size={11} className="accent-text" />
          Book it
        </div>
        <span className="text-[10px] text-slate-500">
          Prices below are <span className="text-slate-300">approx</span> · confirm on each site
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Group Icon={Plane} title="Flights" links={flightLinks} />
        <Group Icon={Train} title="Trains"  links={trainLinks} />
        <Group Icon={Hotel} title={isSasta ? "Budget stays" : "Premium stays"} links={stayLinks} />
        <Group Icon={Car}   title="Cabs / share rides" links={cabLinks} />
      </div>
    </div>
  );
}


// =====================================================================
// PhotoGallery — destination photos via Serper image search
// =====================================================================
function PhotoGallery({ photos, destination }) {
  const [openIdx, setOpenIdx] = useState(null);
  const [failed, setFailed]   = useState(() => new Set());

  const visible = photos.filter((_, i) => !failed.has(i));
  if (visible.length === 0) return null;

  const markFailed = (i) =>
    setFailed((s) => { const n = new Set(s); n.add(i); return n; });

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400">
        <div className="flex items-center gap-1.5">
          <ImageIcon size={11} className="accent-text" />
          Photos
        </div>
        <a
          href={`https://www.google.com/search?q=${encodeURIComponent(destination ?? "")}&tbm=isch`}
          target="_blank" rel="noreferrer"
          className="accent-text hover:underline"
        >
          More on Google ↗
        </a>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {photos.slice(0, 6).map((p, i) => (
          failed.has(i) ? null : (
            <motion.button
              key={i}
              onClick={() => setOpenIdx(i)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="group relative aspect-[4/3] overflow-hidden bg-white/[0.04]"
            >
              <img
                src={p.thumb || p.url}
                alt={p.alt || destination}
                loading="lazy"
                onError={() => markFailed(i)}
                className="h-full w-full object-cover transition group-hover:opacity-90"
              />
            </motion.button>
          )
        ))}
      </div>

      {/* Lightbox overlay */}
      <AnimatePresence>
        {openIdx !== null && photos[openIdx] && !failed.has(openIdx) && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpenIdx(null)}
          >
            <motion.img
              key={openIdx}
              src={photos[openIdx].url}
              alt={photos[openIdx].alt || destination}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="max-h-[85vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              onError={() => { markFailed(openIdx); setOpenIdx(null); }}
            />
            <button
              onClick={() => setOpenIdx(null)}
              aria-label="Close photo"
              className="fixed right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-900/80 text-slate-200 backdrop-blur"
            >
              <X size={18} />
            </button>
            {photos[openIdx].source && (
              <a
                href={photos[openIdx].source}
                target="_blank" rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur hover:bg-slate-900"
              >
                Open source ↗
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// =====================================================================
// WeatherCard
// =====================================================================
function weatherIconFor(feel) {
  const f = (feel ?? "").toLowerCase();
  if (f.includes("snow") || f.includes("cold")) return Snowflake;
  if (f.includes("rain")) return CloudRain;
  if (f.includes("hot") || f.includes("warm")) return Sun;
  if (f.includes("humid") || f.includes("cloud")) return Cloud;
  if (f.includes("cool")) return CloudSun;
  return Thermometer;
}

function WeatherCard({ weather, travelDate }) {
  const Icon = weatherIconFor(weather.feel);
  return (
    <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400">
        <div className="flex items-center gap-1.5">
          <Icon size={11} className="accent-text" />
          Weather · {weather.feel ?? "expected"}
        </div>
        {travelDate && <span className="text-slate-500">{travelDate}</span>}
      </div>
      <div className="flex items-start gap-3">
        <div className="accent-soft-bg accent-text grid h-12 w-12 shrink-0 place-items-center rounded-xl">
          <Icon size={22} />
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-medium text-slate-100">
            {weather.summary}
          </div>
          {weather.temp_c && (
            <div className="text-[12px] text-slate-400">{weather.temp_c}</div>
          )}
          {weather.advice && (
            <div className="mt-1 text-[12.5px] text-slate-300">
              <span className="accent-text font-medium">Tip · </span>{weather.advice}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
