# 03 · Frontend deep dive

## File layout

```
frontend/
├── index.html                  ← Vite entry
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── src/
    ├── main.jsx                ← ReactDOM.createRoot, mounts <App />
    ├── App.jsx                 ← Top-level router (auth gate, public-trip path, invite path)
    ├── Auth.jsx                ← Sign in / sign up screen
    ├── Sidebar.jsx             ← Trip list + theme toggle
    ├── ChatInterface.jsx       ← The main app — feed, deck, itinerary, drawers, composer
    ├── BudgetModal.jsx         ← Trip preferences modal
    ├── ConciergeChat.jsx       ← Floating "ask AuraGo" drawer
    ├── PublicTripView.jsx      ← Read-only /trip/<id> share page
    ├── TripsCompareModal.jsx   ← Locked-trips comparison ledger
    ├── supabaseClient.js       ← Single Supabase client used everywhere
    ├── index.css               ← Tailwind + Terminal design tokens (all four palettes)
    └── lib/
        ├── tripPlanning.js     ← Distance / route / budget breakdown helpers
        ├── cities.js           ← City autocomplete data per country
        └── teasers.js          ← Welcome rail teasers (vibe + place)
```

## Component responsibility map

Each file does exactly one job. There is no shared global store (no Redux, no Zustand) — state is held in `App.jsx` and passed down via props.

### `App.jsx` — top-level router + auth gate

Detects three URL patterns at mount:

```js
const tripId = publicTripIdFromUrl();        // /trip/<uuid>  → read-only
if (tripId) return <PublicTripView tripId={tripId} />;

const inviteId = inviteSessionIdFromUrl();   // /i/<uuid>     → accept-invite flow
                                             // (handled later, after auth)

return <AuthedApp />;                         // everything else
```

`AuthedApp` then:
- Subscribes to `supabase.auth.onAuthStateChange` so a fresh login or sign-out re-renders.
- Loads the user's sessions from `public.sessions` (RLS gives us owned + invited rows).
- Owns the theme state (`theme-light` / `theme-dark`) and applies it as a body class.
- Owns the mode state (`mode-sasta` / `mode-elite`) and applies it as a body class.
- Mounts `<Sidebar />`, `<ChatInterface />`, `<TripsCompareModal />`.

### `ChatInterface.jsx` — the main app

This is the biggest file (~2,400 lines). It is structured as:

```
ChatInterface (parent)
├── Welcome              (empty session)
├── Feed (messages.map)
│   ├── UserBubble        (kind === 'text', role 'user')
│   ├── MysteryDeck       (kind === 'mystery_deck')
│   │   └── BoardRow x 8  (split-flap departures board)
│   ├── ItineraryView     (kind === 'itinerary')
│   │   ├── Boarding pass
│   │   ├── HudMap
│   │   ├── WeatherCard
│   │   ├── PriceCard
│   │   ├── PhotoGallery
│   │   ├── Day timeline
│   │   ├── StaysSection
│   │   ├── PackingChecklist
│   │   ├── BookingLinks
│   │   ├── LocalGuides
│   │   ├── SimilarDestinations
│   │   └── RefineComposer
│   ├── PollCard          (kind === 'poll')
│   └── LockChip          (kind === 'lock_event')
├── Composer (textarea + mode toggle)
├── BudgetModal
├── ChatDrawer            (kind === 'chat' messages live here only)
├── ConciergeChat         (separate floating bubble)
└── CreatePoll modal
```

### State held in `ChatInterface`

```js
const [messages, setMessages] = useState([]);      // current session's rows from public.messages
const [sending, setSending]   = useState(false);   // composer disabled while waiting
const [input, setInput]       = useState("");      // composer text
const [openCard, setOpenCard] = useState({});      // {deckMsgId: cardId} = which card is expanded
const [modalOpen, setModalOpen] = useState(false); // BudgetModal visibility
const [pendingDestination, ...]                    // for I-know-where direct flow
const [composerMode, ...]                          // "surprise" | "direct"
const [chatOpen, ...]                              // ChatDrawer toggle
```

All other "live" state comes from Supabase realtime, not local state.

## Realtime subscription (the most important useEffect)

```js
useEffect(() => {
  if (!sessionId) return;
  const ch = supabase
    .channel(`session:${sessionId}`)
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages",
          filter: `session_id=eq.${sessionId}` },
        (p) => setMessages(prev =>
          prev.some(x => x.id === p.new.id) ? prev : [...prev, p.new]))
    .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages",
          filter: `session_id=eq.${sessionId}` },
        (p) => setMessages(prev =>
          prev.map(x => x.id === p.new.id ? { ...x, ...p.new } : x)))
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "trips",
          filter: `session_id=eq.${sessionId}` },
        (p) => /* append a lock_event chip */)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}, [sessionId]);
```

This is **why** the multi-user collaboration works. The browser never polls. When the backend (or another user) inserts a row, Supabase pushes the event over a websocket, and the local message list re-renders.

INSERT covers new messages. UPDATE covers poll vote payloads (votes mutate `messages.payload`, so we need to know when a payload changes).

## Sending a turn (from `ChatInterface`)

```js
const sendTurn = async (text, intentOverride) => {
  setSending(true);
  // 1. Optimistically insert the user message into local state immediately
  //    so the UI doesn't feel laggy.
  // 2. Insert the same row into public.messages so realtime sync covers it
  //    for other users in the session.
  // 3. POST /api/chat/turn with the prompt + optional structured intent.
  //    The backend will insert its own assistant rows; realtime will surface
  //    them when ready.
};
```

`intentOverride` is the "fast-path" — when the user submitted the BudgetModal, we already have structured values (mode, budget, party_size, days, country, has_passport, origin) and we send them so the backend can skip the `parseIntent` Groq call. Saves ~1.5 seconds per turn.

## Why no global store (Redux/Zustand)?

The app has one source of truth: the rows in `public.messages` plus the user's `prefs` object. Everything else is derived. A global store would be a second source of truth and a synchronization headache. Props-down + realtime-up keeps it simple.

## CSS architecture

`index.css` is the **only** stylesheet and contains:

1. **Tailwind directives** (`@tailwind base/components/utilities`).
2. **Design tokens** for four palettes: `theme-dark + mode-elite` (default), `theme-dark + mode-sasta`, `theme-light + mode-elite`, `theme-light + mode-sasta`.
3. **Custom classes** from the Terminal redesign: `.board`, `.brow`, `.flap2`, `.pass`, `.timeline`, `.tl-day`, `.tl-node`, `.hudmap`, `.hudpin`, `.drawer`, `.cc-msg`, `.chat-bubble`, `.bm-budget`, `.totals`, and so on.

Every custom class respects `var(--accent)`, `var(--ink)`, `var(--panel)` etc., so all four palette combinations work without per-component theme logic.

## Routing

There is no `react-router`. Three routes are handled with `window.location.pathname` checks at mount:

- `/trip/<uuid>` → `<PublicTripView />`
- `/i/<uuid>` → captured into localStorage, then redirected to `/` (Supabase auth-redirect-safe)
- everything else → `<AuthedApp />`

For a side project that has three real routes, this is simpler than pulling in a 30 KB router.

## Build output

`npm run build` produces:

```
frontend/dist/
├── index.html
├── assets/
│   ├── index-<hash>.css
│   └── index-<hash>.js
```

Total bundle: ~640 KB JS minified, ~180 KB gzipped. The Vite bundle warning about 500 KB chunks is acknowledged; we'll code-split when it actually hurts performance.

---

**Next file:** `04-backend-deep-dive.md` — Express controllers, request lifecycle, what each endpoint does.
