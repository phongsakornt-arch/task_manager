# Non-Task Data Connection Status

Scope: connect Supabase data for every module except task-board/task-derived views.

## Connected Modules

| Module | Tables / functions | Status |
| --- | --- | --- |
| Users | `users`, `members`, `admin-set-user-password` | Connected: list, role, active, member link, password reset |
| Directory | `members`, `committees`, `create_member`, `create_committee` | Connected: member/committee CRUD and soft delete |
| Todo | `todo_items` | Connected: personal CRUD, dashboard read for admin/super_admin |
| Budget | `budget_projects`, `budget_categories`, `budget_plans`, `budget_transactions` | Connected: project create/edit, category create, monthly plan upsert, transaction create/delete |
| Approval | `approval_documents`, `approval_approvers`, `approval_logs`, `approval_versions`, public Edge functions | Connected: internal workflow, public approval, version metadata |
| System | `system-health`, `backup-snapshot`, `list-backups`, `restore-latest-backup`, `reminder-stats`, `resync-task-calendar` | Connected to Edge function contracts |

## Excluded By Request

Task module and task-derived views are intentionally excluded for this pass:

- Task Board
- Calendar
- Annual
- Pending Tasks

## Remaining External Connections

These are intentionally provider-dependent and need secrets/provider setup before becoming real external writes:

- Google Drive binary uploads
- Google Calendar real event write/delete
- Production email delivery policy and reminder send/dedupe
- Durable backup storage and restore executor
