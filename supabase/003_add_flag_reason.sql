-- Distinguishes WHY a query_logs row was flagged. Previously `flagged` was
-- a single boolean shared by both profanity blocks and injection-attempt
-- regex matches, indistinguishable from each other without also inspecting
-- the answer text. Additive and nullable — safe to run against existing
-- rows, no backfill needed.
alter table query_logs add column flag_reason text;
alter table query_logs add constraint query_logs_flag_reason_check
  check (flag_reason is null or flag_reason in ('profanity', 'injection_attempt'));
