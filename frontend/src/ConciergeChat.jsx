import { useEffect, useRef, useState } from "react";
import { Bot, X, Send, Loader2, Sparkles } from "lucide-react";
import { supabase } from "./supabaseClient";

// Floating "Ask AuraGo" chat. Opens a small panel that's contextual to a
// destination — answers follow-up questions like "best food to try?",
// "how cold will it actually be?", "kid-friendly activities?".
export default function ConciergeChat({ context }) {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [thread, setThread]   = useState([]);
  const scrollRef = useRef(null);

  // Re-fresh greeting when destination changes
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

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
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

  // Hide entirely when there's no context (no card open)
  if (!context?.destination) return null;

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask AuraGo concierge"
          className="accent-bg accent-glow pulse-ring fixed right-4 z-40 grid h-12 w-12 place-items-center rounded-full text-slate-900 transition hover:scale-105 sm:right-6 sm:h-14 sm:w-14"
          style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
        >
          <Bot size={20} />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="glass-strong fixed right-2 z-40 flex h-[480px] max-h-[70vh] w-[min(360px,calc(100vw-1rem))] flex-col rounded-2xl border border-white/10 sm:right-6"
          style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="accent-bg accent-glow grid h-7 w-7 place-items-center rounded-lg">
                <Bot size={14} className="text-slate-900" />
              </div>
              <div>
                <div className="text-[13px] font-medium text-slate-100">AuraGo concierge</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {context.destination}
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/[0.06]"
              aria-label="Close concierge"
            >
              <X size={14} />
            </button>
          </div>

          {/* feed */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {thread.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-snug ${
                  m.role === "user"
                    ? "border border-white/10 bg-white/[0.07]"
                    : "border border-white/[0.06] bg-white/[0.025]"
                }`}>
                  {m.role === "assistant" && (
                    <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
                      <Sparkles size={9} className="accent-text" /> AuraGo
                    </div>
                  )}
                  <p className="whitespace-pre-wrap text-slate-100">{m.content}</p>
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 px-1 text-[12px] text-slate-400">
                <Loader2 size={12} className="animate-spin accent-text" />
                Thinking…
              </div>
            )}
          </div>

          {/* composer */}
          <div className="flex items-center gap-2 border-t border-white/[0.06] p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Ask anything about this trip…"
              className="flex-1 rounded-xl bg-white/[0.04] px-3 py-2 text-[13px] placeholder:text-slate-500 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={!input.trim() || busy}
              className="accent-bg accent-glow grid h-9 w-9 place-items-center rounded-xl disabled:opacity-50"
            >
              <Send size={14} className="text-slate-900" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
