# Edge Function Surface

Prepared before connecting external providers.

| Function | Purpose | External provider status |
| --- | --- | --- |
| `send-task-email` | Manual task email to assignees, with HTML preview and activity log | Sends only when `RESEND_API_KEY` is configured |
| `daily-task-reminder` | Finds tomorrow tasks and prepares reminder previews | Sending intentionally not enabled yet |
| `sync-task-calendar` | Creates/patches/deletes one task on the central YEC Google Calendar only | Requires `GOOGLE_SERVICE_ACCOUNT_JSON`; calendar is locked to `YEC@thaichamber.org` |
| `resync-task-calendar` | Prepares calendar payloads for many active tasks | Queues/preview only |
| `approval-links` | Generates per-approver public URLs from existing tokens | No external provider |
| `approval-public-action` | Validates token and records approve/revision action | No external provider |
| `system-health` | Checks table access/counts and env readiness | No external provider |
| `backup-snapshot` | Generates JSON snapshot response for core tables | Storage persistence intentionally not enabled yet |
| `app-meta` | App/environment metadata | No external provider |
| `admin-set-user-password` | Super Admin sets or resets a user's password through Supabase Admin API | No external provider |
| `reminder-stats` | Reminder candidate and handled counts | No external provider |
| `approval-public-data` | Public approver page payload by token | No external provider |
| `upload-approval-version` | Adds approval version metadata and resets document to draft | File upload persistence intentionally not enabled yet |
| `drive-bridge` | Calls Apps Script Drive bridge for task folder creation and file upload | Requires Apps Script web app URL and shared secret |
| `list-backups` | Lists backup manifests from activity log | Durable backup storage intentionally not enabled yet |
| `restore-latest-backup` | Restore endpoint contract | Execution intentionally disabled |

Expected secrets when providers are connected:

- `RESEND_API_KEY`
- `TASK_EMAIL_FROM`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_CALENDAR_ID`
- `DRIVE_BRIDGE_URL`
- `DRIVE_BRIDGE_SECRET`
- `PUBLIC_SITE_URL`
- `CRON_SECRET`
