-- cleanup: debug_cron_status / debug_net_responses were only added to
-- diagnose why the 07:00 daily-task-reminder push wasn't arriving; not
-- used by the app
DROP FUNCTION IF EXISTS debug_cron_status();
DROP FUNCTION IF EXISTS debug_net_responses();
