import { useEffect, useRef, useState } from "react";

// =====================================================================
// CountUp — animates a number from its previous value to a new one.
// Lightweight (no library), respects prefers-reduced-motion, and lets
// the caller format the displayed value (e.g. ₹ with Indian grouping,
// or a 1-decimal score).
//
// Usage:
//   <CountUp value={45000} format={(n) => `₹${fmtINR(n)}`} />
//   <CountUp value={9.3} decimals={1} />
// =====================================================================
export default function CountUp({
  value,
  duration = 650,
  decimals = 0,
  format,
  className,
  style,
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    const to = Number(value) || 0;

    if (reduce || from === to) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to);
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const rounded = decimals > 0
    ? Number(display).toFixed(decimals)
    : Math.round(display);

  return (
    <span className={className} style={style}>
      {format ? format(Number(rounded)) : rounded}
    </span>
  );
}
