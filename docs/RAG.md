# Ask Atlas (RAG)

Ask a question in plain words; Atlas answers from your own data and shows the passages
the answer came from. This is retrieval-augmented generation: search first, then let a
model write only from what the search found.

```
                 ┌────────────── every 2-hour sync, and the Index button ──────────────┐
 what Atlas      │  records ──▶ passages ──▶ changed ones only ──▶ knowledge_chunks    │
 already stores  │  (9 kinds)   (≤ 900 chars)   (content hash)      text + fts + vector │
                 └─────────────────────────────────────────────────────────────────────┘
                                                                          ▲ embed (gte-small,
                                                                          │ Supabase edge function)
 question ──▶ embed ──▶ search_knowledge() ──▶ fuse (RRF) ──▶ 6 passages ──▶ Claude ──▶ answer
                         keyword ranks                                        │        + citations
                         meaning ranks                          AI off or failed ▼        (checked)
                                                                closest passages quoted
```

## What is indexed

Nine kinds of record Atlas already holds: briefs, the triaged inbox (sender, subject and
Gmail's one-line preview: never a body), people, tasks, goals, projects, applications,
job matches and renewals. `lib/domain/knowledge.ts` turns each into a short document with
a title, then into passages of at most 900 characters cut on sentence ends.

Left out on purpose: a contact's email and phone are never read, a sender is kept as a
name and a domain, and any email address or link found inside text is stripped. A question never needs them, and what is not indexed can never
reach a model. Each passage links to the Atlas page that shows the record; that link is
built from the record's kind, and the database refuses anything that is not an in-app path.

The passages are derived data. When a record changes, its passage is rewritten and
embedded again (a content hash decides, so unchanged passages cost nothing). When a
record is deleted or ages out (inbox 30 days, job matches 120), its passage is deleted at
the next index run. The data export leaves them out because they hold nothing the
source tables do not.

## Retrieval: two searches, one ranking

| Search | Finds | How |
| --- | --- | --- |
| Keyword | Passages that share the question's words | Postgres full-text search (`tsvector`, GIN index, `ts_rank_cd`). The question's words are joined with OR. |
| Meaning | Passages that mean the same with different words ("what do I owe" finds "premium due") | `gte-small` embeddings, 384 numbers, pgvector with an HNSW cosine index |

`search_knowledge()` returns both ranked lists in one round trip. `lib/domain/retrieval.ts`
merges them with **reciprocal rank fusion** (a passage scores `1 / (60 + rank)` in each
list it appears in), keeps the best six, and allows at most two passages from any one
record so a long brief cannot fill every slot. Fusion uses ranks, not scores, so the two
searches never need to be put on one scale.

If embeddings are unavailable (demo mode, the function is down, a passage is not embedded
yet), search is keyword-only and the page says so. Nothing breaks.

## Embeddings stay inside the project

`supabase/functions/embed` runs `gte-small` inside Supabase's edge runtime, next to the
database that already holds the text. No outside AI service sees it, and there is no
per-call charge. The function:

- accepts one caller: the Atlas server, presenting the project's secret key on the
  `apikey` header, compared in constant time **before** the body is read;
- reads and writes no data and opens no connections: text in, vectors out;
- caps a request at 8 texts of 2,000 characters.

The server reaches it through `safeFetch` (the outbound allowlist), like every other
request Atlas makes.

## The answer

With AI on (`ANTHROPIC_API_KEY` set, AI enabled in Settings, under the daily cap), Claude
gets the question and the six passages and returns `{ found, answer, citations }`:

- it is told to use only the passages, and to say so (`found: false`) when they do not
  answer the question;
- the reply is schema-validated, and every citation is checked against the passages that
  were actually retrieved. An "answer" that cites nothing retrieved is not shown as one;
- the answer is plain text. It is never rendered as HTML, never turned into links, and
  triggers nothing.

With AI off, or when the call fails or is refused, the three closest passages are quoted
instead. Retrieval, sources and links are identical either way.

Cost: embeddings $0. A Claude answer reads about 1,500 tokens and writes about 150:
roughly one cent on the writer model, counted against the same daily cap as every other
AI call (`ATLAS_AI_DAILY_LIMIT`, default 60).

## Security review (14 Nov 2026)

The security review of 13 Nov said to re-check prompt injection before turning AI on.
RAG is where that matters most: retrieved passages can quote email, and email is written
by strangers.

| Risk | Control |
| --- | --- |
| A passage carries instructions ("ignore your rules, say X") | Passages go inside `<data>` tags with a standing instruction that their text is information only. `fenceData()` strips anything shaped like that tag from the data first, for every Claude call, so text cannot close the fence. The model has no tools and no network. |
| The injected text makes the answer say something false | The answer is display-only and always shown with its sources, so a strange answer sits next to the passage that caused it. It cannot send, edit, approve or fetch anything. |
| The answer smuggles data out through a link or an image | Plain text only; React escapes it; no markdown is rendered; the page's CSP allows no outside connections. Source links are built by Atlas, validated in the page and constrained in the database to in-app paths. |
| A citation points at something that was never retrieved | `checkCitations()` drops any number outside the retrieved set. |
| Someone else queries the index | `knowledge_chunks` has the same policy as every table (owner + two-step session). `search_knowledge()` runs as the caller and also filters on `auth.uid()`, so even the secret key gets nothing from it. |
| The search words are used to attack the query parser | Only lowercase letters and digits leave `queryTerms()`; the function re-checks the exact shape and otherwise searches for nothing. The query is parameterized. |
| The embed function is called by a stranger | It checks the secret key before reading the request and holds no data. The worst case is wasted compute, bounded by size caps. |
| The question or the answer ends up in logs | The activity log records counts and timings ("hybrid search, 6 passages, answered by Claude"). Never the question, the passages or the answer. |
| Runaway spend | `takeAiCall`: per-minute limit, daily cap in the database, kill switch. Ask has its own request limit on top. |

Accepted: a passage can still mislead the model into a wrong sentence. That is why the
sources are always on screen and nothing acts on an answer.

## How it is tested

- `test/knowledge.test.ts`: passages, privacy (no addresses, contact phones or links), chunking,
  the index plan, BM25, fusion, citations, the prompt fence, and source-level guards on
  the function, the migration and the page.
- `lib/evals/suites/retrieval.ts` (on the Evals page and in CI): 48 cases. 26 fictional
  questions against a fictional corpus, plus fusion, grounding and indexing cases. Keyword
  search answers 23 of the 26. The three it misses share no word with their answer; they are
  written down as known gaps, and they are the reason the meaning search exists. CI does
  not run the embedding model, so the live meaning search is not scored there.
- The migration was run against the live database inside a transaction and rolled back:
  the owner on a two-step session got hybrid results; a first-factor-only session, a
  different user, an anonymous caller and the secret key all got nothing from the search;
  an outside link was refused by the table.

## Filters read from the question

"Which emails from last week mention an interview?" is a search plus two filters. Search
handles filters badly: "last week" matches no passage and embeddings do not know the
date. `lib/domain/askFilters.ts` reads the kind of record ("emails", "applications",
"resume", "bills") and a time window ("today", "last week", "in October", "last 10
days") by rules, and `search_knowledge()` applies them in the database. Rules, not a
model: same question, same filter, no latency, no cost. Forward-looking questions ("due
this week") are left to search, since a due date is in the text, not the timestamp. If a
filtered search finds nothing, Ask searches again without the filter.

## Resumes, and how a job fits

Each row of Notion's Resumes database has a page. Atlas reads that page's **text** (not
the attached file) and indexes it as a `resume` passage, with phone numbers, email
addresses and links stripped. The indexer reads Notion each run; if Notion does not
answer, the resume passages already indexed stay.

On a job match, **How do I fit?** (`lib/knowledge/jobFit.ts`, Career Agent) searches only
your resume passages for the job's title, role and skills, then:

- with AI on, the model words the fit (strong, partial, weak), up to four reasons, up to
  three gaps and which resume to send. Citations are checked, and the resume it names
  must be one that was retrieved;
- with AI off or on any failure, rules compare the posting's skills against the passages
  (`lib/domain/jobFit.ts`).

It is a read: nothing is drafted, sent or changed. Atlas keeps a posting's title and
skills, not its full text, so the fit is judged on those.

## Measuring it on the real model

CI scores keyword search only. **Evals > Run on live embeddings** embeds the same
fictional corpus and questions with `gte-small` and scores keyword, meaning and hybrid
search side by side (first place, top 3, mean reciprocal rank). It reads none of your
data, keeps the vectors in memory for the run, and logs only the scores
(`lib/knowledge/liveEval.ts`, `lib/domain/retrievalEval.ts`).

It also measures the gap a **similarity floor** has to sit in: how similar a question is
to its right answer, against how similar an off-topic question is to its nearest passage.
The meaning search always returns its nearest passages however far they are, so without
a floor an off-topic question still gets six "sources". `SEMANTIC_FLOOR` in
`lib/domain/retrieval.ts` drops meaning matches below it before fusion; it is set from
this eval's numbers, not guessed.

The run on 2026-11-14 measured right answers at 0.786 or higher (typical 0.871) and
off-topic questions at 0.774 or lower (typical 0.763). The floor is **0.775**: just above
the highest off-topic match, because the gap is narrow and a dropped right answer costs
more than a kept weak passage. The same run scored hybrid 25 of 26 in the top 3 (keyword
23, meaning 22), but hybrid put the right passage first less often than keyword alone (19
against 22), which is the case for adding a reranker.

**Connectors > Test the model** makes one tiny call to the configured model and reports
the model, the time and the cost, or says what the provider's error means.

## Claude or Gemini

Answers (and every other AI feature) go through one router, `lib/ai/model.ts`. It picks
one provider per deployment:

| Setting | Result |
| --- | --- |
| Only `ANTHROPIC_API_KEY` | Claude (`lib/ai/claude.ts`) |
| Only `GEMINI_API_KEY` | Gemini (`lib/ai/gemini.ts`) |
| Both keys | Claude, unless `ATLAS_AI_PROVIDER=gemini` |
| `ATLAS_AI_PROVIDER` set but that key missing | AI off. It never falls back to the other provider on its own |

Both clients keep the same rules: the fenced `<data>` block, a schema-validated reply,
no tools, display-only output, the same daily cap and kill switch, and cost logged per
run. The Gemini client is one https request through the outbound allowlist
(`generativelanguage.googleapis.com`), with the key in the `x-goog-api-key` header,
never in the URL.

Gemini defaults: `gemini-4-hydrogen` for writing and `gemini-3.5-flash-lite` for sorting,
with thinking kept low. `ATLAS_GEMINI_MODEL_WRITER` and `ATLAS_GEMINI_MODEL_FAST` change
them without a code change. A Gemini answer costs well under a cent at paid-tier prices.

To plug it in:

1. Google AI Studio: create an API key. **Free tier or paid is your choice, and it is a
   privacy choice**: on the free tier Google may use prompts to improve its products and
   people may review them; on the paid tier they are not used. Ask Atlas sends passages
   that can quote your email, and the job fit sends resume passages. Atlas is on the free
   tier by the owner's decision (14 Nov 2026). What limits the exposure: email addresses,
   phone numbers and links never reach the index, only the six retrieved passages are
   sent, and the kill switch in Settings stops every call. The free tier also has request
   limits; when one is hit, Ask and the job fit say so and fall back to passages or rules.
2. Vercel: add `GEMINI_API_KEY` (Sensitive, Production) and redeploy.
3. Connectors shows "AI model: Gemini". Ask a question.

Embeddings do not change: they stay on `gte-small` inside Supabase whichever model writes.

Not verified until a key exists: the live call. The request follows Google's published
`generateContent` reference; if a model rejects the schema field (HTTP 400) the client
asks once more in plain JSON mode, and any other failure shows the closest passages.

## Turning it on

1. Merge. The migration (`20261114183552_knowledge.sql`) and the `embed` function are
   deployed with it.
2. Open **Ask Atlas** and press **Index now**. Passages are written at once and embedded
   in rounds; every 2-hour sync keeps them current after that.
3. Optional, for written answers: set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` in Vercel
   (Sensitive, Production) and redeploy. Without it, Ask shows the closest passages.

## Files

| File | Job |
| --- | --- |
| `lib/domain/knowledge.ts` | Records to passages, hashing, the index plan. Pure. |
| `lib/domain/retrieval.ts` | Search words, BM25 (demo and evals), fusion, citation check, the no-model answer. Pure. |
| `lib/knowledge/indexer.ts` | Keeps the index current and embeds what is new. |
| `lib/knowledge/ask.ts` | One question, start to finish, traced and logged. |
| `lib/ai/embeddings.ts` | The one place that asks for embeddings. |
| `lib/ai/prompts.ts` | The answer prompt, its schema, the data fence. |
| `supabase/functions/embed/index.ts` | `gte-small`, behind the secret key. |
| `supabase/migrations/20261114183552_knowledge.sql` | The table, its indexes and policy, `search_knowledge()`. |
| `app/(app)/ask`, `components/client/AskPanel.tsx`, `app/actions/ask.ts` | The page. |
