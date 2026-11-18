-- Ask Atlas, part 2: resumes as a source, and search filters.
--
--   'resume'            the text of each resume row's page in Notion's Resumes database
--                       (contact details stripped), so a job can be matched to evidence.
--   search_knowledge    gains three optional filters: which kinds of record to search,
--                       and a time window on when the record happened. The app derives
--                       them from the question ("emails from last week") with rules.
--
-- The function is replaced, not added to: the old three-argument form is dropped so
-- there is exactly one way to search. Every guard from the first version is kept.

alter table public.knowledge_chunks drop constraint knowledge_chunks_source_check;
alter table public.knowledge_chunks add constraint knowledge_chunks_source_check
  check (source in ('brief', 'email', 'person', 'task', 'goal', 'project', 'application', 'job', 'renewal', 'resume'));

drop function public.search_knowledge(text, text, integer);

create function public.search_knowledge(
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
      (select auth.uid()) as uid
  ),
  scope as (
    select c.id, c.fts, c.embedding, c.occurred_at
    from public.knowledge_chunks c cross join q
    where c.owner_id = q.uid
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
  where c.owner_id = (select auth.uid()) and (l.id is not null or s.id is not null);
$$;

revoke all on function public.search_knowledge(text, text, integer, text[], timestamptz, timestamptz) from public, anon;
grant execute on function public.search_knowledge(text, text, integer, text[], timestamptz, timestamptz) to authenticated;
