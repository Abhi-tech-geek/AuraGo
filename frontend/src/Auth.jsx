import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Mail, Lock, Loader2, Eye, EyeOff,
  MapPin, ShieldCheck, Bot, ArrowRight,
} from "lucide-react";
import { supabase } from "./supabaseClient";

export default function Auth() {
  const [mode, setMode]         = useState("signin"); // "signin" | "signup"
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

  // Subtle reusable spring for hero + form entrances
  const spring = { type: "spring", stiffness: 110, damping: 18 };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden text-slate-100">
      <div className="aurora" />
      <div className="grain" />

      {/* Floating decorative blobs — pure motion, no images */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-24 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "var(--accent-soft)" }}
        animate={{ x: [0, 30, -10, 0], y: [0, -20, 10, 0], opacity: [0.45, 0.7, 0.45] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "rgba(99,102,241,0.18)" }}
        animate={{ x: [0, -20, 20, 0], y: [0, 15, -15, 0], opacity: [0.4, 0.65, 0.4] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-6xl flex-col items-center justify-center gap-10 px-4 py-10 lg:flex-row lg:gap-16 lg:py-16">
        {/* ============= Left: brand + value props ============= */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="flex w-full max-w-md flex-col gap-6 text-center lg:text-left"
        >
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: 0.05 }}
            className="flex items-center gap-3 lg:justify-start justify-center"
          >
            <motion.div
              className="accent-bg accent-glow grid h-12 w-12 place-items-center rounded-2xl"
              whileHover={{ rotate: 12, scale: 1.05 }}
              transition={{ type: "spring", stiffness: 320, damping: 14 }}
            >
              <Sparkles size={22} className="text-slate-900" />
            </motion.div>
            <div>
              <h1 className="serif text-4xl leading-none sm:text-5xl">AuraGo</h1>
              <p className="text-[12px] uppercase tracking-[0.18em] text-slate-400">
                AI travel discovery
              </p>
            </div>
          </motion.div>

          {/* Trust pill — gives social proof feel without faking numbers */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.1 }}
            className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] text-slate-300 lg:mx-0"
          >
            <span className="accent-text">●</span> Live-verified trips · 30s plan · share with one link
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.15 }}
            className="serif text-2xl leading-snug text-slate-100 sm:text-3xl"
          >
            <span className="accent-text">8 hidden-gem destinations</span>, a full plan, and a concierge bot — in 30 seconds.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.2 }}
            className="text-[15px] leading-relaxed text-slate-300"
          >
            Tell AuraGo your vibe, budget and travel dates. Get day-by-day itineraries
            with live weather, route options, hand-picked stays, and direct booking links.
            <span className="hidden sm:inline"> Works for solo trips on ₹5k or family escapes on ₹5L.</span>
          </motion.p>

          <motion.ul
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.08, delayChildren: 0.25 } },
            }}
            className="mx-auto flex flex-col gap-2.5 text-left text-[14px] sm:gap-3 lg:mx-0"
          >
            <Feature Icon={MapPin} title="Mystery deck or direct">
              Hand AuraGo the wheel for 8 surprise picks, or just say "Goa".
            </Feature>
            <Feature Icon={ShieldCheck} title="Live-verified picks">
              Every plan is fact-checked against the web before you see it.
            </Feature>
            <Feature Icon={Bot} title="Concierge that follows up">
              Ask "best food?", "kid-friendly spots?" — get answers grounded in your trip.
            </Feature>
          </motion.ul>
        </motion.div>

        {/* ============= Right: auth card ============= */}
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring, delay: 0.1 }}
          className="glass-strong relative w-full max-w-md overflow-hidden rounded-3xl p-6 sm:p-8"
        >
          {/* Subtle inner glow shimmer */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -top-12 left-1/2 h-32 w-72 -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: "var(--accent-soft)" }}
            animate={{ opacity: [0.45, 0.75, 0.45] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="relative mb-5">
            <AnimatePresence mode="wait">
              <motion.h2
                key={mode}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="serif text-2xl"
              >
                {mode === "signup" ? "Create your account" : "Welcome back"}
              </motion.h2>
            </AnimatePresence>
            <p className="mt-1 text-[13px] text-slate-400">
              {mode === "signup"
                ? "Naya account banao — 30 second mein trip plan ready."
                : "Sign in to plan, save and share your trips."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="relative space-y-3">
            <Field
              label="Email"
              icon={<Mail size={16} className="text-slate-400" />}
            >
              <input
                type="email" required autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 bg-transparent text-[15px] focus:outline-none"
              />
            </Field>

            <Field
              label="Password"
              icon={<Lock size={16} className="text-slate-400" />}
            >
              <input
                type={showPassword ? "text" : "password"}
                required minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "min 6 characters" : "your password"}
                className="flex-1 bg-transparent text-[15px] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="rounded-md p-1 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </Field>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-lg border border-red-400/30 bg-red-400/[0.06] p-2 text-xs text-red-200"
                >
                  {error}
                </motion.p>
              )}
              {info && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-lg border border-emerald-400/30 bg-emerald-400/[0.06] p-2 text-xs text-emerald-200"
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
              className="accent-bg accent-glow group flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-50"
            >
              {busy ? (
                <><Loader2 size={14} className="animate-spin" /> Please wait…</>
              ) : (
                <>
                  {mode === "signup" ? "Create account" : "Sign in"}
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                </>
              )}
            </motion.button>

            <div className="pt-1 text-center text-xs text-slate-400">
              {mode === "signup" ? (
                <>Already have an account?{" "}
                  <button type="button" onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
                          className="accent-text font-medium hover:underline">
                    Sign in
                  </button>
                </>
              ) : (
                <>New here?{" "}
                  <button type="button" onClick={() => { setMode("signup"); setError(null); setInfo(null); }}
                          className="accent-text font-medium hover:underline">
                    Create account
                  </button>
                </>
              )}
            </div>
          </form>

          <p className="mt-5 border-t border-white/[0.06] pt-3 text-center text-[10px] text-slate-500">
            By continuing, you agree to AuraGo's terms and privacy policy.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

// Reusable labeled input wrapper with focus-ring affordance.
function Field({ label, icon, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-400">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--ring)]">
        {icon}
        {children}
      </div>
    </div>
  );
}

function Feature({ Icon, title, children }) {
  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, x: -10 },
        show:   { opacity: 1, x: 0 },
      }}
      whileHover={{ x: 2 }}
      className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 transition hover:bg-white/[0.04]"
    >
      <span className="accent-soft-bg accent-text mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg">
        <Icon size={13} />
      </span>
      <div>
        <div className="text-[13.5px] font-medium text-slate-100">{title}</div>
        <div className="text-[12.5px] text-slate-400">{children}</div>
      </div>
    </motion.li>
  );
}
