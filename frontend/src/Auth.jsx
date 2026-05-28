import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Mail, Lock, Loader2, Eye, EyeOff,
  ArrowRight, Sun, Moon, Plane,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// Stable Unsplash CDN URL — wide beach/coastline at golden hour. The whole
// page sits on top of this so we use a high-res landscape variant.
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2000&q=80";

const THEME_KEY = "aurago.authTheme";

export default function Auth() {
  const [mode, setMode]         = useState("signin");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [info, setInfo]         = useState(null);
  const [error, setError]       = useState(null);
  const [theme, setTheme]       = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || "dark"; } catch { return "dark"; }
  });

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  const isLight = theme === "light";

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
          email: email.trim(),
          password,
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

  // Form-card palette (light mode = frosted white, dark = frosted slate)
  const C = isLight
    ? {
        card:       "bg-white/80 border-white/40 text-slate-900",
        label:      "text-slate-700",
        muted:      "text-slate-500",
        inputWrap:  "bg-white border-slate-200 focus-within:border-slate-900",
        inputText:  "text-slate-900 placeholder:text-slate-400",
        link:       "text-slate-700 hover:text-slate-900",
        divider:    "bg-slate-300",
        themeBtn:   "border-white/40 bg-white/30 text-white hover:bg-white/40",
      }
    : {
        card:       "bg-slate-950/55 border-white/[0.08] text-slate-100",
        label:      "text-slate-300",
        muted:      "text-slate-400",
        inputWrap:  "bg-white/[0.05] border-white/10 focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--ring)]",
        inputText:  "text-slate-100 placeholder:text-slate-500",
        link:       "text-slate-300 hover:text-white",
        divider:    "bg-white/15",
        themeBtn:   "border-white/20 bg-white/10 text-white hover:bg-white/20",
      };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden text-white">
      {/* Full-bleed hero image */}
      <img
        src={HERO_IMAGE}
        alt="Coastline at golden hour"
        className="absolute inset-0 h-full w-full object-cover"
        referrerPolicy="no-referrer"
        loading="eager"
      />
      {/* Dark wash so the headline + form read on any image variant */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(110deg, rgba(8,12,28,0.78) 0%, rgba(8,12,28,0.55) 45%, rgba(8,12,28,0.35) 100%)",
        }}
      />
      {/* Subtle accent glow behind the headline */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-1/4 h-96 w-96 rounded-full blur-3xl"
        style={{ background: "rgba(212,175,55,0.16)" }}
        animate={{ x: [0, 30, -10, 0], y: [0, -20, 10, 0], opacity: [0.45, 0.7, 0.45] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Theme toggle pinned top-right */}
      <button
        type="button"
        onClick={() => setTheme(isLight ? "dark" : "light")}
        aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
        title={isLight ? "Dark mode" : "Light mode"}
        className={`absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full border backdrop-blur-md transition sm:right-6 sm:top-6 ${C.themeBtn}`}
      >
        {isLight ? <Moon size={16} /> : <Sun size={16} />}
      </button>

      {/* Foreground grid */}
      <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-7xl gap-8 px-4 py-10 sm:px-10 sm:py-14 lg:grid-cols-2 lg:items-center lg:gap-16">

        {/* ============= LEFT: brand + giant headline ============= */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 110, damping: 20 }}
          className="flex flex-col gap-5 text-white"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 backdrop-blur-md">
              <Plane size={18} className="text-white" />
            </div>
            <span className="text-[14px] font-semibold uppercase tracking-[0.25em] text-white/80">
              AuraGo
            </span>
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, type: "spring", stiffness: 110, damping: 18 }}
            className="font-extrabold uppercase leading-[0.95] tracking-tight text-white"
            style={{
              fontSize: "clamp(2.6rem, 7vw, 5.5rem)",
              letterSpacing: "-0.02em",
              textShadow: "0 4px 24px rgba(0,0,0,0.35)",
            }}
          >
            Discover<br/>Hidden Gems.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="max-w-[460px] text-[15px] font-medium leading-relaxed text-white/85 sm:text-[16px]"
          >
            Where the AI finds the places guidebooks miss. AuraGo plans
            your journey — destinations, days, and booking links — in
            under thirty seconds.
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-[12px] uppercase tracking-[0.18em] text-white/60"
          >
            <span className="accent-text">●</span>{" "}
            8 live-checked picks · share with friends · book inside
          </motion.p>
        </motion.div>

        {/* ============= RIGHT: glassmorphic form card ============= */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 110, damping: 20 }}
          className={`mx-auto w-full max-w-[440px] rounded-3xl border p-6 backdrop-blur-2xl sm:p-8 ${C.card}`}
          style={{ boxShadow: "0 30px 80px -20px rgba(0,0,0,0.45)" }}
        >
          {/* heading row */}
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="mb-5"
            >
              <h2 className="serif text-3xl">
                {mode === "signup" ? "Create your account" : "Welcome back"}
              </h2>
              <p className={`mt-1 text-[13px] ${C.muted}`}>
                {mode === "signup"
                  ? "30 seconds and your first hidden-gem deck is ready."
                  : "Sign in to pick up your trips, share with friends, and lock plans."}
              </p>
            </motion.div>
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <FieldLine label="Email" C={C} icon={<Mail size={15} className={C.muted} />}>
              <input
                type="email" required autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className={`flex-1 bg-transparent text-[14.5px] focus:outline-none ${C.inputText}`}
              />
            </FieldLine>

            <FieldLine label="Password" C={C} icon={<Lock size={15} className={C.muted} />}>
              <input
                type={showPassword ? "text" : "password"}
                required minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`flex-1 bg-transparent text-[14.5px] focus:outline-none ${C.inputText}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className={`rounded-md p-1 ${C.muted} hover:opacity-70`}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </FieldLine>

            {mode === "signin" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleForgot}
                  className={`text-[12.5px] font-medium hover:underline ${C.link}`}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className={`rounded-lg border border-red-400/40 ${isLight ? "bg-red-50 text-red-700" : "bg-red-400/[0.08] text-red-200"} p-2 text-xs`}
                >
                  {error}
                </motion.p>
              )}
              {info && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className={`rounded-lg border border-emerald-400/40 ${isLight ? "bg-emerald-50 text-emerald-700" : "bg-emerald-400/[0.08] text-emerald-200"} p-2 text-xs`}
                >
                  {info}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.button
              type="submit" disabled={busy}
              whileHover={!busy ? { scale: 1.01 } : {}}
              whileTap={!busy ? { scale: 0.98 } : {}}
              transition={{ type: "spring", stiffness: 420, damping: 20 }}
              className={`group flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold tracking-wide uppercase disabled:opacity-50 ${
                isLight
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "accent-bg accent-glow text-slate-900"
              }`}
            >
              {busy ? (
                <><Loader2 size={14} className="animate-spin" /> Please wait…</>
              ) : (
                <>
                  {mode === "signup" ? "Sign up" : "Sign in"}
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                </>
              )}
            </motion.button>
          </form>

          {/* footer link — switch sign in/up */}
          <p className={`mt-5 text-center text-[13px] ${C.muted}`}>
            {mode === "signup" ? "Already a planner?" : "Are you new?"}{" "}
            <button
              type="button"
              onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); setInfo(null); }}
              className={`font-semibold underline-offset-4 hover:underline ${C.link}`}
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
          </p>

          <p className={`mt-4 border-t pt-3 text-center text-[10.5px] ${C.muted} ${isLight ? "border-slate-200" : "border-white/[0.08]"}`}>
            By continuing, you agree to AuraGo's terms & privacy policy.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function FieldLine({ label, icon, children, C }) {
  return (
    <div>
      <label className={`mb-1.5 block text-[12px] font-medium ${C.label}`}>
        {label}
      </label>
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition ${C.inputWrap}`}>
        {icon}
        {children}
      </div>
    </div>
  );
}
