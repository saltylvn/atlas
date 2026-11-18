-- Ask Atlas: retrieval over your own data (RAG).
--
--   knowledge_chunks   short passages of text built from what Atlas already stores
--                      (briefs, the triaged inbox, people, tasks, goals, projects,
--                      applications, job matches, renewals). Each passage has:
--                        fts        a full-text search vector (keyword search)
--                        embedding  a 384-number vector from gte-small (search by meaning)
--   search_knowledge   one call that returns the best keyword matches and the nearest
--                      passages by meaning, each with its rank. The app fuses the two
--                      rankings (reciprocal rank fusion, lib/domain/retrieval.ts).
--
-- The passages are derived data: the indexer (lib/knowledge/indexer.ts) rebuilds them
-- from their source rows and deletes a passage when its source row is gone, so they
-- follow the same retention as the tables they come from. Embeddings are made inside
-- this project (supabase/functions/embed); no outside service sees the text.
--
-- Access is the same as every other table: the owner only, on a two-step (aal2) session.

create extension if not exists vector with schema extensions;

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('brief', 'email', 'person', 'task', 'goal', 'project', 'application', 'job', 'renewal')),
  source_id text not null check (char_length(source_id) between 1 and 200),
  chunk_index smallint not null default 0 check (chunk_index between 0 and 63),
  title text not null check (char_length(title) between 1 and 300),
  content text not null check (char_length(content) between 1 and 2000),
  -- An in-app path, built by the app from the record's kind. Never an outside link.
  href text not null check (char_length(href) <= 200 and href ~ '^/[A-Za-z0-9/_-]*$'),
  occurred_at timestamptz,
  -- Changes when the passage changes; the indexer embeds a passage again only then.
  hash text not null check (char_length(hash) between 8 and 64),
  -- Null until the passage is embedded. Keyword search works either way.
  embedding extensions.vector(384),
  fts tsvector generated always as (to_tsvector('english', title || ' ' || content)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source, source_id, chunk_index)
);

create index knowledge_chunks_fts on public.knowledge_chunks using gin (fts);
create index knowledge_chunks_embedding on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index knowledge_chunks_pending on public.knowledge_chunks (owner_id, updated_at) where embedding is null;

alter table public.knowledge_chunks enable row level security;
create policy owner_all on public.knowledge_chunks for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.knowledge_chunks from anon;
grant select, insert, update, delete on public.knowledge_chunks to authenticated;

-- ---------------------------------------------------------------------------
-- Hybrid search: keyword ranks and meaning ranks in one round trip.
--
-- Runs as the caller (security invoker), so Row Level Security applies; it also filters
-- on auth.uid() itself, so it returns nothing to a caller with no user (the secret key).
-- `terms` must be the exact shape the app builds ("word | word | word", letters and
-- digits only); anything else matches nothing instead of reaching the query parser.
create or replace function public.search_knowledge(terms text, query_embedding text default null, match_count integer default 12)
returns table (
  id uuid,
  source text,
  source_id text,
  chunk_index smallint,
  title text,
  content text,
  href text,
  occurred_at timestamptz,
  lexical_rank integer,
  semantic_rank integer,
  similarity real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select
      case when terms ~ '^[a-z0-9]+( \| [a-z0-9]+){0,15}$' then to_tsquery('english', terms) end as tsq,
      case when query_embedding is not null then query_embedding::extensions.vector(384) end as vec,
      least(greatest(coalesce(match_count, 12), 1), 30) as n,
      (select auth.uid()) as uid
  ),
  lexical as (
    select l.id, (row_number() over (order by l.score desc, l.occurred_at desc nulls last))::integer as rnk
    from (
      select c.id, c.occurred_at, ts_rank_cd(c.fts, q.tsq) as score
      from public.knowledge_chunks c cross join q
      where q.tsq is not null and c.owner_id = q.uid and c.fts @@ q.tsq
      order by score desc, c.occurred_at desc nulls last
      limit (select n from q)
    ) l
  ),
  semantic as (
    select s.id, s.dist, (row_number() over (order by s.dist))::integer as rnk
    from (
      select c.id, c.embedding operator(extensions.<=>) q.vec as dist
      from public.knowledge_chunks c cross join q
      where q.vec is not null and c.owner_id = q.uid and c.embedding is not null
      order by c.embedding operator(extensions.<=>) q.vec
      limit (select n from q)
    ) s
  )
  select c.id, c.source, c.source_id, c.chunk_index, c.title, c.content, c.href, c.occurred_at,
         l.rnk, s.rnk, (1 - s.dist)::real
  from public.knowledge_chunks c
  left join lexical l on l.id = c.id
  left join semantic s on s.id = c.id
  where c.owner_id = (select auth.uid()) and (l.id is not null or s.id is not null);
$$;

revoke all on function public.search_knowledge(text, text, integer) from public, anon;
grant execute on function public.search_knowledge(text, text, integer) to authenticated;
