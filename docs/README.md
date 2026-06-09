# AuraGo — Internal Project Documentation

Welcome. This folder contains the **complete internal documentation** for AuraGo — an AI-powered travel discovery platform. It is written for **one specific reader: you, the developer who built it**, so you can confidently explain every layer in interviews, presentations, and team discussions.

## How this is organised

Each numbered file covers one concern. They are designed to be read **in order** the first time, but later you can jump straight to a single file when you need to refresh a specific area.

| File | Covers | Read when |
|------|--------|-----------|
| `00-overview-what-is-aurago.md` | The honest one-paragraph answer to "what is this project?" — including what it is **not** | First |
| `01-architecture-big-picture.md` | High-level architecture diagram in text, every component named | After overview |
| `02-tech-stack-decisions.md` | Every tool used. **What, Why, Alternatives, Why not.** | Before any interview |
| `03-frontend-deep-dive.md` | React app structure, components, state, realtime hooks | Frontend questions |
| `04-backend-deep-dive.md` | Express server, controllers, request lifecycle | Backend questions |
| `05-database-and-schema.md` | Every Supabase table, RLS policy, vector status | Database questions |
| `06-ai-agents-explained.md` | All eight LLM "roles" — and an honest answer to "is this agentic?" | AI questions |
| `07-orchestration-and-workflows.md` | How the LLM calls are chained per endpoint | Workflow questions |
| `08-prompt-engineering.md` | System prompts, JSON-only outputs, why we structure them | LLM design questions |
| `09-rag-and-retrieval.md` | Serper as live retrieval; pgvector status; why no embeddings yet | RAG questions |
| `10-memory-and-state.md` | Where context lives, how sessions persist, how we don't (yet) do agent memory | Memory questions |
| `11-end-to-end-data-flow.md` | A user types "Goa" → trip appears. Every hop documented. | Flow questions |
| `12-auth-and-security.md` | Supabase Auth, RLS, secrets, JWTs | Security questions |
| `13-realtime-collaboration.md` | Supabase channels, INSERT + UPDATE sync, polls, chat | Realtime questions |
| `14-deployment-pipeline.md` | Docker, Cloud Build, Cloud Run | DevOps questions |
| `15-performance-optimizations.md` | Parallel calls, fast-paths, latency control | Performance questions |
| `16-future-improvements.md` | What this would look like as a "real" agentic system | Roadmap questions |
| `17-build-from-scratch-guide.md` | Step 0 → working production app, command by command | When teaching someone |
| `18-interview-cheatsheet.md` | One-page summary for the night before an interview | Day-of refresher |

## Style notes

- **Honesty over hype.** If something is *not* agentic AI, this doc calls it "structured LLM orchestration" — not "multi-agent system". You will sound much more credible in interviews this way.
- **Hinglish where it helps.** Concept names stay in English (vector embedding, JWT, RLS). Explanations use a mix so things stick.
- **No repetition.** Each topic is covered in exactly one file. Cross-references point you to the right place instead of restating.
- **Code-grounded.** Every claim is anchored to a real file path in the repo so you can verify it yourself.

## Quick orientation

If you only have 10 minutes, read these three:

1. `00-overview-what-is-aurago.md`
2. `11-end-to-end-data-flow.md`
3. `18-interview-cheatsheet.md`

Together they tell you what AuraGo is, how it works, and the exact words to use when explaining it out loud.

---

_Last updated: with the Terminal redesign (revision aurago-00049 and friends)._
