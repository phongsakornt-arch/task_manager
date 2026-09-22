-- ============================================================
-- Schedule daily-task-reminder (email preview + push notifications)
-- to run once a day at 07:00 Bangkok time (00:00 UTC)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'daily-task-reminder',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://quyntrtlfszwkhbuyylr.supabase.co/functions/v1/daily-task-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '7e711f6a1a9167e39cfcaf0277d737e5cc81893831856ed2'
    ),
    body := '{}'::jsonb
  );
  $$
);
