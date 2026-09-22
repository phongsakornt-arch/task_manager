# Old Data Function Audit

อ้างอิงจาก `old data/code.gs.txt`, `old data/index.txt`, และ `old data/function.md`

## Inventory

- Server Apps Script functions: ประมาณ 280+ รายการ
- Client functions: ประมาณ 240+ รายการ
- กลุ่มหลักที่ต้อง migrate คือ API bridge, Task Board, Drive/attachment, Calendar/email/reminder, User/member, Approval, Budget, Todo, Backup/system, Export/report

## Covered / Replaced

- Auth/session: แทนด้วย Supabase Auth + `users` role/active
- Bootstrap/data loading: แทนด้วย Supabase query, route-level lazy loading, realtime task hook
- Task CRUD: create/update/complete/delete/restore, parent/subtask, activity log, section add/reorder
- Pending: filter, due buckets, CSV/PDF export
- Calendar UI: month/week/day/agenda
- Annual: yearly planning + print report
- Directory/users: member, committee, user role/active management
- Todo: owner list, super_admin dashboard, quick create/patch/complete/delete
- Budget: load, totals, transaction create/delete, CSV/PDF export
- Approval: internal workflow, public approval, links, logs, new version, report PDF
- System: health, backup snapshot/list/restore contract, reminder stats, calendar resync queue/dry-run

## Still Missing Or Partial

- Full file upload flow for task/approval files: current UI validates task files but does not persist binary storage yet
- Google Drive folder/file operations: `createTaskDriveFolder_`, `processAttachments_`, `uploadApprovalFile_`
- Google Calendar real write/delete/invite delivery: current functions prepare payload/status only
- Email production delivery policy and daily reminder send/dedupe: current functions support preview/send surfaces but provider setup remains
- Durable backup storage and restore executor: snapshot downloads JSON, restore endpoint is intentionally disabled
- Setup sheet functions: replaced by migrations, but admin UI does not run setup/seed functions
- Fine-grained task paging/cache controls from old UI: replaced by Supabase query/realtime; can add “load completed/all” controls if needed
- Section edit/deactivate beyond add/reorder

## Newly Recovered From Old Client Functions

- `shareTaskToLine`: restored as task modal `Copy LINE`
- `handleFiles`: restored as 8MB/MIME validation surface in task modal
- `exportApprovalReportPdf`: restored as Approval `Report PDF`
