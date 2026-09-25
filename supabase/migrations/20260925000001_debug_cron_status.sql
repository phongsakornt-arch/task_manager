-- temporary debug helper to inspect pg_cron job + run history via REST
-- (cron schema isn't exposed to PostgREST directly)
CREATE OR REPLACE FUNCTION debug_cron_status()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  last_run timestamptz,
  last_status text,
  last_return_message text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, cron AS $$
  SELECT j.jobid, j.jobname, j.schedule, j.active,
         d.start_time, d.status, d.return_message
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT start_time, status, return_message
    FROM cron.job_run_details
    WHERE jobid = j.jobid
    ORDER BY start_time DESC
    LIMIT 1
  ) d ON true
  WHERE j.jobname = 'daily-task-reminder';
$$;
GRANT EXECUTE ON FUNCTION debug_cron_status() TO service_role;
