import { useState } from "react";
import { Sparkles, Mail, Lock, Loader2, Eye, EyeOff, MapPin, ShieldCheck, Bot } from "lucide-react";
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

  return (
    <div className="relative min-h-[100dvh] text-slate-100">
      <div className="aurora" />
      <div className="grain" />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-6xl flex-col items-center justify-center gap-10 px-4 py-10 lg:flex-row lg:gap-16 lg:py-16">
        {/* ============= Left: brand + value props ============= */}
        <div className="flex w-full max-w-md flex-col gap-6 text-center lg:text-left">
          <div className="flex items-center gap-3 lg:justify-start justify-center">
            <div className="accent-bg accent-glow grid h-12 w-12 place-items-center rounded-2xl">
              <Sparkles size={22} className="text-slate-900" />
            </div>
            <div>
              <h1 className="serif text-4xl leading-none sm:text-5xl">AuraGo</h1>
              <p className="text-[12px] uppercase tracking-[0.18em] text-slate-400">
                AI travel discovery
              </p>
            </div>
          </div>

          <p className="serif text-2xl leading-snug text-slate-100 sm:text-3xl">
            <span className="accent-text">5 verified destinations</span>, a full plan, and a concierge bot — in 30 seconds.
          </p>
          <p className="text-[15px] leading-relaxed text-slate-300">
            Tell AuraGo your vibe, budget and travel dates. Get day-by-day itineraries
            with live weather, route options, hand-picked stays, and direct booking links.
            <span className="hidden sm:inline"> Works for solo trips on ₹5k or family escapes on ₹5L.</span>
          </p>

          <ul className="mx-auto flex flex-col gap-2.5 text-left text-[14px] sm:gap-3 lg:mx-0">
            <Feature Icon={MapPin} title="Mystery deck or direct">
              Hand AuraGo the wheel for 5 surprise picks, or just say "Goa".
            </Feature>
            <Feature Icon={ShieldCheck} title="Live-verified picks">
              Every plan is fact-checked against the web before you see it.
            </Feature>
            <Feature Icon={Bot} title="Concierge that follows up">
              Ask "best food?", "kid-friendly spots?" — get answers grounded in your trip.
            </Feature>
          </ul>
        </div>

        {/* ============= Right: auth card ============= */}
        <div className="glass-strong w-full max-w-md rounded-3xl p-6 sm:p-8">
          <div className="mb-5">
            <h2 className="serif text-2xl">
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </h2>
            <p className="mt-1 text-[13px] text-slate-400">
              {mode === "signup"
                ? "Naya account banao — 30 second mein trip plan ready."
                : "Sign in to plan, save and share your trips."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-400">
                Email
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition focus-within:border-white/30">
                <Mail size={16} className="text-slate-400" />
                <input
                  type="email" required autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 bg-transparent text-[15px] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-400">
                Password
              </label>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition focus-within:border-white/30">
                <Lock size={16} className="text-slate-400" />
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
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-red-400/30 bg-red-400/[0.06] p-2 text-xs text-red-200">
                {error}
              </p>
            )}
            {info && (
              <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/[0.06] p-2 text-xs text-emerald-200">
                {info}
              </p>
            )}

            <button
              type="submit" disabled={busy}
              className="accent-bg accent-glow flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 transition hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
            >
              {busy
                ? <><Loader2 size={14} className="animate-spin" /> Please wait…</>
                : mode === "signup" ? "Create account" : "Sign in"}
            </button>

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
        </div>
      </div>
    </div>
  );
}

function Feature({ Icon, title, children }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 transition hover:bg-white/[0.04]">
      <span className="accent-soft-bg accent-text mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg">
        <Icon size={13} />
      </span>
      <div>
        <div className="text-[13.5px] font-medium text-slate-100">{title}</div>
        <div className="text-[12.5px] text-slate-400">{children}</div>
      </div>
    </li>
  );
}
