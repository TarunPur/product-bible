-- Backs lib/rate-limit.ts's per-IP request throttling. Rows older than the
-- longest window in use (1 day) are deleted opportunistically on each check,
-- so this table stays small without needing a cron job.
create table rate_limit_hits (
  ip text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_hits_ip_idx on rate_limit_hits (ip, created_at);
