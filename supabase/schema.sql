create extension if not exists vector;

create table episodes (
  id uuid primary key default gen_random_uuid(),
  guest_names text[] not null,       -- parsed from actual speaker labels, not just filename
  source_filename text not null unique,
  ingested_at timestamptz not null default now()
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  chunk_index int not null,
  primary_speaker text not null,     -- guest (or Lenny) with the most content in this chunk
  speaker_names text[] not null,     -- every speaker appearing in this chunk
  start_timestamp text not null,     -- "HH:MM:SS" for display/citation
  start_seconds int not null,        -- for sorting
  content text not null,             -- speaker tags kept INLINE in the text — see lib/transcript-parser.ts
  embedding vector(1024),            -- voyage-3.5, 1024 dimensions
  unique (episode_id, chunk_index)
);
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

create table query_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,          -- anonymous client-generated UUID, no PII
  created_at timestamptz not null default now(),
  question text not null,
  answer text not null,
  confidence_band text not null,     -- 'none' | 'low' | 'high'
  citations jsonb not null,
  flagged boolean not null default false
);
create index query_logs_session_idx on query_logs (session_id, created_at);
