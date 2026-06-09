import { useEffect, useRef, useState } from "react";
import { Bot, X, Send, Loader2, Utensils, Shirt, Camera, MapPin } from "lucide-react";
import { supabase } from "./supabaseClient";

// Floating "Ask AuraGo" chat. Opens a drawer that's contextual to a
// destination — answers follow-up questions about food, weather, kid-friendly
// spots, hidden gems nearby, etc. Now uses the Terminal drawer styling +
// 4 quick-topic cards on the empty state + animated typing indicator.
const TOPICS = [
  { key: "food",    label: "Best food to try",        icon: Utensils, q: "What are the must-try local dishes here?" },
  { key: "wear",    label: "What should I wear?",     icon: Shirt,    q: "What should I pack and wear for this trip?" },
  { key: "photo",   label: "Best photo spots",        icon: Camera,   q: "Where are the best photo spots locals love?" },
  { key: "nearby",  label: "Hidden gems nearby",      icon: MapPin,   q: "Any hidden gems within an hour of here?" },
];

export default function ConciergeChat({ context }) {
  const [open, setOpen]     = useState(false);
  const [input, setInput]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [thread, setThread] = useState([]);
  const scrollRef = useRef(null);

  // Reset greeting whenever destination changes.
  useEffect(() => {
    if (!context?.destination) return;
    setThread([{
      role: "assistant",
      content: `Hi! I'm AuraGo's concierge. Ask me anything about ${context.destination} — food, activities, what to wear, kid-friendly spots, anything.`,
    }]);
  }, [context?.destination]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, [thread.length, busy, open]);

  const ask = async (questionText) => {
    const q = (questionText ?? input).trim();
    if (!q || busy) return;
    if (!questionText) setInput("");
    setThread((t) => [...t, { role: "user", content: q }]);
    setBusy(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const token = authData?.session?.access_token;
      const r = await fetch("/api/chat/qa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          destination: context?.destination,
          vibe: context?.vibe,
          weather: context?.weather,
          days: context?.days,
          question: q,
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setThread((t) => [...t, { role: "assistant", content: data.answer ?? "..." }]);
    } catch (e) {
      setThread((t) => [...t, {
        role: "assistant",
        content: `Sorry — couldn't reach AuraGo (${e.message ?? e}).`,
      }]);
    } finally {
      setBusy(false);
    }
  };

  if (!context?.destination) return null;

  // First-turn detection: show topic cards if there's only the greeting.
  const fresh = thread.length === 1 && thread[0].role === "assistant";

  return (
    <>
      {/* Floating FAB — pinned right edge, stacked beneath the chat FAB
          so the two never overlap on mobile. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask AuraGo concierge"
          className="fab fab-bot fixed right-4 z-40 sm:right-6"
          style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
        >
          <span className="fab-pulse" />
          <Bot size={20} />
        </button>
      )}

      {/* Drawer */}
      {open && (
        <div className="drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="drawer">
            <div className="drawer-head">
              <div className="flex items-center gap-3">
                <div className="drawer-ico"><Bot size={18} /></div>
                <div>
                  <div className="serif" style={{ fontSize: 20, lineHeight: 1 }}>Concierge</div>
                  <div className="trip-sub" style={{ marginTop: 4 }}>{context.destination}</div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn-icon"
                style={{ width: 34, height: 34 }}
                aria-label="Close concierge"
              >
                <X size={14} />
              </button>
            </div>

            <div ref={scrollRef} className="drawer-body">
              {fresh && (
                <div className="cc-topics">
                  {TOPICS.map((t) => (
                    <button
                      key={t.key}
                      className="cc-topic"
                      onClick={() => ask(t.q)}
                      disabled={busy}
                    >
                      <t.icon size={15} className="accent" />
                      {t.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="cc-msgs">
                {thread.map((m, i) => (
                  <div key={i} className={"cc-msg " + (m.role === "user" ? "me" : "bot")}>
                    <div className="cc-ava">
                      {m.role === "user" ? <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>YOU</span> : <Bot size={14} />}
                    </div>
                    <div className="cc-bubble">
                      <p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p>
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="cc-msg bot">
                    <div className="cc-ava"><Bot size={14} /></div>
                    <div className="cc-bubble">
                      <span className="cc-typing"><span /><span /><span /></span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="drawer-foot">
              <div className="composer-input" style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 5px 5px 12px",
                borderRadius: "var(--r)",
                border: "1px solid var(--line)",
                background: "rgba(0,0,0,0.32)",
              }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                  placeholder="Ask anything about this trip…"
                  style={{
                    flex: 1, background: "transparent", border: "none",
                    outline: "none", color: "var(--ink)",
                    fontFamily: "var(--sans)", fontSize: 14, padding: "9px 0",
                  }}
                />
                <button
                  onClick={() => ask()}
                  disabled={!input.trim() || busy}
                  className="btn btn-primary"
                  style={{ width: 38, height: 38, padding: 0, borderRadius: 8 }}
                  aria-label="Send"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
