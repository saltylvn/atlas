-- Knowledge search for server-side jobs.
--
-- search_knowledge filters on auth.uid(), so it answers only a signed-in session. The MCP
-- server, the night shift and the agents run on the secret key, where auth.uid() is null,
-- so every search from them came back empty (search_material, the Tailor's and the Coach's
-- proof lookups). This function is the same search, scoped to an owner id the caller
-- passes. Only the service role may call it: the secret key already reads every row, so
-- it grants nothing new, and signed-in users and anonymous callers cannot reach it.
--
-- Additive and safe to re-run: create or replace, then the grants.

create or replace function public.search_knowledge_for_owner(
  owner uuid,
  terms text,
  query_embedding text default null,
  match_count integer default 12,
  sources text[] default null,
  since timestamptz default null,
  until timestamptz default null
)
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
      owner as uid
  ),
  scope as (
    select c.id, c.fts, c.embedding, c.occurred_at
    from public.knowledge_chunks c cross join q
    where q.uid is not null and c.owner_id = q.uid
      and (sources is null or c.source = any (sources))
      and (since is null or c.occurred_at >= since)
      and (until is null or c.occurred_at < until)
  ),
  lexical as (
    select l.id, (row_number() over (order by l.score desc, l.occurred_at desc nulls last))::integer as rnk
    from (
      select c.id, c.occurred_at, ts_rank_cd(c.fts, q.tsq) as score
      from scope c cross join q
      where q.tsq is not null and c.fts @@ q.tsq
      order by score desc, c.occurred_at desc nulls last
      limit (select n from q)
    ) l
  ),
  semantic as (
    select s.id, s.dist, (row_number() over (order by s.dist))::integer as rnk
    from (
      select c.id, c.embedding operator(extensions.<=>) q.vec as dist
      from scope c cross join q
      where q.vec is not null and c.embedding is not null
      order by c.embedding operator(extensions.<=>) q.vec
      limit (select n from q)
    ) s
  )
  select c.id, c.source, c.source_id, c.chunk_index, c.title, c.content, c.href, c.occurred_at,
         l.rnk, s.rnk, (1 - s.dist)::real
  from public.knowledge_chunks c
  left join lexical l on l.id = c.id
  left join semantic s on s.id = c.id
  where c.owner_id = owner and (l.id is not null or s.id is not null);
$$;

revoke all on function public.search_knowledge_for_owner(uuid, text, text, integer, text[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.search_knowledge_for_owner(uuid, text, text, integer, text[], timestamptz, timestamptz) to service_role;
