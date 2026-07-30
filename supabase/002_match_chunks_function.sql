-- Vector similarity search isn't expressible through plain PostgREST calls —
-- this function does the actual pgvector nearest-neighbor query. Returns
-- cosine similarity (1 - cosine distance) so the retrieval-confidence gate in
-- lib/retrieval.ts can work with an intuitive 0-1 score.
create or replace function match_chunks(
  query_embedding vector(1024),
  match_count int default 10
)
returns table (
  id uuid,
  episode_id uuid,
  primary_speaker text,
  speaker_names text[],
  start_timestamp text,
  start_seconds int,
  content text,
  similarity float
)
language sql stable
as $$
  select
    chunks.id,
    chunks.episode_id,
    chunks.primary_speaker,
    chunks.speaker_names,
    chunks.start_timestamp,
    chunks.start_seconds,
    chunks.content,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;
