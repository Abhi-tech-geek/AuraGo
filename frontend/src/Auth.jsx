import { useState } from "react";
import { Sparkles, Mail, Lock, Loader2 } from "lucide-react";
import { supabase } from "./supabaseClient";

export default function Auth() {
  const [mode, setMode]         = useState("signin"); // "signin" | "signup"
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
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
    <div className="relative flex min-h-screen items-center justify-center px-4 text-slate-100">
      <div className="aurora" />
      <div className="grain" />
      <div className="glass-strong relative z-10 w-full max-w-md rounded-3xl p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="accent-bg accent-glow grid h-10 w-10 place-items-center rounded-2xl">
            <Sparkles size={18} className="text-slate-900" />
          </div>
          <div>
            <h1 className="serif text-2xl leading-none">AuraGo</h1>
            <p className="text-[11px] text-slate-400">
              {mode === "signup" ? "Naya account banao" : "Sign in to continue"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-slate-400">
              Email
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <Mail size={16} className="text-slate-400" />
              <input
                type="email" required
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
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <Lock size={16} className="text-slate-400" />
              <input
                type="password" required minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "min 6 characters" : "your password"}
                className="flex-1 bg-transparent text-[15px] focus:outline-none"
              />
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
            className="accent-bg accent-glow flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
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
              <>Naye ho?{" "}
                <button type="button" onClick={() => { setMode("signup"); setError(null); setInfo(null); }}
                        className="accent-text font-medium hover:underline">
                  Create account
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
