DROP FUNCTION IF EXISTS debug_cron_status();
CREATE OR REPLACE FUNCTION debug_cron_status()
RETURNS TABLE (
  start_time timestamptz,
  status text,
  return_message text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, cron AS $$
  SELECT d.start_time, d.status, d.return_message
  FROM cron.job j
  JOIN cron.job_run_details d ON d.jobid = j.jobid
  WHERE j.jobname = 'daily-task-reminder'
  ORDER BY d.start_time DESC
  LIMIT 10;
$$;
GRANT EXECUTE ON FUNCTION debug_cron_status() TO service_role;

CREATE OR REPLACE FUNCTION debug_net_responses()
RETURNS TABLE (
  id bigint,
  status_code int,
  content text,
  "timeout" boolean,
  error_msg text,
  created timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, net AS $$
  SELECT r.id, r.status_code, left(r.content, 300), r.timed_out, r.error_msg, r.created
  FROM net._http_response r
  ORDER BY r.created DESC
  LIMIT 10;
$$;
GRANT EXECUTE ON FUNCTION debug_net_responses() TO service_role;
