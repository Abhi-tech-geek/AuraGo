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
  Mountain, Waves, TreePine, Droplets, Castle, Church, PawPrint, Compass,
  UserPlus, Users, ExternalLink, Map as MapIcon,
  Wand2, CloudDrizzle, BarChart3, MessageSquare, Tag, RefreshCw, Trash2,
  ArrowRight,
} from "lucide-react";

// Auth helper used by the new endpoints — pulls the bearer once.
async function authedFetch(url, opts = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
    credentials: "include",
  });
}

import { supabase } from "./supabaseClient";
import BudgetModal from "./BudgetModal";
import ConciergeChat from "./ConciergeChat";
import { citiesFor } from "./lib/cities";
import { PLACE_TEASERS, VIBE_TEASERS } from "./lib/teasers";
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
  const [chatOpen, setChatOpen]   = useState(false);
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
      // Poll votes mutate messages.payload — sync those updates so every
      // member sees the bar chart move live.
      .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages",
            filter: `session_id=eq.${sessionId}` },
          (p) => setMessages((prev) =>
            prev.map((x) => x.id === p.new.id ? { ...x, ...p.new } : x)))
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
  // `intentOverride` short-circuits the backend's Groq-based intent parser
  // when the prompt was synthesized from the BudgetModal (we already know
  // the structured values). Saves ~1-2s per turn.
  const sendTurn = useCallback(async (text, intentOverride) => {
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
        body: JSON.stringify({
          sessionId, prompt: text,
          ...(intentOverride ? { intent: intentOverride } : {}),
        }),
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
            days: effective.days,
            origin: effective.origin,
            universal_access: effective.universal_access,
            country: effective.country,
            has_passport: effective.has_passport,
            route_stops: Array.isArray(effective.route_stops) ? effective.route_stops : [],
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
    const stops = Array.isArray(next.route_stops)
      ? next.route_stops.filter(Boolean)
      : [];
    // The modal can now carry a destination too (I-know-where mode). It
    // takes precedence over the older composer-driven pendingDestination
    // path, but we still honour pendingDestination as a fallback.
    const modalDest = (next.destination || "").trim();
    const dest = modalDest || pendingDestination;
    if (dest) {
      setPendingDestination(null);
      sendDirect(dest, next);
    } else if (stops.length >= 2) {
      // Multi-stop: skip the mystery deck entirely — there's nothing to "pick"
      // because the user already told us the route. Build a chained itinerary.
      const joined = stops.join(" · ");
      sendDirect(joined, next);
    } else {
      // Fast-path: hand the structured intent to the backend so it can skip
      // the Groq parseIntent round-trip (~1-2s saved per turn).
      sendTurn(promptFromPrefs(next), {
        mode: next.mode,
        budget_inr: next.budget_inr,
        party_size: next.party_size,
        days: next.days,
        origin: next.origin,
        universal_access: next.universal_access,
        country: next.country,
        has_passport: next.has_passport,
      });
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
          {/* Sidebar toggle. Always visible on mobile (the sidebar overlay
              uses its own state). On desktop it hides when the sidebar is
              already pinned open — in that case the PanelLeftClose icon
              inside the sidebar header handles collapsing. */}
          <motion.button
            onClick={onToggleSidebar ?? onOpenSidebar}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 16 }}
            className={`group relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-200 transition hover:border-[var(--accent)]/40 hover:bg-white/[0.08] hover:text-[var(--accent)] hover:shadow-[0_0_0_3px_var(--ring)] ${sidebarPinned ? "md:hidden" : ""}`}
            aria-label="Show trips"
            title="Show trip list"
          >
            <Menu size={17} />
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
              <Welcome
                loadError={loadError}
                prefs={prefs}
                currentUser={currentUser}
                composerMode={composerMode}
                onOpenModal={() => setModalOpen(true)}
                onPickDestination={(name) => { setPendingDestination(name); setModalOpen(true); }}
                onChipFill={(text) => setInput(text)}
              />
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
                            onOpenChat={() => setChatOpen(true)}
                          />
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                }
                if (m.kind === "itinerary") return null;
                if (m.kind === "qa_notice") return <QANotice key={m.id} message={m} />;
                if (m.kind === "lock_event") return <LockChip key={m.id} message={m} />;
                if (m.kind === "poll") return <PollCard key={m.id} message={m} currentUserId={currentUser.id} />;
                if (m.kind === "chat") return null; // chat lives in the drawer, not the main feed
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
          {composerMode === "direct" ? (
            <>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSendInput(); } }}
                placeholder="Type a destination, e.g. Goa or Manali"
                list="aura-cities-composer"
                autoComplete="off"
                className="accent-ring flex-1 rounded-lg bg-transparent px-3 py-2.5 text-[15px] placeholder:text-slate-500 focus:outline-none"
              />
              <datalist id="aura-cities-composer">
                {citiesFor(prefs.country).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          ) : (
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault(); handleSendInput();
                }
              }}
              placeholder="Describe your dream trip… (or pick 'I know where' above)"
              rows={1}
              className="accent-ring max-h-40 flex-1 resize-none rounded-lg bg-transparent px-3 py-2.5 text-[15px] placeholder:text-slate-500 focus:outline-none"
            />
          )}
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
        composerMode={composerMode}
        onClose={() => { setModalOpen(false); setPendingDestination(null); }}
        onSubmit={handleModalSubmit}
      />

      <ConciergeChat context={openItineraryContext(messages, openCard)} />

      {/* Side-thread chat between trip members (kind=chat messages) */}
      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        sessionId={sessionId}
        messages={messages}
        currentUserId={currentUser.id}
      />

      {/* Floating "trip chat" toggle — sits ABOVE the concierge bubble
          with a deliberate gap so the two never overlap on small screens.
          Hidden until there's an itinerary so the welcome stays clean. */}
      <AnimatePresence>
        {messages.some((m) => m.kind === "itinerary" || m.kind === "lock_event") && (
          <motion.button
            key="chat-fab"
            initial={{ opacity: 0, scale: 0.5, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 20 }}
            transition={{ type: "spring", stiffness: 360, damping: 22 }}
            onClick={() => setChatOpen(true)}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            // Stack: concierge sits at bottom-6.5rem; we add 4.25rem so this
            // button sits above it with a small gap. Right edge aligns with
            // both buttons.
            style={{ bottom: "calc(10.75rem + env(safe-area-inset-bottom))" }}
            className="glass fixed right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-white/[0.08] sm:right-6"
            title="Trip chat"
            aria-label="Open trip chat"
          >
            <MessageSquare size={18} className="accent-text" />
            {messages.filter((m) => m.kind === "chat").length > 0 && (
              <span className="accent-bg absolute -top-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full px-1 text-[9px] font-bold text-slate-900">
                {messages.filter((m) => m.kind === "chat").length}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
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

function Welcome({ loadError, prefs, currentUser, composerMode, onOpenModal, onPickDestination, onChipFill }) {
  const surprise = composerMode !== "direct";

  // Greeting tuned to local time of day.
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = (currentUser?.email?.split("@")[0]) || "traveller";

  // We render the rail twice (the marquee uses translateX(-50%) for a
  // seamless infinite loop), but only the first half is interactive.
  const placeRail = [...PLACE_TEASERS, ...PLACE_TEASERS];
  const vibeRail  = [...VIBE_TEASERS, ...VIBE_TEASERS];

  return (
    <div className="home fade">
      {/* HERO */}
      <div className="home-hero">
        <div className="home-greet mono">
          <span className="home-live" /> {greet.toUpperCase()}, {name.toUpperCase()}
        </div>
        <h1 className="home-h">
          Go where the<br />
          <span className="serif-i accent">crowd isn't.</span>
        </h1>
        <p className="home-sub">
          {surprise
            ? "Describe a vibe and a budget below — AuraGo hands you eight verified places you've never heard of, each with a full plan."
            : "Name a place below and AuraGo builds the full itinerary — plus four similar hidden gems nearby."}
        </p>
      </div>

      {/* LIVE RAIL — mode-aware (vibes for surprise, places for know) */}
      <div className="home-railwrap">
        <div className="home-raillabel mono">
          <span className="home-led" />
          {surprise ? "TRY A VIBE · TAP TO FILL" : "NOW DEPARTING · TAP TO PLAN"}
        </div>
        <div className="home-rail-mask">
          {surprise ? (
            <div className="home-rail">
              {vibeRail.map((v, i) => (
                <button
                  key={`v${i}`}
                  className="teaser vibe lift"
                  onClick={() => onChipFill?.(v.prompt)}
                  tabIndex={i < VIBE_TEASERS.length ? 0 : -1}
                  aria-hidden={i >= VIBE_TEASERS.length}
                >
                  <span className="teaser-ico"><Sparkles size={15} /></span>
                  <div className="vibe-name serif">{v.title}</div>
                  <div className="teaser-tag">{v.tag}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="home-rail">
              {placeRail.map((t, i) => (
                <button
                  key={`p${i}`}
                  className="teaser lift"
                  onClick={() => onPickDestination?.(t.name)}
                  tabIndex={i < PLACE_TEASERS.length ? 0 : -1}
                  aria-hidden={i >= PLACE_TEASERS.length}
                >
                  <div className="teaser-top">
                    <span className="teaser-ico"><MapPin size={15} /></span>
                    <span className="teaser-score mono">{t.score.toFixed(1)}</span>
                  </div>
                  <div className="teaser-name display">{t.name}</div>
                  <div className="teaser-region mono">{t.region}</div>
                  <div className="teaser-tag">{t.tag}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loadError && (
        <p className="text-[12.5px]" style={{ color: "#fbbf24" }}>{loadError}</p>
      )}

      <div className="home-hint mono">
        ↓ Use the bar below to {surprise ? "describe your trip" : "name a destination"}
      </div>

      {/* Single canonical CTA — back-compat with the "Start a trip" pattern */}
      <button
        onClick={onOpenModal}
        className="btn btn-primary btn-cta"
        style={{ alignSelf: "flex-start", marginTop: 4 }}
      >
        Start a trip <ArrowRight size={14} />
      </button>
    </div>
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
// ---------- Mystery deck → split-flap departures board ----------
// Each card renders as a row in a board frame. The hint_category gets
// scrambled into target letters using FlapTile components for the
// classic Solari-board animation. Rows reveal one-by-one on mount.
const FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function MysteryDeck({ message, prefs, dimmed, onCardOpen }) {
  const cards = message.payload?.cards ?? [];
  const [revealed, setRevealed] = useState(0);

  // Stagger the row reveal — every 230ms one more row "settles".
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      n += 1; setRevealed(n);
      if (n >= cards.length) clearInterval(t);
    }, 230);
    return () => clearInterval(t);
  }, [cards.length]);

  const allRevealed = revealed >= cards.length;

  return (
    <motion.div layout
      animate={{ opacity: dimmed ? 0.3 : 1, scale: dimmed ? 0.985 : 1 }}
      transition={{ duration: 0.25 }}
      className={`board glass-strong hud rise ${dimmed ? "pointer-events-none" : ""}`}
    >
      <div className="board-top">
        <div className="board-id mono">
          <span className="board-led" /> AURAGO&nbsp;&nbsp;DEPARTURES
        </div>
        <div className="board-clock mono">
          {allRevealed
            ? `${cards.length} GEMS · LIVE-CHECKED`
            : "UPDATING…"}
        </div>
      </div>

      {message.payload?.intro && (
        <p className="mt-3 text-[13.5px] leading-relaxed text-[color:var(--ink-soft)]">
          {message.payload.intro}
        </p>
      )}

      <div className="board-colhead mono">
        <span>#</span>
        <span>Hidden gem</span>
        <span className="hide-sm">Vibe</span>
        <span className="ta-c">AI</span>
        <span className="hide-xs ta-r">From</span>
        <span />
      </div>

      <div className="board-rows">
        {cards.map((c, i) => (
          <BoardRow
            key={c.id}
            card={c}
            ord={i + 1}
            active={i < revealed}
            onOpen={() => onCardOpen(c)}
          />
        ))}
      </div>

      <div className="board-foot">
        <span className="mono">▸ TAP A ROW TO FLIP OPEN THE FULL PLAN</span>
        <span className="board-foot-r mono hide-sm">
          FROM {prefs.origin?.toUpperCase() || "—"} ·
          ₹{fmtINR(prefs.budget_inr)} ·
          {" "}{prefs.days} {prefs.days === 1 ? "DAY" : "DAYS"}
        </span>
      </div>
    </motion.div>
  );
}

// Single flap tile that scrambles toward its target char on activation.
function FlapTile({ target, start }) {
  const [ch, setCh] = useState(" ");
  useEffect(() => {
    if (!start) { setCh(" "); return; }
    const tgt = (target || " ").toUpperCase();
    if (tgt === " ") { setCh(" "); return; }
    let cur = Math.floor(Math.random() * 12) + 4; // scramble steps
    const t = setInterval(() => {
      cur -= 1;
      setCh((prev) => {
        if (cur <= 0) { clearInterval(t); return tgt; }
        const ci = Math.max(0, FLAP_CHARS.indexOf(prev));
        return FLAP_CHARS[(ci + 1) % FLAP_CHARS.length];
      });
    }, 55);
    return () => clearInterval(t);
  }, [start, target]);
  return <span className={"flap2" + (ch === " " ? " blank" : "")}>{ch === " " ? " " : ch}</span>;
}

function BoardRow({ card, ord, active, onOpen }) {
  const ordStr = String(ord).padStart(2, "0");
  // Use hint_category as the "mystery" label rendered through flap tiles.
  // Pad to 9 chars so every row aligns; tiles auto-blank on spaces.
  const category = (card.hint_category || "MYSTERY").toUpperCase();
  const letters = category.padEnd(9, " ").slice(0, 9).split("");

  return (
    <button
      className={"brow" + (active ? " on" : "")}
      onClick={onOpen}
    >
      <span className="brow-ord">{ordStr}</span>
      <span className="brow-name">
        <span className="flaps">
          {letters.map((ch, i) => <FlapTile key={i} target={ch} start={active} />)}
          {card.accessibility_ok && (
            <span className="brow-acc" title="Step-free access">
              <Accessibility size={12} />
            </span>
          )}
        </span>
        <span className="brow-blurb">{card.blurb}</span>
      </span>
      <span className="brow-vibe mono hide-sm">{card.vibe}</span>
      <span className="brow-score display">{(card.ai_value_score ?? 0).toFixed(1)}</span>
      <span className="brow-cost mono hide-xs">~₹{fmtINR(card.est_cost_inr)}</span>
      <span className="brow-go">
        <span className="mono">BOARD</span>
        <ChevronRight size={14} />
      </span>
    </button>
  );
}


// =====================================================================
// SectionTitle — small heading row used throughout the itinerary
// =====================================================================
function SectionTitle({ icon, title, sub }) {
  return (
    <div className="sec-title">
      {icon}
      <h3 className="serif">{title}</h3>
      {sub && <span className="trip-sub">{sub}</span>}
    </div>
  );
}

// =====================================================================
// HudMap — fake-HUD route visualisation. Pure SVG, no API key needed.
// Stops 1..4 are positioned on preset lattice points. The final stop
// gets the bright "dest" treatment.
// =====================================================================
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
        <div className={"hudpin" + (i === pts.length - 1 ? " dest" : "")}
             style={{ left: p.x + "%", top: p.y + "%" }} key={i}>
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


// =====================================================================
// ItineraryView — deep-dive panel with route picker + budget breakdown
// =====================================================================
function ItineraryView({ itinerary, deck, prefs, sessionId, onBack, onPickSimilar, onLocked, onOpenChat }) {
  const p = itinerary.payload || {};
  const [locking, setLocking] = useState(false);
  const [locked, setLocked]   = useState(p.locked ?? false);
  const [tripId, setTripId]   = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [refining, setRefining] = useState(false);
  const [replanBusy, setReplanBusy] = useState(false);
  const [replanMsg, setReplanMsg] = useState(null);

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
      payloadKm: p.est_distance_km,
    }),
    [prefs.origin, p.destination, prefs.mode, prefs.budget_inr, prefs.party_size, p.est_distance_km]
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

  // Fetch member count for the "N joined" pill. Re-runs when sessionId changes.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getSession();
        const token = authData?.session?.access_token;
        const r = await fetch(`/api/sessions/${sessionId}/participants`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include",
        });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setMemberCount(data?.count ?? 0);
      } catch { /* silent — UX nicety only */ }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleInvite = async () => {
    const url = `${window.location.origin}/i/${sessionId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Plan ${p.destination ?? "this trip"} with me on AuraGo`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setInviteCopied(true);
        window.setTimeout(() => setInviteCopied(false), 2000);
      }
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url; document.body.appendChild(ta);
        ta.select(); document.execCommand("copy");
        document.body.removeChild(ta);
        setInviteCopied(true);
        window.setTimeout(() => setInviteCopied(false), 2000);
      } catch {}
    }
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

  // Boarding-pass booking code — first 3 letters of destination + day count.
  const passCode = "AG-" + (p.destination || "").replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() + "-" + (p.days?.length ?? prefs.days ?? 0) + "D";
  const routeStopsForMap = (Array.isArray(p.route_stops) && p.route_stops.length >= 2)
    ? p.route_stops
    : [prefs.origin || "Origin", p.destination || "Destination"];

  return (
    <motion.section layout
      initial={{ opacity: 0, y: 16, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: 8, height: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="itin glass-strong rise mt-3"
    >
      {/* ============ TOP BAR ============ */}
      <div className="itin-head">
        <button onClick={onBack} className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Board
        </button>
        <div className="itin-actions">
          {memberCount > 1 && (
            <span className="pill" title={`${memberCount} people on this trip`}>
              <Users size={12} className="accent-text" /> {memberCount}
            </span>
          )}
          <button onClick={handleInvite} className="btn btn-ghost btn-sm" title="Invite friends to plan together">
            {inviteCopied ? <Check size={13} className="accent-text" /> : <UserPlus size={13} />}
            {inviteCopied ? "Copied" : "Invite"}
          </button>
          <CreatePoll sessionId={sessionId} />
          <button onClick={onOpenChat} className="btn btn-ghost btn-sm" title="Open trip chat">
            <MessageSquare size={13} className="accent-text" /> Chat
          </button>
          {locked && tripId && (
            <button onClick={handleShare} className="btn btn-ghost btn-sm" title="Share this trip">
              {shareCopied ? <Check size={13} className="accent-text" /> : <Share2 size={13} />}
              {shareCopied ? "Link copied" : "Share"}
            </button>
          )}
          <button
            onClick={handleLock}
            disabled={locked || locking}
            className={`btn btn-primary btn-sm btn-cta ${locked ? "" : "pulse-ring"}`}
          >
            {locked ? <Lock size={13}/> : locking ? <Loader2 size={13} className="animate-spin"/> : <LockOpen size={13}/>}
            {locked ? "Locked" : locking ? "Locking…" : "Lock it in"}
          </button>
        </div>
      </div>

      {/* ============ BOARDING PASS ============ */}
      <div className="pass hud">
        <div className="pass-l">
          <span className="pill-accent">{p.vibe}</span>
          <h2 className="serif-i itin-title">{p.destination}</h2>
          <div className="itin-meta">
            <span>{(prefs.country || "").toUpperCase()}</span>
            <span className="dot">/</span>
            <span>{Number(km).toLocaleString("en-IN")} KM FROM {(prefs.origin || "ORIGIN").toUpperCase()}</span>
            {p.travel_date && (<>
              <span className="dot">/</span>
              <span>{new Date(p.travel_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}</span>
            </>)}
          </div>
        </div>
        <div className="pass-stub">
          <div className="stub-row">
            <span className="stub-k">BOOKING</span>
            <span className="stub-v">{passCode}</span>
          </div>
          <div className="stub-row">
            <span className="stub-k">DAYS</span>
            <span className="stub-big">{p.days?.length ?? prefs.days ?? 0}</span>
          </div>
          <div className="stub-barcode" />
        </div>
      </div>

      {/* ============ HUD ROUTE MAP ============ */}
      <HudMap stops={routeStopsForMap} dest={p.destination} mapsHref={`https://www.google.com/maps?q=${encodeURIComponent(p.destination ?? "")}`} />

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

      {/* Re-plan around live weather — fetches Serper forecast snippets and
          asks the refine endpoint to swap rainy-day activities for indoor. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <motion.button
          onClick={async () => {
            if (replanBusy) return;
            setReplanBusy(true); setReplanMsg(null);
            try {
              const r = await authedFetch("/api/chat/replan-weather", {
                method: "POST",
                body: JSON.stringify({ sessionId, itineraryMessageId: itinerary.id }),
              });
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j?.error || "replan failed");
              setReplanMsg(j.changed ? "New itinerary created below ⤵" : (j.reason || "Weather looks fine — no changes."));
            } catch (e) {
              setReplanMsg(`Couldn't check: ${e.message}`);
            } finally {
              setReplanBusy(false);
            }
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          disabled={replanBusy}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] hover:bg-white/[0.08] disabled:opacity-50"
        >
          {replanBusy
            ? <Loader2 size={12} className="animate-spin accent-text" />
            : <CloudDrizzle size={12} className="accent-text" />}
          {replanBusy ? "Checking forecast…" : "Re-plan around weather"}
        </motion.button>
        {replanMsg && <span className="text-[11px] text-slate-400">{replanMsg}</span>}
      </div>

      {/* Live price snapshot — flight / train / hotel ranges via Serper */}
      <PriceCard
        origin={prefs.origin}
        destination={p.destination}
        date={p.travel_date || prefs.start_date}
      />

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

      {/* DAY PLAN — vertical timeline */}
      <SectionTitle icon={<Sparkles size={14} className="accent-text" />}
        title={`${(p.days ?? []).length}-day plan`}
        sub="tap any activity → maps" />
      <div className="timeline">
        {(p.days ?? []).map((d) => {
          const acts = (d.activities ?? d.acts ?? []).filter(Boolean);
          const dayRouteUrl = (() => {
            if (!p.destination || acts.length === 0) return null;
            const origin = encodeURIComponent(p.destination);
            if (acts.length === 1) {
              const dest = encodeURIComponent(`${acts[0]}, ${p.destination}`);
              return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}`;
            }
            const dest = encodeURIComponent(`${acts[acts.length - 1]}, ${p.destination}`);
            const waypoints = acts.slice(0, -1).map((a) => `${a}, ${p.destination}`).join("|");
            return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${encodeURIComponent(waypoints)}`;
          })();
          return (
            <div className="tl-day" key={d.day}>
              <div className="tl-rail">
                <span className="tl-node display">{d.day}</span>
              </div>
              <div className="tl-body">
                <div className="tl-head">
                  <span className="tl-daylabel mono">DAY {String(d.day).padStart(2, "0")}</span>
                  <h4 className="serif tl-title">{d.title}</h4>
                  <div className="day-tools">
                    <button
                      onClick={async () => {
                        if (refining || locked) return;
                        setRefining(true);
                        try {
                          await authedFetch("/api/chat/refine", {
                            method: "POST",
                            body: JSON.stringify({
                              sessionId, itineraryMessageId: itinerary.id,
                              instruction: `Regenerate Day ${d.day} activities only. Keep same destination, same vibe, same number of days, same stays. Give fresh activity ideas.`,
                            }),
                          });
                        } catch (e) { console.warn("shuffle failed", e); }
                        finally { setRefining(false); }
                      }}
                      disabled={refining || locked}
                      className="btn-icon" style={{ width: 32, height: 32 }}
                      title={locked ? "Locked — unlock to change" : "Shuffle this day's activities"}
                      aria-label="Shuffle activities"
                    >
                      <RefreshCw size={14} className={refining ? "animate-spin" : ""} />
                    </button>
                    {dayRouteUrl && (
                      <a href={dayRouteUrl} target="_blank" rel="noreferrer"
                         className="btn-icon" style={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                         title="Open day route in Maps" aria-label="Day route">
                        <MapIcon size={14} />
                      </a>
                    )}
                  </div>
                </div>
                <ul className="tl-acts">
                  {acts.map((a, i) => {
                    const q = encodeURIComponent(`${a} ${p.destination ?? ""}`.trim());
                    return (
                      <li key={i}>
                        <a href={`https://www.google.com/maps/search/?api=1&query=${q}`}
                           target="_blank" rel="noreferrer"
                           title="Find on Google Maps">
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
        homeCountry={prefs.country}
      />

      {/* LOCAL GUIDES — deep links to real marketplaces, no fake verification */}
      <LocalGuides destination={p.destination} />

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

      {/* Conversational refinement — chips + free-text */}
      <RefineComposer
        sessionId={sessionId}
        itineraryMessageId={itinerary.id}
        onRefining={setRefining}
        disabled={locked}
      />
      {refining && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-slate-400">
          <Loader2 size={12} className="animate-spin accent-text" />
          Rewriting the plan…
        </div>
      )}
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
// LocalGuides — deep links to legit guide marketplaces for the destination.
// =====================================================================
// We don't run our own guide platform yet, so AuraGo doesn't claim to
// "verify" anyone. Instead this surfaces external marketplaces where
// users can find rated guides (each platform has its own review system).
function LocalGuides({ destination }) {
  if (!destination) return null;
  const q = encodeURIComponent(destination);
  const links = [
    { name: "GetYourGuide", tag: "Top tours + activities",
      url: `https://www.getyourguide.com/s/?q=${q}` },
    { name: "Viator",        tag: "Day trips + experiences",
      url: `https://www.viator.com/search/${q}` },
    { name: "Airbnb Experiences", tag: "Hosted by locals",
      url: `https://www.airbnb.com/s/${q}/experiences` },
    { name: "Withlocals",    tag: "Small-group local guides",
      url: `https://www.withlocals.com/search/?query=${q}` },
    { name: "TripAdvisor",   tag: "Reviews + tours",
      url: `https://www.tripadvisor.com/Search?q=${q}+tour+guide` },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.3 }}
      className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <Users size={11} className="accent-text" />
          Local guides
        </div>
        <span className="text-[10px] text-slate-500">External marketplaces · check reviews</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {links.map((l) => (
          <motion.a
            key={l.name}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 320, damping: 20 }}
            className="group flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/20 hover:bg-white/[0.05]"
          >
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate-100">{l.name}</div>
              <div className="truncate text-[11px] text-slate-400">{l.tag}</div>
            </div>
            <ExternalLink size={13} className="accent-text shrink-0 transition group-hover:translate-x-0.5" />
          </motion.a>
        ))}
      </div>
    </motion.div>
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
function BookingLinks({ origin, destination, startDate, partySize, mode, homeCountry }) {
  if (!destination) return null;
  const isSasta = mode === "sasta";
  const dateForUrl = startDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const enc = encodeURIComponent;
  const dest = enc(destination);
  const fromCity = enc(origin ?? "Delhi");

  // Destination is "domestic" if the home country name appears in the string.
  // (LLM is instructed to format names as "City, Region, Country".)
  const home = (homeCountry ?? "India").toLowerCase();
  const isIndia = home === "india";
  const isDomestic =
    !!destination &&
    destination.toLowerCase().includes(home);
  const showTrains = isDomestic && isIndia;
  const showIndiaOnlySites = isDomestic && isIndia;

  // ---- Flights ----
  const flightLinks = [
    { name: "Skyscanner",  url: `https://www.skyscanner.net/transport/flights-from/${fromCity}/${dest}/?adults=${partySize ?? 1}&adultsv2=${partySize ?? 1}&cabinclass=economy` },
    { name: "Google Flights", url: `https://www.google.com/travel/flights?q=Flights+from+${fromCity}+to+${dest}+on+${dateForUrl}` },
    { name: "Kayak",        url: `https://www.kayak.com/flights/${fromCity}-${dest}/${dateForUrl}?sort=bestflight_a` },
    ...(showIndiaOnlySites ? [{
      name: "MakeMyTrip",
      url: `https://www.makemytrip.com/flight/search?itinerary=${fromCity}-${dest}-${dateForUrl.split("-").reverse().join("/")}&pax=${partySize ?? 1}-0-0&cabinClass=E`,
    }] : []),
  ];

  // ---- Trains (India only — most regions don't have a comparable system) ----
  const trainLinks = showTrains ? [
    { name: "ConfirmTkt", url: `https://www.confirmtkt.com/rbooking-train-tickets-from-${fromCity}-to-${dest}.html` },
    { name: "IRCTC",      url: `https://www.irctc.co.in/nget/train-search` },
  ] : null;

  // ---- Stays (different sites for sasta vs elite, and global vs India) ----
  const globalStays = isSasta ? [
    { name: "Booking.com",   url: `https://www.booking.com/searchresults.html?ss=${dest}&checkin=${dateForUrl}&group_adults=${partySize ?? 2}` },
    { name: "Hostelworld",   url: `https://www.hostelworld.com/search?search_keywords=${dest}&date_from=${dateForUrl}` },
    { name: "Airbnb",        url: `https://www.airbnb.com/s/${dest}/homes?adults=${partySize ?? 2}&checkin=${dateForUrl}` },
    { name: "Agoda",         url: `https://www.agoda.com/search?city=${dest}&checkIn=${dateForUrl}&rooms=1&adults=${partySize ?? 2}` },
  ] : [
    { name: "Booking.com",   url: `https://www.booking.com/searchresults.html?ss=${dest}&checkin=${dateForUrl}&group_adults=${partySize ?? 2}` },
    { name: "Airbnb Luxe",   url: `https://www.airbnb.com/luxury/search?location=${dest}&adults=${partySize ?? 2}` },
    { name: "Marriott",      url: `https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=${dest}&fromDate=${dateForUrl}&numberOfAdults=${partySize ?? 2}` },
    { name: "Trivago",       url: `https://www.trivago.com/?q=${dest}&aDateRange[arr]=${dateForUrl}` },
  ];

  const indiaExtraStays = showIndiaOnlySites
    ? (isSasta
        ? [{ name: "OYO", url: `https://www.oyorooms.com/search?location=${dest}&checkin=${dateForUrl}&guests=${partySize ?? 2}` },
           { name: "MakeMyTrip", url: `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${dateForUrl}&city=${dest}&roomStayQualifier=${partySize ?? 2}e0e` }]
        : [{ name: "Taj Hotels", url: `https://www.tajhotels.com/en-in/search-hotels?location=${dest}` }])
    : [];

  const stayLinks = [...globalStays, ...indiaExtraStays];

  // ---- Cabs / cab-share (region-aware) ----
  const cabLinks = showIndiaOnlySites ? [
    { name: "Uber",       url: `https://m.uber.com/looking?drop[0]={"addr":"${enc(destination)}"}` },
    { name: "Ola",        url: `https://book.olacabs.com/` },
    { name: "InDrive",    url: `https://indrive.com/en-in/` },
    { name: "BlaBlaCar",  url: `https://www.blablacar.in/search?fn=${fromCity}&tn=${dest}&db=${dateForUrl}` },
  ] : [
    { name: "Uber",       url: `https://m.uber.com/looking?drop[0]={"addr":"${enc(destination)}"}` },
    { name: "Bolt",       url: `https://bolt.eu/` },
    { name: "Lyft",       url: `https://www.lyft.com/` },
    { name: "Local taxis", url: `https://www.google.com/search?q=taxi+in+${dest}` },
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
        {trainLinks && <Group Icon={Train} title="Trains"  links={trainLinks} />}
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


// =====================================================================
// PollCard — renders kind=poll messages with live vote bars
// =====================================================================
function PollCard({ message, currentUserId }) {
  const payload = message.payload ?? {};
  const options = payload.options ?? [];
  const votes = payload.votes ?? {};
  const totalVotes = Object.keys(votes).length;
  const myVote = votes[currentUserId] ?? null;
  const [voting, setVoting] = useState(null);

  const counts = options.map((o) => ({
    ...o,
    n: Object.values(votes).filter((v) => v === o.id).length,
  }));
  const max = Math.max(1, ...counts.map((c) => c.n));

  const cast = async (optionId) => {
    if (voting) return;
    setVoting(optionId);
    try {
      await authedFetch("/api/polls/vote", {
        method: "POST",
        body: JSON.stringify({ messageId: message.id, optionId }),
      });
    } catch (e) {
      console.error("vote failed", e);
    } finally {
      setVoting(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl border border-white/[0.08] p-4"
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
        <BarChart3 size={12} className="accent-text" />
        Poll · {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
      </div>
      <div className="mb-3 text-[15px] font-medium text-slate-100">{payload.question}</div>
      <div className="space-y-2">
        {counts.map((o) => {
          const pct = totalVotes === 0 ? 0 : Math.round((o.n / totalVotes) * 100);
          const isMine = myVote === o.id;
          return (
            <button
              key={o.id}
              onClick={() => cast(o.id)}
              disabled={!!voting}
              className="group relative w-full overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[13.5px] transition hover:border-white/20 disabled:cursor-wait"
            >
              {/* fill bar */}
              <motion.div
                aria-hidden="true"
                className="accent-soft-bg absolute inset-y-0 left-0 z-0 rounded-xl"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 90, damping: 18 }}
              />
              <div className="relative z-10 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {isMine && <Check size={12} className="accent-text" />}
                  <span className={isMine ? "accent-text font-semibold" : ""}>{o.text}</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  {o.n} · {pct}%
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}


// =====================================================================
// CreatePoll — modal launcher for adding a poll to the trip thread
// =====================================================================
function CreatePoll({ sessionId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleaned.length < 2 || busy) return;
    setBusy(true);
    try {
      const r = await authedFetch("/api/polls/create", {
        method: "POST",
        body: JSON.stringify({ sessionId, question: question.trim(), options: cleaned }),
      });
      if (!r.ok) throw new Error(await r.text());
      setOpen(false);
      setQuestion(""); setOptions(["", ""]);
      onCreated?.();
    } catch (e) {
      console.error("poll create failed", e);
      alert("Couldn't create the poll. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs hover:bg-white/[0.08]"
        title="Ask your group a question"
      >
        <BarChart3 size={12} className="accent-text" />
        New poll
      </motion.button>
      {open && (
        <div
          className="aura-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="aura-modal glass-strong rounded-3xl p-5 sm:p-6">
            <div className="mb-3">
              <h3 className="serif text-2xl">Ask your group</h3>
              <p className="mt-1 text-[12px] text-slate-400">
                Add 2–6 options. Everyone in the trip can vote, results update live.
              </p>
            </div>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Beach ya mountain?"
              className="accent-ring mb-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none"
              maxLength={200}
            />
            {options.map((o, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <input
                  value={o}
                  onChange={(e) => setOptions((s) => s.map((x, j) => j === i ? e.target.value : x))}
                  placeholder={`Option ${i + 1}`}
                  className="accent-ring flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm focus:outline-none"
                  maxLength={80}
                />
                {options.length > 2 && (
                  <button
                    onClick={() => setOptions((s) => s.filter((_, j) => j !== i))}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/[0.06]"
                    title="Remove option"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button
                onClick={() => setOptions((s) => [...s, ""])}
                className="mb-4 text-[12px] text-slate-400 hover:accent-text hover:underline"
              >
                + Add another option
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm hover:bg-white/[0.05]"
              >Cancel</button>
              <button
                onClick={submit} disabled={busy || !question.trim() || options.filter((o) => o.trim()).length < 2}
                className="accent-bg accent-glow flex-1 rounded-xl py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create poll"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


// =====================================================================
// RefineComposer — "make it cheaper", "swap day 2 indoor", custom text
// =====================================================================
function RefineComposer({ sessionId, itineraryMessageId, onRefining, disabled }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const chips = [
    "Make it cheaper",
    "More food spots",
    "Slower pace",
    "Indoor Day 2",
    "More photo spots",
  ];

  const send = async (instruction) => {
    const clean = (instruction ?? text).trim();
    if (!clean || busy || disabled) return;
    setBusy(true);
    onRefining?.(true);
    try {
      const r = await authedFetch("/api/chat/refine", {
        method: "POST",
        body: JSON.stringify({ sessionId, itineraryMessageId, instruction: clean }),
      });
      if (!r.ok) throw new Error(await r.text());
      setText("");
    } catch (e) {
      console.error("refine failed", e);
      alert("Refine failed. Try again in a moment.");
    } finally {
      setBusy(false);
      onRefining?.(false);
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
        <Wand2 size={12} className="accent-text" />
        Tweak this plan
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => send(c)}
            disabled={busy || disabled}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/[0.08] disabled:opacity-50"
          >{c}</button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Or type your own instruction…"
          disabled={busy || disabled}
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
        <button
          onClick={() => send()}
          disabled={busy || disabled || !text.trim()}
          className="accent-bg accent-glow grid h-8 w-8 place-items-center rounded-lg text-slate-900 disabled:opacity-50"
          title="Refine"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
        </button>
      </div>
    </div>
  );
}


// =====================================================================
// PriceCard — Serper-driven live-ish price snapshot
// =====================================================================
function PriceCard({ origin, destination, date }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fetchPrices = async () => {
    if (!origin || !destination || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await authedFetch("/api/prices/check", {
        method: "POST",
        body: JSON.stringify({ origin, destination, date }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setData(j);
    } catch (e) {
      setError(e.message ?? "lookup failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { fetchPrices(); /* eslint-disable-next-line */ }, [origin, destination, date]);

  const segs = [
    { key: "flight", icon: Plane, label: "Flight" },
    { key: "train",  icon: Train, label: "Train" },
    { key: "hotel",  icon: Hotel, label: "Hotel/night" },
  ];

  return (
    <div className="mb-5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <Tag size={12} className="accent-text" />
          Live price snapshot
        </div>
        <button
          onClick={fetchPrices} disabled={busy}
          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/[0.08]"
          title="Refresh"
        >
          <RefreshCw size={10} className={busy ? "animate-spin" : ""} />
          {busy ? "Checking…" : "Refresh"}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {segs.map((s) => {
          const p = data?.prices?.[s.key] ?? {};
          const lo = p.low_inr, hi = p.high_inr;
          const display = lo && hi ? `₹${fmtINR(lo)} – ₹${fmtINR(hi)}`
                         : lo ? `from ₹${fmtINR(lo)}`
                         : hi ? `up to ₹${fmtINR(hi)}`
                         : "—";
          return (
            <a
              key={s.key}
              href={p.source_url || undefined}
              target="_blank" rel="noreferrer"
              className={`flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 ${p.source_url ? "hover:border-white/20 hover:bg-white/[0.05]" : "cursor-default"}`}
            >
              <span className="flex items-center gap-2 text-[12px] text-slate-300">
                <s.icon size={13} className="accent-text" /> {s.label}
              </span>
              <span className="text-[13px] font-medium text-slate-100">{display}</span>
            </a>
          );
        })}
      </div>
      <div className="mt-2 text-[10px] text-slate-500">
        {error ? `Couldn't fetch: ${error}` : (data?.prices?.note ?? "AI estimate from public listings — verify on each booking site.")}
      </div>
    </div>
  );
}


// =====================================================================
// ChatDrawer — group chat side panel (kind=chat messages)
// =====================================================================
function ChatDrawer({ open, onClose, sessionId, messages, currentUserId }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const chatMsgs = messages.filter((m) => m.kind === "chat");
  const scroller = useRef(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chatMsgs.length, open]);

  const send = async () => {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      // members can insert their own user-role messages directly via RLS.
      await supabase.from("messages").insert({
        session_id: sessionId,
        author_id: currentUserId,
        role: "user",
        kind: "chat",
        content: clean,
      });
      setText("");
    } catch (e) {
      console.error("chat send failed", e);
    } finally {
      setBusy(false);
    }
  };

  // Distinct authors who've ever posted in this chat — fed into a
  // tiny "members" pill row at the top of the drawer with online dots.
  const authors = Array.from(new Set(chatMsgs.map((m) => m.author_id).filter(Boolean)));

  const fmtTime = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="drawer-backdrop"
            style={{ background: "var(--backdrop)" }}
          />
          <motion.aside
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            className="drawer"
            style={{ position: "fixed", right: 0, top: 0, zIndex: 160 }}
          >
            <div className="drawer-head">
              <div className="flex items-center gap-3">
                <div className="drawer-ico"><MessageSquare size={18} /></div>
                <div>
                  <div className="serif" style={{ fontSize: 20, lineHeight: 1 }}>Trip chat</div>
                  <div className="trip-sub" style={{ marginTop: 4 }}>
                    {authors.length} {authors.length === 1 ? "member" : "members"}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="btn-icon"
                style={{ width: 34, height: 34 }}
                aria-label="Close chat"
              >
                <X size={14} />
              </button>
            </div>

            <div ref={scroller} className="drawer-body">
              {authors.length > 0 && (
                <div className="chat-members">
                  {authors.slice(0, 6).map((id) => {
                    const initials = String(id).slice(0, 2).toUpperCase();
                    const isMe = id === currentUserId;
                    return (
                      <span key={id} className="pill chat-mem">
                        <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>{initials}</span>
                        {isMe ? "You" : "Member"}
                        <span className="chat-online" />
                      </span>
                    );
                  })}
                </div>
              )}

              {chatMsgs.length === 0 ? (
                <div className="grid h-full place-items-center text-center" style={{ color: "var(--ink-dim)", fontSize: 12.5 }}>
                  <div>
                    <MessageSquare size={28} className="accent-text mx-auto mb-2" />
                    No messages yet.<br />Side-chat with your trip crew here.
                  </div>
                </div>
              ) : (
                <div className="chat-msgs">
                  {chatMsgs.map((m, i) => {
                    const mine = m.author_id === currentUserId;
                    const prevSameAuthor = i > 0 && chatMsgs[i - 1].author_id === m.author_id;
                    return (
                      <div key={m.id} className={"chat-msg " + (mine ? "mine" : "")}>
                        {!mine && !prevSameAuthor && (
                          <div className="chat-who">Member</div>
                        )}
                        <div className="chat-bubble">{m.content}</div>
                        <div className="chat-time">{fmtTime(m.created_at)}</div>
                      </div>
                    );
                  })}
                  {busy && (
                    <div className="chat-msg mine">
                      <div className="chat-bubble">
                        <span className="cc-typing"><span /><span /><span /></span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="drawer-foot">
              <div className="composer-input" style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 5px 5px 12px",
                borderRadius: "var(--r)",
                border: "1px solid var(--line)",
                background: "var(--field-bg)",
              }}>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                  placeholder="Message your trip crew…"
                  disabled={busy}
                  style={{
                    flex: 1, background: "transparent", border: "none",
                    outline: "none", color: "var(--ink)",
                    fontFamily: "var(--sans)", fontSize: 14, padding: "9px 0",
                  }}
                />
                <button
                  onClick={send} disabled={busy || !text.trim()}
                  className="btn btn-primary"
                  style={{ width: 38, height: 38, padding: 0, borderRadius: 8 }}
                  aria-label="Send"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

