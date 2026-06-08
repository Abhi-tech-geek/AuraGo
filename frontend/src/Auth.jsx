import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, Lock, Loader2, Eye, EyeOff, ArrowRight,
  Check, Sparkles,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// Brand mark — small accent square + AuraGo wordmark (Anton + Anton in
// pill). Used in the auth hero. Matches the Terminal design's `.brand`.
function BrandMark({ size = 22 }) {
  return (
    <span className="brand" style={{ "--bz": `${size}px` }}>
      <span
        className="brand-mark"
        style={{ width: size + 14, height: size + 14 }}
      >
        <Sparkles size={size - 4} />
      </span>
      <span className="brand-word" style={{ fontSize: size }}>
        <span className="bw-1">AURA</span>
        <span className="bw-2">GO</span>
      </span>
    </span>
  );
}

export default function Auth() {
  const [mode, setMode]         = useState("signin");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [info, setInfo]         = useState(null);
  const [error, setError]       = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Account ban gaya! Email mein confirmation link bheja gaya — click karke wapas aao.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(), password,
        });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    if (!email.trim()) {
      setError("Enter your email first, then tap Forgot password.");
      return;
    }
    setBusy(true); setError(null); setInfo(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setInfo("Reset link sent to your email — open it and pick a new password.");
    } catch (e) {
      setError(e.message ?? "Couldn't send reset email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ra">
      <div className="ra-glow" />
      <div className="grain" />

      {/* =============== LEFT — HERO =============== */}
      <div className="ra-left">
        <BrandMark size={22} />

        <div className="ra-hero">
          <span className="eyebrow">AI travel discovery · live-checked</span>
          <motion.h1
            className="ra-h"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            Go where the<br />
            <span className="serif-i accent">crowd isn't.</span>
          </motion.h1>
          <p className="ra-sub">
            Tell AuraGo your budget and vibe — get 8 verified hidden gems,
            day-by-day plans, real booking links. In under 30 seconds.
          </p>

          <div className="ra-ticks">
            <span><Check size={14} className="accent" /> 8 cross-checked picks per ask</span>
            <span><Check size={14} className="accent" /> Live weather + price snapshots</span>
            <span><Check size={14} className="accent" /> Share with friends · plan together</span>
          </div>
        </div>

        <div className="ra-foot mono">© AURAGO · MADE FOR HIDDEN GEMS</div>
      </div>

      {/* =============== RIGHT — FORM =============== */}
      <div className="ra-right">
        <motion.div
          className="ra-card"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.45 }}
        >
          <div className="ra-card-head">
            <AnimatePresence mode="wait">
              <motion.h2
                key={mode}
                className="ra-ttl"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {mode === "signup" ? "Create account" : "Sign in"}
              </motion.h2>
            </AnimatePresence>
            <span className="pill-accent">{mode === "signup" ? "NEW" : "RETURN"}</span>
          </div>

          <form onSubmit={handleSubmit} className="ra-form">
            <div className="field">
              <label htmlFor="email"><Mail size={12} /> Email</label>
              <input
                id="email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input"
              />
            </div>

            <div className="field">
              <div className="ra-pwrow">
                <label htmlFor="pw"><Lock size={12} /> Password</label>
                {mode === "signin" && (
                  <button type="button" onClick={handleForgot} className="ra-link">
                    Forgot?
                  </button>
                )}
              </div>
              <div style={{ position: "relative" }}>
                <input
                  id="pw"
                  type={showPassword ? "text" : "password"}
                  required minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "min 6 characters" : "your password"}
                  className="input" style={{ paddingRight: 38 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                  style={{
                    position: "absolute", right: 8, top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent", border: "none",
                    color: "var(--ink-dim)", cursor: "pointer", padding: 6,
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  style={{
                    fontSize: 12, color: "#fb7185",
                    border: "1px solid rgba(251,113,133,0.30)",
                    background: "rgba(251,113,133,0.08)",
                    borderRadius: "var(--r-sm)", padding: 9,
                  }}
                >
                  {error}
                </motion.p>
              )}
              {info && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  style={{
                    fontSize: 12, color: "#5dd39e",
                    border: "1px solid rgba(60,240,106,0.30)",
                    background: "rgba(60,240,106,0.08)",
                    borderRadius: "var(--r-sm)", padding: 9,
                  }}
                >
                  {info}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.button
              type="submit" disabled={busy}
              whileHover={!busy ? { y: -2 } : {}} whileTap={!busy ? { scale: 0.98 } : {}}
              transition={{ type: "spring", stiffness: 420, damping: 20 }}
              className="btn btn-primary btn-cta"
              style={{ width: "100%", marginTop: 6, padding: "13px 18px" }}
            >
              {busy ? (
                <><Loader2 size={14} className="animate-spin" /> Please wait…</>
              ) : (
                <>{mode === "signup" ? "Create account" : "Sign in"} <ArrowRight size={14} /></>
              )}
            </motion.button>
          </form>

          <p className="ra-toggle">
            {mode === "signup" ? "Already a planner?" : "Are you new?"}{" "}
            <button
              type="button"
              onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); setInfo(null); }}
              className="ra-link"
              style={{ fontFamily: "var(--sans)", fontSize: 13.5, textTransform: "none", letterSpacing: 0 }}
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
