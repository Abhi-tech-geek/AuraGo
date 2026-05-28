import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Mail, Lock, Loader2, Eye, EyeOff,
  ArrowRight, Sun, Moon, MapPin, ShieldCheck, Bot,
} from "lucide-react";
import { supabase } from "./supabaseClient";

// Hot-linked Unsplash photo — stable CDN URL, travel-themed (backpacker
// overlooking mountains). Used as the left-pane hero for the split layout.
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1600&q=80";

// Persistence key for the per-user theme toggle on this page.
const THEME_KEY = "aurago.authTheme";

export default function Auth() {
  const [mode, setMode]         = useState("signin"); // "signin" | "signup"
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [info, setInfo]         = useState(null);
  const [error, setError]       = useState(null);
  const [remember, setRemember] = useState(true);
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

  // Two scoped palettes so the global app stays dark.
  const P = isLight
    ? {
        page:        "bg-slate-50",
        panel:       "bg-white",
        text:        "text-slate-900",
        subtext:     "text-slate-600",
        muted:       "text-slate-500",
        border:      "border-slate-200",
        inputWrap:   "bg-slate-50 border-slate-200 focus-within:border-slate-400",
        inputText:   "text-slate-900 placeholder:text-slate-400",
        toggleBtn:   "border-slate-200 bg-white hover:bg-slate-100 text-slate-700",
        iconMuted:   "text-slate-500",
        chip:        "border-slate-200 bg-white text-slate-600",
        switchBtn:   "border-slate-300 text-slate-700 hover:bg-slate-100",
        dot:         "bg-slate-900",
      }
    : {
        page:        "bg-[var(--bg)]",
        panel:       "glass-strong",
        text:        "text-slate-100",
        subtext:     "text-slate-300",
        muted:       "text-slate-400",
        border:      "border-white/[0.08]",
        inputWrap:   "bg-white/[0.03] border-white/10 focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--ring)]",
        inputText:   "text-slate-100 placeholder:text-slate-500",
        toggleBtn:   "border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200",
        iconMuted:   "text-slate-400",
        chip:        "border-white/[0.08] bg-white/[0.03] text-slate-300",
        switchBtn:   "border-white/10 text-slate-200 hover:bg-white/[0.08]",
        dot:         "bg-[var(--accent)]",
      };

  return (
    <div className={`relative min-h-[100dvh] overflow-hidden ${P.page} ${P.text}`}>
      {/* dark mode keeps the aurora; light mode gets a softer wash */}
      {isLight ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-40 blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(99,102,241,0.35), transparent 70%)" }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full opacity-40 blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(212,175,55,0.35), transparent 70%)" }}
          />
        </>
      ) : (
        <>
          <div className="aurora" />
          <div className="grain" />
        </>
      )}

      <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-7xl items-stretch safe-pt safe-pb px-2 py-3 sm:px-6 sm:py-10">
        <div className={`relative grid w-full overflow-hidden rounded-2xl border sm:rounded-3xl ${P.border} ${P.panel} shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] lg:grid-cols-2`}>

          {/* ============ MOBILE-ONLY MINI HERO BANNER ============ */}
          <div className="relative h-[180px] w-full overflow-hidden lg:hidden">
            <img
              src={HERO_IMAGE}
              alt="A mountain valley at sunrise"
              className="absolute inset-0 h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(180deg, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0.75) 100%)" }}
            />
            {/* brand block — small */}
            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 text-white">
              <div className="flex items-center gap-2">
                <div className="accent-bg accent-glow grid h-9 w-9 place-items-center rounded-xl">
                  <Sparkles size={16} className="text-slate-900" />
                </div>
                <div>
                  <div className="serif text-xl leading-none">AuraGo</div>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-slate-300">AI travel discovery</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTheme(isLight ? "dark" : "light")}
                aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm"
              >
                {isLight ? <Moon size={14} /> : <Sun size={14} />}
              </button>
            </div>
            {/* mini tagline at bottom */}
            <div className="absolute inset-x-0 bottom-0 px-4 pb-3 text-white">
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05, type: "spring", stiffness: 140, damping: 18 }}
                className="serif text-[20px] leading-tight"
              >
                Hidden gems, not the same five places.
              </motion.div>
            </div>
          </div>

          {/* ============ DESKTOP-ONLY LEFT HERO ============ */}
          <div className="relative hidden min-h-[500px] lg:block">
            <img
              src={HERO_IMAGE}
              alt="A mountain valley at sunrise"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ clipPath: "ellipse(112% 100% at 0% 50%)" }}
              referrerPolicy="no-referrer"
            />
            <div
              className="absolute inset-0"
              style={{
                clipPath: "ellipse(112% 100% at 0% 50%)",
                background: "linear-gradient(135deg, rgba(15,23,42,0.65) 0%, rgba(15,23,42,0.20) 60%, transparent 100%)",
              }}
            />
            <div className="absolute inset-0 flex flex-col justify-between p-10">
              <div className="flex items-center gap-3 text-white">
                <div className="accent-bg accent-glow grid h-11 w-11 place-items-center rounded-2xl">
                  <Sparkles size={20} className="text-slate-900" />
                </div>
                <div>
                  <div className="serif text-3xl leading-none">AuraGo</div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300">AI travel discovery</div>
                </div>
              </div>

              <div className="max-w-[420px] text-white">
                <motion.h2
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 120, damping: 18 }}
                  className="serif text-4xl leading-tight sm:text-5xl"
                >
                  Hidden gems,<br/>not the same five places.
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18 }}
                  className="mt-3 text-[14.5px] leading-relaxed text-slate-200/90"
                >
                  Tell AuraGo your budget and vibe. Get 8 cross-checked
                  destinations, day-by-day plans, real booking links — in 30
                  seconds.
                </motion.p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Chip Icon={MapPin}>8 verified picks</Chip>
                  <Chip Icon={ShieldCheck}>Live-checked plans</Chip>
                  <Chip Icon={Bot}>Concierge inside</Chip>
                </div>
              </div>
            </div>
          </div>

          {/* ============ RIGHT: form ============ */}
          <div className="relative flex flex-col p-5 sm:p-10">
            {/* top bar: on mobile the theme toggle lives in the hero, so we
                only render the sign-in/up switch here. Desktop shows both. */}
            <div className="mb-5 flex items-center justify-between gap-2 sm:mb-8">
              <div className={`flex items-center gap-2 text-[12.5px] sm:text-[13px] ${P.subtext}`}>
                <span className={`${P.muted} hidden xs:inline sm:inline`}>
                  {mode === "signup" ? "Already a planner?" : "New to AuraGo?"}
                </span>
                <button
                  type="button"
                  onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); setInfo(null); }}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${P.switchBtn}`}
                >
                  {mode === "signup" ? "Sign in" : "Sign up"}
                </button>
              </div>
              {/* desktop-only theme toggle (mobile one lives in the hero) */}
              <button
                type="button"
                onClick={() => setTheme(isLight ? "dark" : "light")}
                aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
                title={isLight ? "Dark mode" : "Light mode"}
                className={`hidden h-9 w-9 place-items-center rounded-full border transition lg:grid ${P.toggleBtn}`}
              >
                {isLight ? <Moon size={15} /> : <Sun size={15} />}
              </button>
            </div>

            {/* heading */}
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <h1 className="serif text-3xl leading-tight sm:text-5xl">
                  {mode === "signup" ? "Create account" : "Welcome back"}
                </h1>
                <p className={`mt-2 text-[13px] sm:text-[14px] ${P.subtext}`}>
                  {mode === "signup"
                    ? "30 seconds and your first hidden-gem deck is yours."
                    : "Sign in to pick up your trips, share with friends, and lock plans."}
                </p>
              </motion.div>
            </AnimatePresence>

            {/* form */}
            <form onSubmit={handleSubmit} className="mt-5 space-y-3.5 sm:mt-8 sm:space-y-4">
              <Field label="Email" P={P} icon={<Mail size={15} className={P.iconMuted} />}>
                <input
                  type="email" required autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`flex-1 bg-transparent text-[15px] focus:outline-none ${P.inputText}`}
                />
              </Field>

              <Field label="Password" P={P} icon={<Lock size={15} className={P.iconMuted} />}>
                <input
                  type={showPassword ? "text" : "password"}
                  required minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "min 6 characters" : "your password"}
                  className={`flex-1 bg-transparent text-[15px] focus:outline-none ${P.inputText}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className={`rounded-md p-1 ${P.iconMuted} hover:opacity-70`}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </Field>

              {mode === "signin" && (
                <div className="flex items-center justify-between">
                  <label className={`flex cursor-pointer items-center gap-2 text-[12.5px] ${P.subtext}`}>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    Remember me
                  </label>
                  <button
                    type="button"
                    onClick={handleForgot}
                    className="accent-text text-[12.5px] font-medium hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="rounded-lg border border-red-400/30 bg-red-400/[0.06] p-2 text-xs text-red-500"
                  >
                    {error}
                  </motion.p>
                )}
                {info && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="rounded-lg border border-emerald-400/30 bg-emerald-400/[0.08] p-2 text-xs text-emerald-600"
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
                className="accent-bg accent-glow group flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[15px] font-semibold text-slate-900 disabled:opacity-50"
              >
                {busy ? (
                  <><Loader2 size={15} className="animate-spin" /> Please wait…</>
                ) : (
                  <>
                    {mode === "signup" ? "Create account" : "Sign in"}
                    <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
                  </>
                )}
              </motion.button>
            </form>

            <p className={`mt-6 pt-4 text-center text-[10.5px] sm:mt-auto sm:pt-8 ${P.muted}`}>
              By continuing, you agree to AuraGo's terms & privacy policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, icon, children, P }) {
  return (
    <div>
      <label className={`mb-1.5 block text-[11px] uppercase tracking-wider ${P.muted}`}>
        {label}
      </label>
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition ${P.inputWrap}`}>
        {icon}
        {children}
      </div>
    </div>
  );
}

function Chip({ Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.12] px-2.5 py-1 text-[11px] text-white/90 backdrop-blur-sm">
      <Icon size={11} />
      {children}
    </span>
  );
}
