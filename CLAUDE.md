# AURAGO. CAVE NOTES.

ME MAKE TRIP APP. AI THINK. USER HAPPY.

## WHAT THIS

USER TYPE WORDS. APP GIVE 5 MYSTERY CARDS. USER POKE CARD → BIG PLAN COME.
PLAN HAVE: DAYS, MAUSAM, MAP, HOTEL, CAB, BAG LIST, SAME-SAME PLACE.
USER LOCK TRIP. USER SHARE LINK. FRIEND SEE — NO LOGIN NEEDED.

## STACK

### FRONT (BROWSER FIRE)
- REACT 19 + VITE — SCREEN
- TAILWIND — PAINT
- FRAMER MOTION — MOVE PRETTY
- LUCIDE-REACT — TINY PICTURE
- SUPABASE-JS — TALK TO DATA ROCK

### BACK (SERVER ROCK)
- NODE 20 + EXPRESS 5 — LISTEN SHOUT
- SUPABASE — STORE USER + TRIP + TALK
  - AUTH = WHO YOU
  - POSTGRES + RLS = SAFE BOX
  - REALTIME = NEW MSG ZAP
- GROQ (LLAMA 3.3 70B) — BIG BRAIN. FAST.
- SERPER.DEV — LOOK WEB. CHECK PLACE NOT BROKEN.

### CLOUD (SKY ROCK)
- GOOGLE CLOUD RUN — APP LIVE HERE
- CLOUD BUILD — CODE → BOX
- GCR — KEEP BOX

## FILES

```
ROOT
├── 01_supabase_schema.sql    ← RUN ONCE. MAKE DATA HOUSE.
├── AuraGo_Demo.html           ← OLD STATIC DEMO. NO BACK.
├── Dockerfile                 ← BUILD ONE BIG BOX (FRONT + BACK)
├── cloudbuild.yaml.example    ← DEPLOY TEMPLATE. COPY. FILL.
├── README.md                  ← LONG TALK FOR HUMAN
├── backend/
│   ├── server.js              ← EXPRESS LISTEN
│   ├── chatController.js      ← BRAIN HANDLER
│   └── .env.example           ← KEY GUIDE
└── frontend/src/
    ├── App.jsx                ← TOP. ROUTE AUTH-OR-PUBLIC.
    ├── Auth.jsx               ← LOGIN HUT
    ├── Sidebar.jsx            ← TRIP LIST. MAX 5.
    ├── ChatInterface.jsx      ← BIG SCREEN. DECK + ITINERARY.
    ├── BudgetModal.jsx        ← ASK MONEY/PEOPLE/DAY/DATE
    ├── ConciergeChat.jsx      ← FLOATY BOT. ANSWER QUESTION.
    ├── PublicTripView.jsx     ← READ-ONLY SHARE PAGE
    ├── TripsCompareModal.jsx  ← BAR CHART OF LOCKED TRIP
    ├── supabaseClient.js      ← ONE CLIENT. SHARE.
    ├── main.jsx + index.css   ← ENTRY + GLUE
    └── lib/tripPlanning.js    ← MATH. ROUTE. BREAKDOWN.
```

## API SHOUTS

| METHOD | PATH | AUTH | DO |
|---|---|---|---|
| POST | /api/chat/turn | YES | MAKE 5-CARD MYSTERY DECK |
| POST | /api/chat/expand-card | YES | OPEN CARD → FULL PLAN |
| POST | /api/chat/direct | YES | USER KNOW PLACE. SKIP MYSTERY. |
| POST | /api/chat/qa | YES | CONCIERGE ANSWER |
| POST | /api/trips/lock | YES | LOCK TRIP. RENAME SESSION. |
| GET | /api/public/trip/:id | NO | SHARE LINK. NO LOGIN. |

## TWO USER MODE

1. **MYSTERY** 🎲 → USER VAGUE. APP GIVE 5 CARD.
2. **DIRECT** 📍 → USER SAY "GOA". MODAL ASK MONEY/PEOPLE/DAY → PLAN.

## TWO TRIP MODE

- **SASTA** 💸 — NEON GREEN. HOSTEL. TRAIN. STREET FOOD.
- **ELITE** 👑 — GOLD. HOTEL. FLIGHT. FANCY FOOD.

CSS VARIABLE FLIP → WHOLE APP CHANGE COLOR.

## RUN LOCAL

```
cd backend  → cp .env.example .env  → fill keys  → npm install  → npm run dev
cd frontend → cp .env.example .env.local → fill keys → npm install → npm run dev
```

NEED: SUPABASE PROJECT, GROQ KEY (FREE), SERPER KEY (FREE).

## DEPLOY

```
cp cloudbuild.yaml.example cloudbuild.yaml   ← FILL REAL KEYS
gcloud builds submit --config cloudbuild.yaml .
```

THEN: SUPABASE → AUTH → URL CONFIG → ADD CLOUD RUN URL TO REDIRECT LIST.

## SECRET RULE

NEVER COMMIT: `.env`, `.env.local`, `cloudbuild.yaml`. `.gitignore` PROTECT.
USE `.example` FILES — NO REAL KEY INSIDE.

## LIVE ROCK

🟢 https://aurago-13196505521.us-central1.run.app
📦 https://github.com/Abhi-tech-geek/AuraGo
