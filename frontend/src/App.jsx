import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";
import Sidebar, { MAX_SESSIONS } from "./Sidebar";
import ChatInterface from "./ChatInterface.jsx";
import TripsCompareModal from "./TripsCompareModal";
import PublicTripView from "./PublicTripView";

const DEFAULT_PREFS = {
  mode: "elite",
  country: "India",
  has_passport: false,
  origin: "Delhi",
  party_size: 4,
  days: 4,
  budget_inr: 150000,
  universal_access: false,
  start_date: "", // ISO yyyy-mm-dd; empty = unspecified
  route_stops: [], // empty = single-destination trip; 2+ = multi-stop chain
};

const PREFS_KEY = "aurago.prefs";

function loadStoredPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

// Detect a /trip/<id> share URL — anyone can view that page, no login.
function publicTripIdFromUrl() {
  const m = window.location.pathname.match(/^\/trip\/([a-zA-Z0-9-]+)\/?$/);
  return m ? m[1] : null;
}

// Detect an /i/<sessionId> invite URL — visitor will be added to the session
// after auth and then redirected to /. Captured BEFORE auth gate, and
// mirrored into localStorage so it survives the Supabase email-verify
// redirect (which lands back on bare origin and would otherwise drop /i/).
const PENDING_INVITE_KEY = "aurago.pendingInvite";
function inviteSessionIdFromUrl() {
  const m = window.location.pathname.match(/^\/i\/([0-9a-f-]{36})\/?$/i);
  if (m) {
    try { localStorage.setItem(PENDING_INVITE_KEY, m[1]); } catch {}
    return m[1];
  }
  try {
    const stored = localStorage.getItem(PENDING_INVITE_KEY);
    if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return stored;
  } catch {}
  return null;
}
function clearPendingInvite() {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch {}
}

// Top-level router — public share URLs short-circuit auth entirely.
export default function App() {
  const tripId = publicTripIdFromUrl();
  if (tripId) return <PublicTripView tripId={tripId} />;
  return <AuthedApp />;
}

// Sidebar pin state lives in localStorage so it persists between visits.
const SIDEBAR_KEY = "aurago.sidebarPinned";
function loadSidebarPinned() {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY);
    return v === null ? true : v === "true";
  } catch { return true; }
}

function AuthedApp() {
  const [authSession, setAuthSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessions, setSessions]       = useState([]);
  const [activeId, setActiveId]       = useState(null);
  const [prefs, setPrefs]             = useState(loadStoredPrefs);
  const [bootError, setBootError]     = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(loadSidebarPinned);
  const [compareOpen, setCompareOpen] = useState(false);
  // Captured once at mount so Auth flow doesn't lose it on redirects.
  const [pendingInviteId] = useState(() => inviteSessionIdFromUrl());

  // Persist desktop pin state
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, String(sidebarPinned)); } catch {}
  }, [sidebarPinned]);

  // Update one session's title in local state — used after lock so the sidebar
  // reflects the destination name without a full reload.
  const updateSessionTitle = useCallback((id, title) => {
    if (!id || !title) return;
    setSessions((list) => list.map((s) => s.id === id ? { ...s, title } : s));
  }, []);

  // ---- watch auth ------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthSession(data.session ?? null);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setAuthSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- load sessions list whenever we have a user -------------------
  // No explicit owner filter: the RLS policies (sessions_owner_all +
  // sessions_participant_read) return rows where the user is either the
  // owner OR a participant via session_participants. This is what lets
  // collaborators see trips they were invited to.
  const loadSessions = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from("sessions")
      .select("id, title, mode, budget_inr, party_size, universal_access, country, has_passport, route_stops, owner_id, updated_at")
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .limit(MAX_SESSIONS);
    if (error) throw error;
    return data ?? [];
  }, []);

  useEffect(() => {
    if (!authSession?.user) {
      setSessions([]); setActiveId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const userId = authSession.user.id;

        // If we landed via /i/<sessionId>, accept the invite first so the
        // joined trip shows up in the list below. We don't block the load
        // if it fails (e.g., trip deleted) — we just clean the URL.
        if (pendingInviteId) {
          try {
            const { data: authData } = await supabase.auth.getSession();
            const token = authData?.session?.access_token;
            await fetch(`/api/sessions/${pendingInviteId}/join`, {
              method: "POST",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              credentials: "include",
            });
          } catch (e) {
            console.warn("invite accept failed:", e?.message);
          }
          // Clean URL + localStorage so refresh doesn't re-trigger the flow.
          window.history.replaceState({}, "", "/");
          clearPendingInvite();
        }

        let list = await loadSessions(userId);

        if (list.length === 0) {
          // First-time user — create one starter session
          const { data, error } = await supabase
            .from("sessions").insert({
              owner_id: userId, title: "New Trip",
              mode: prefs.mode, budget_inr: prefs.budget_inr,
              party_size: prefs.party_size,
              universal_access: prefs.universal_access,
            }).select().single();
          if (error) throw error;
          list = [data];
        }
        if (cancelled) return;
        setSessions(list);
        // Prefer the just-joined invite session if it's in the list.
        const preferred = pendingInviteId && list.some((x) => x.id === pendingInviteId)
          ? pendingInviteId
          : null;
        setActiveId((prev) => preferred
          ?? (prev && list.some((x) => x.id === prev) ? prev : list[0].id));

        // Hydrate prefs from active session's columns (mode/budget/party/access)
        const top = list[0];
        if (top) {
          setPrefs((p) => ({
            ...p,
            mode: top.mode ?? p.mode,
            budget_inr: top.budget_inr ?? p.budget_inr,
            party_size: top.party_size ?? p.party_size,
            universal_access: top.universal_access ?? p.universal_access,
            country: top.country ?? p.country,
            has_passport: top.has_passport ?? p.has_passport,
            route_stops: Array.isArray(top.route_stops) ? top.route_stops : p.route_stops,
          }));
        }
      } catch (e) {
        console.error("session load failed", e);
        if (!cancelled) setBootError(e.message ?? "Could not load your trips.");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession]);

  // ---- persist prefs (UI-only fields stay in localStorage) -----------
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
  }, [prefs]);

  // ---- handle prefs change (also writes to active session row) -------
  const handlePrefsChange = useCallback(async (next) => {
    setPrefs(next);
    if (!activeId) return;
    const { error } = await supabase
      .from("sessions")
      .update({
        mode: next.mode,
        budget_inr: next.budget_inr,
        party_size: next.party_size,
        universal_access: next.universal_access,
        country: next.country,
        has_passport: next.has_passport,
        route_stops: next.route_stops ?? [],
      })
      .eq("id", activeId);
    if (error) console.error("prefs persist failed", error);
    setSessions((list) =>
      list.map((s) => s.id === activeId
        ? { ...s, mode: next.mode, budget_inr: next.budget_inr,
            party_size: next.party_size, universal_access: next.universal_access,
            country: next.country, has_passport: next.has_passport,
            route_stops: next.route_stops ?? [] }
        : s)
    );
  }, [activeId]);

  // ---- create a new session ----------------------------------------
  const handleNewSession = useCallback(async () => {
    if (!authSession?.user) return;
    if (sessions.length >= MAX_SESSIONS) {
      alert(`You already have ${MAX_SESSIONS} trips. Please delete one first.`);
      return;
    }
    try {
      const { data, error } = await supabase.from("sessions").insert({
        owner_id: authSession.user.id, title: "New Trip",
        mode: prefs.mode, budget_inr: prefs.budget_inr,
        party_size: prefs.party_size,
        universal_access: prefs.universal_access,
        country: prefs.country,
        has_passport: prefs.has_passport,
      }).select().single();
      if (error) throw error;
      setSessions((list) => [data, ...list]);
      setActiveId(data.id);
      // Trip-specific prefs (date, multi-stop) shouldn't carry over to a new trip.
      setPrefs((p) => ({ ...p, start_date: "", route_stops: [] }));
    } catch (e) {
      console.error("create session failed", e);
      alert(e.message ?? "Could not create trip.");
    }
  }, [authSession, sessions.length, prefs]);

  // ---- delete a session --------------------------------------------
  const handleDeleteSession = useCallback(async (id) => {
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;
      setSessions((list) => {
        const next = list.filter((s) => s.id !== id);
        if (id === activeId) {
          setActiveId(next[0]?.id ?? null);
        }
        return next;
      });
    } catch (e) {
      console.error("delete session failed", e);
      alert(e.message ?? "Could not delete trip.");
    }
  }, [activeId]);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-300">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (!authSession) return <Auth />;

  if (bootError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-slate-200">
        <div className="max-w-md rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-sm">
          <p className="mb-2 font-medium">Couldn't load your trips</p>
          <p className="text-slate-400">{bootError}</p>
        </div>
      </div>
    );
  }

  if (!activeId) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-300">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onPick={setActiveId}
        onNew={handleNewSession}
        onDelete={handleDeleteSession}
        onSignOut={handleSignOut}
        onCompare={() => setCompareOpen(true)}
        pinned={sidebarPinned}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className={`transition-all duration-300 ease-out ${sidebarPinned ? "md:pl-72" : "md:pl-0"}`}>
        <ChatInterface
          key={activeId} /* remount on switch — clean state */
          sessionId={activeId}
          currentUser={{ id: authSession.user.id }}
          prefs={prefs}
          onPrefsChange={handlePrefsChange}
          onOpenSidebar={() => { setSidebarOpen(true); setSidebarPinned(true); }}
          onToggleSidebar={() => {
            // On desktop: flip pinned. On mobile: open the overlay.
            if (window.matchMedia("(min-width: 768px)").matches) {
              setSidebarPinned((p) => !p);
            } else {
              setSidebarOpen((o) => !o);
            }
          }}
          sidebarPinned={sidebarPinned}
          onSessionTitleChange={updateSessionTitle}
        />
      </div>
      <TripsCompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        userId={authSession.user.id}
      />
    </div>
  );
}
