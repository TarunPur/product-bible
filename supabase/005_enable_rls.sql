-- Defense-in-depth: every Supabase call in this app uses the service-role
-- key, which bypasses RLS entirely, so this doesn't change current
-- behavior. It exists so that if a future code path ever used the anon key
-- instead (a stray client-side call, a misconfigured env var), the default
-- is "no access" rather than every row in every table — including real
-- question/answer history in query_logs — being world-readable/writable.
-- No policies are added deliberately: nothing should ever read these
-- tables except the service role.
alter table episodes enable row level security;
alter table chunks enable row level security;
alter table query_logs enable row level security;
alter table rate_limit_hits enable row level security;
