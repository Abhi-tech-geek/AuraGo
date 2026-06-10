import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle, Info, X } from "lucide-react";

// =====================================================================
// Toast — module-level pub/sub so `toast.success(...)` works from ANY
// file with a plain import, no context provider or prop drilling.
// Mount <ToastHost /> once near the app root.
// =====================================================================

let pushFn = null;
let counter = 0;

export const toast = {
  success: (msg, opts) => pushFn?.({ id: ++counter, type: "success", msg, ...opts }),
  error:   (msg, opts) => pushFn?.({ id: ++counter, type: "error",   msg, ...opts }),
  info:    (msg, opts) => pushFn?.({ id: ++counter, type: "info",    msg, ...opts }),
};

const ICON = { success: Check, error: AlertTriangle, info: Info };
const TONE = {
  success: { border: "var(--accent-line)", fg: "var(--accent)" },
  error:   { border: "rgba(251,113,133,0.4)", fg: "#fb7185" },
  info:    { border: "var(--line-2)", fg: "var(--ink-soft)" },
};

export function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    pushFn = (t) => {
      setItems((arr) => [...arr, t]);
      const ttl = t.duration ?? 3600;
      setTimeout(() => {
        setItems((arr) => arr.filter((x) => x.id !== t.id));
      }, ttl);
    };
    return () => { pushFn = null; };
  }, []);

  const dismiss = (id) => setItems((arr) => arr.filter((x) => x.id !== id));

  return (
    <div
      className="fixed left-1/2 z-[300] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2"
      style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const Icon = ICON[t.type] ?? Info;
          const tone = TONE[t.type] ?? TONE.info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="glass-strong flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ border: `1px solid ${tone.border}` }}
            >
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ background: "var(--accent-soft)", color: tone.fg }}
              >
                <Icon size={15} />
              </span>
              <span className="flex-1 text-[13.5px] leading-snug" style={{ color: "var(--ink)" }}>
                {t.msg}
              </span>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded-md p-1"
                style={{ color: "var(--ink-dim)" }}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
