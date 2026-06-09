# 09 · RAG, retrieval, and embeddings — the honest picture

This file describes what retrieval looks like in AuraGo today. The honest summary: **Serper plays the role of retrieval; the pgvector store is dormant.** Knowing this clearly is important — interviewers will ask, and there's a clean story to tell.

## What "RAG" usually means

Retrieval-Augmented Generation typically means:

1. You have a knowledge corpus (PDFs, blog posts, scraped pages…).
2. You chunk each document into 200–1000-token pieces.
3. You compute an embedding vector for each chunk and store it in a vector DB (Pinecone, Weaviate, pgvector, Chroma…).
4. At query time, you embed the user's query, find the top-K similar chunks, and stuff them into the LLM's prompt as context.

The LLM then **generates** a response augmented by those **retrieved** chunks — hence RAG.

## What AuraGo does instead

AuraGo skips steps 1–3 entirely. Instead, at the moment the user asks for something, we **query Google in real time via Serper** and feed those snippets straight into the LLM:

```
User asks for Vrindavan plan
         │
         ▼
Serper("Vrindavan travel advisory 2025")    ←─┐
Serper("Vrindavan weather closure recent")  ←─┤  the "retrieval" step
Serper("Vrindavan wheelchair access")       ←─┘
         │
         ▼  organic results: { title, snippet, link, date }
Groq ragVerify prompt with snippets injected
         │
         ▼
verdict + reason + citations URLs
```

This is **conceptually RAG** — we retrieve external info and the LLM uses it. The differences:

| Classic RAG | AuraGo's "live web RAG" |
|---|---|
| Embeds a static corpus once, queries against it | Queries Google live every time |
| Knowledge is whatever you indexed | Knowledge is whatever Google knows today |
| Setup cost: high (chunk + embed + store) | Setup cost: an API key |
| Freshness: stale by however long since you re-indexed | Freshness: minutes |
| Cost per query: ~₹0 after setup | ~$0.002 per Serper query |
| Works offline | Requires internet |

For a travel app, freshness matters more than corpus control. A travel advisory updated yesterday is more valuable than a curated 6-month-old article. Serper gives us that for free.

## Where retrieval is used

| Place in code | Why we retrieve | Number of Serper calls |
|---|---|---|
| `ragVerify` (expand-card) | Validate the destination isn't currently unsafe or closed | 2-4 |
| `replanWeather` | Get today's forecast for the destination | 1 |
| `checkPrices` | Get current flight / train / hotel ranges | 3 (parallel) |
| `serperImages` | Fetch 6 photos for the destination gallery | 1 |
| `directTrip` | Same as expand-card after the synthetic deck step | 2-4 |

That's it. No other place retrieves.

## The pgvector table is intentionally dormant

`public.rag_documents` is declared with a `vector(768)` column. The IVFFlat index is created. But **no rows are written**.

Why? Three reasons:

1. **Groq has no embedding API.** They host Llama 3.3 70B for chat completions, but no `text-embedding` endpoint.
2. **We chose not to wire a separate embedding provider** (e.g., OpenAI's `text-embedding-3-small`, Cohere, Voyage). Doing so means a second vendor bill, a second key to rotate, and a second source of latency.
3. **We didn't have a static corpus that would benefit.** AuraGo doesn't have a knowledge base of curated travel articles — destinations change, prices change, advisories change. Embedding a corpus that goes stale in weeks is wasted effort.

The day we have **stable knowledge** worth embedding (e.g., AuraGo's own past trip plans, locked itineraries that other users could learn from), we'll wire it up. See `16-future-improvements.md` for that roadmap.

## What "embeddings" would look like if we used them

If we added them today, the natural pieces would be:

| Corpus | Why embed | How |
|---|---|---|
| Every **locked trip** | "Find users who planned similar trips" | One vector per `public.trips` row, embedding `destination + vibe + days + budget + activities` |
| User's **profile + history** | "Suggest a trip based on what they've liked" | One vector per user, periodically refreshed |
| **Concierge Q&A history** | "Answer 'best food in Hampi' using past answers" | One vector per QA pair, with dedup |
| **Verified guide writeups** (Lonely Planet / Wikivoyage / blog) | Real classic RAG over destinations | Many vectors per destination |

We'd embed with `text-embedding-3-small` (1536 dim, ~$0.02 per million tokens) or Cohere's free tier. Store in `rag_documents`. Query with `match_rag_documents` (RPC already defined in `01_supabase_schema.sql`).

## The `match_rag_documents` SQL function (ready to use)

Already defined for future use:

```sql
create or replace function public.match_rag_documents(
  query_embedding vector(768),
  match_destination text default null,
  match_count int default 6
)
returns table (id, destination, source_url, chunk, similarity, metadata)
language sql stable as $$
  select id, destination, source_url, chunk,
         1 - (embedding <=> query_embedding) as similarity,
         metadata
  from public.rag_documents
  where match_destination is null or destination = match_destination
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

Cosine distance (`<=>`) on IVFFlat index. Filter optional. Wired and ready — just needs rows.

## Why we still call this "RAG" in product copy

Internally we're rigorous: "live web verification + LLM extraction".

But in the UI, the "Live verified" chip with citation URLs feels indistinguishable from classic RAG to the user. Calling our flow "RAG" in casual conversation is fine; in interviews, be precise.

## What semantic search looks like in AuraGo

Today: **none.**

You cannot search "trips like this" or "destinations matching this vibe" against any embedding store. The closest thing is the LLM-generated `similar_destinations` array inside each itinerary — but that's regenerated per trip and not searchable across users.

This is one of the highest-leverage future improvements (see `16-future-improvements.md`).

## Vocabulary cheat-sheet for interviews

| Term | What it means in industry | What it means in AuraGo |
|---|---|---|
| **Embedding** | A numerical vector representing semantic content | Defined in schema; not populated |
| **Vector DB** | A database optimised for similarity queries | pgvector inside Supabase — installed, not used |
| **Semantic search** | Searching by meaning rather than keywords | Not implemented |
| **Retrieval** | The "R" of RAG — finding relevant context | Done via Serper (Google Search) not vector DB |
| **RAG** | Generation augmented by retrieved context | Loosely yes — live web snippets instead of vectors |
| **Reranking** | Re-ordering retrieved chunks by quality | Not implemented |
| **Indexing** | Pre-computing embeddings for fast lookup | Not done |

If you can speak this table in an interview, you'll come across as someone who really understands what they built — including what they chose not to build, and why.

---

**Next file:** `10-memory-and-state.md` — where context lives, and why we don't have agent memory yet.
