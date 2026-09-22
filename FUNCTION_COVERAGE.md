# Function Coverage

เอกสารนี้เทียบงานจาก `function.md` กับ React + Supabase ที่มีในโปรเจคปัจจุบัน เพื่อใช้เดินงานต่อโดยไม่ต้องไล่ถามทีละฟังก์ชัน

## ทำแล้วในแอป

- Auth/session: ใช้ Supabase Auth + ตาราง `users` สำหรับ role/active/member mapping แทน session token ของ Apps Script
- Permission: แยกสิทธิ์ `member`, `editor`, `admin`, `super_admin` ใน `src/lib/permissions.ts`
- Task board: CRUD, complete/reopen, soft delete/restore, drag section, parent/subtask move, assignment, checklist, activity log, 24-hour time input, section add/reorder UI
- Task modal: attachment link metadata, Drive folder URL metadata, email preview/send hook, calendar sync hook
- Pending: โหลด view `pending_tasks` พร้อม filter/search/export CSV/PDF ฝั่ง UI
- Calendar: month/week/day/agenda จาก task date/time และ task ที่ยังไม่มีวัน
- Annual: yearly/monthly/quarterly task planning view พร้อม filter และ print report
- Directory: committee/member management สำหรับ admin+
- Users: user role/active/member management สำหรับ super_admin
- System: admin health check, backup snapshot/list/restore contract, reminder stats, calendar resync dry-run/queue
- Todo: personal todo, pin/priority/due date/time, complete/reopen, soft delete, super_admin dashboard
- Budget: bootstrap project/category/plan/transaction, totals, create/delete transaction, CSV/PDF export, role guard
- Approval internal: document draft/pending/approved/revision/cancelled, approver chain, internal action, logs, public link panel, new version UI
- Approval public: `/approval/public?approvalId=...&approverId=...&token=...` สำหรับ public approver token

## ทำแล้วเป็น Supabase Edge Function

- `app-meta`: app/env/provider readiness metadata
- `send-task-email`: manual task email via Resend when configured, otherwise preview/log
- `sync-task-calendar`: build calendar payload/hash and update sync status without Google write
- `resync-task-calendar`: admin+ bulk calendar payload preparation
- `daily-task-reminder`: reminder preview for tomorrow tasks guarded by `CRON_SECRET`
- `reminder-stats`: reminder candidate/handled/pending counts
- `approval-links`: generate public approver links from per-approver tokens
- `approval-public-data`: public token document payload
- `approval-public-action`: public approve/revision action with current-approver validation
- `upload-approval-version`: new approval file/version metadata and approver reset
- `system-health`: admin+ system/config count health
- `backup-snapshot`: admin+ JSON snapshot response and manifest log
- `list-backups`: admin+ backup manifest list from `activity_log`
- `restore-latest-backup`: admin+ restore contract endpoint, intentionally disabled until storage/restore policy is finalized

## ยังเหลือก่อนเชื่อมต่อภายนอก

- Section edit/deactivate UI beyond add/reorder
- Approval report PDF/export summary
- Task attachment upload validation: max 8MB and MIME allowlist
- Task file upload UI/storage flow before Drive provider is attached
- Durable backup storage target and restore executor

## รอ provider ภายนอก

- Google Drive folder/file upload and real Drive file metadata
- Google Calendar create/update/delete event and event URL
- Real email delivery policy, sender domain, and daily reminder dedupe/send mode
- Public production base URL via `PUBLIC_SITE_URL`

## ตั้งใจเปลี่ยนจากระบบเก่า

- ไม่ใช้ password ใน sheet เดิม เพราะ Supabase Auth เป็นตัวจัดการ login
- ไม่ใช้ Apps Script cache/session/page bridge แล้ว แทนด้วย direct Supabase query, RLS, realtime, and Edge Functions
- Public approval ใช้ per-approver token ตาม migration note แทน doc-level token แบบเก่า
