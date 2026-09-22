# PROJECT RECHECK CHECKLIST

Last updated: 2026-05-11 Asia/Bangkok

This is the central recheck checklist for the next work session before full external integrations and production deployment.

## Latest Status

- Task Modal now opens existing tasks in detail/read-only mode first, with an Edit button for edit mode.
- Task Modal staff owner field now uses the users module and supports multiple staff users.
- Task Modal committee/participant field now supports committees and individual members from the members module.
- LINE message button now has click feedback, clipboard copy, and preview.
- Google Calendar invite button opens Google Calendar with task details and guest emails.
- YEC central calendar sync button invokes the Edge Function. Real sync still requires GOOGLE_SERVICE_ACCOUNT_JSON.
- Remote Supabase has GOOGLE_CALENDAR_ID=YEC@thaichamber.org set.
- Pending page layout has been improved: title is prominent, and due/staff/committee info is combined into one line.
- Pending PDF export is A4 portrait.
- Pending PDF export has summary total cards removed.
- Pending PDF task time badge, such as today/overdue, is now placed at the top-right of each task card.
- Task Detail Modal highlights date and time more clearly.
- Annual Plan dashboard now shows all 4 quarters again.
- Annual Plan dashboard now stacks quarters vertically with 3 month columns per quarter, matching the old dashboard arrangement.
- Annual Plan task type filter now supports multiple selected types.
- Annual Plan task titles now wrap to additional lines instead of being clipped.
- Annual Plan print/export is now A4 landscape with a modern report header.
- Annual Plan report now uses a dedicated 12-month print layout, matching the old report arrangement while keeping the new visual style.
- Annual Plan report print CSS now unlocks height/overflow and uses print-only markup to avoid printing only the first page.
- Annual Plan filter panel can now collapse into a compact summary bar.
- Budget page layout has been compacted to better fit one viewport: smaller summary cards, tighter filters, shorter project cards, and internal scrolling for project/detail columns.
- Budget functions restored from old module: project detail now has plan/actual/compare monthly table by accounting category.
- Budget CSV export now exports plan vs actual monthly rows instead of only project summary.
- Budget project CSV now exports category totals and monthly plan/actual columns.
- Budget PDF export now has modern overview and project reports with KPI header, monthly summary, and plan/actual comparison.
- Budget transaction form now supports receipt/document URL, and transaction list shows an open-file link when present.
- Budget page Thai labels were cleaned in the rewritten Budget page.
- Budget detail panel readability improved again: replaced dense monthly table with readable accounting-category cards showing plan, actual, variance, and active month chips.
- Budget main-code filter now only shows 4154 and 7153.
- npm.cmd run lint passes.
- npm.cmd run build passes.
- Vite bundle warning remains. It is not blocking now and can be handled in the performance pass.

## Priority 1: Task Modal

- Recheck all Task Modal copy. Some Thai text may still be mojibake and must be cleaned.
- Recheck read-only mode so it shows only useful detail and does not feel crowded.
- Recheck edit mode saves every field correctly.
- Recheck clearing start date, end date, start time, and end time.
- Recheck every attachment can be opened from task detail.
- Recheck multi-file drag/drop upload.
- Recheck Google Drive folder display and open link.
- Recheck Subtask modal visual difference from normal task modal.
- Recheck Add Subtask button from task detail.

## Priority 2: LINE Message

- Confirm LINE message includes task title, date, time, detail, staff owners, committees/participants, Google Drive, and Google Calendar link.
- Improve message format so it can be sent directly.
- Confirm button feedback is visible after click.

## Priority 3: Google Calendar

- Short term: keep the safer flow that opens Google Calendar for the user to review and send manually.
- Google Calendar invite must include guest emails from selected members and committee members.
- YEC central calendar sync is for recovery/manual sync when auto sync fails.
- Add GOOGLE_SERVICE_ACCOUNT_JSON before central sync can work for real.
- Before enabling automatic invite sending, add preview/confirm for recipients.
- Long term: consider real invite sending from YEC@thaichamber.org using service account or domain-wide delegation.

## Priority 4: Task Board

- Recheck Task Card against the old system.
- Date should show as a range, for example 1-2 May.
- Time must use 24-hour format.
- Date and time must be visually strong and easy to scan.
- Remove duplicate/noisy tags.
- Default task ordering inside each section should be event date ascending.
- Card should show only important data: title, task type, date/time, file count, calendar status if available, compact staff/committee info.

## Priority 4.5: Annual Plan

- Recheck dashboard shows all 4 quarters on the real screen.
- Recheck dashboard quarter stacking matches the old dashboard arrangement.
- Recheck collapsed filter summary and expand/collapse behavior on the real screen.
- Recheck multi-select task type filter with several types selected at once.
- Recheck long task names in month columns and make sure wrapping does not make cards unreadable.
- Recheck A4 landscape print/export spacing with real data and confirm it prints all pages.
- Recheck print report month order is Jan-Apr, May-Aug, Sep-Dec like the old report.
- If the quarter has many tasks, consider compact density controls for export.

## Priority 5: Pending Page / Export

- Recheck Pending list UI on the real screen.
- Recheck filters: today, this week, this month.
- Recheck CSV export follows filters.
- Recheck PDF export follows filters.
- PDF should look modern and be ready to send to executives.
- PDF summary total cards are removed now, but verify final spacing after real export.
- PDF time badge is now top-right. Verify it does not overlap long task titles.

## Priority 6: Budget UI

- Improve Budget page readability based on the old system reference.
- Recheck compact fit-page layout on the real screen.
- Recheck project list and detail panel internal scrolling.
- Summary cards must be clear: planned expense, actual spend, remaining expense, net received.
- Project cards must make numbers easy to read.
- Recheck restored detail table: Compare, Plan, and Actual modes.
- Recheck overview PDF with filtered projects and confirm all pages print.
- Recheck project PDF with real project data and many accounting categories.
- Recheck CSV files open correctly in Excel with Thai text and monthly columns.
- Transaction form should be fast to use and receipt/document URL should open from the list.
- Next possible budget pass: attach/upload actual receipt files instead of pasting receipt URL only.

## Priority 7: Google Drive

- Keep Apps Script bridge approach for now.
- Recheck create-folder flow.
- Recheck multi-file upload from Task Modal.
- Uploaded files must be saved back into task attachments.
- If a Drive folder already exists, do not create a duplicate.
- Add clear error messages when bridge is not ready.

## Priority 8: User Module

- Recheck Users page.
- Must manage role, active/inactive, member binding, and password setup.
- Recheck permissions: super_admin, admin, editor, member.
- Staff owner fields in task must continue to pull from users, not members.

## Priority 9: Data Connection

- Recheck all modules are connected to Supabase: Board, Calendar, Annual, Directory, Approval, Budget, Todo, Users.
- Find any module still using mock/local state.
- Recheck RLS policy for all tables.
- Recheck realtime task updates.
- Compare old data/functions and identify missing functionality.

## Priority 10: Thai Text / Font

- Full project Thai text cleanup is still needed.
- Remove all mojibake strings.
- Use a consistent Thai sans font without loop/head across the system.
- Check text overflow in buttons, cards, and modals on desktop and mobile.

## Priority 11: Approval / Document

- Recheck approval flow against old system.
- Public approval link must open from LINE without login.
- Upload version must work.
- Reset document to draft after uploading a new version when appropriate.
- Log approval/revision actions fully.
- Recheck PDF/files in approval.

## Priority 12: System / Deploy / QA

- Vite bundle warning is not blocking now.
- In performance pass, code split large pages with React.lazy: Calendar, Budget, Pending, Approval, Users.
- Recheck npm audit.
- xlsx@0.18.5 may still have a high vulnerability without a direct fix. Decide later whether to replace library or accept temporarily.
- Prepare complete .env.example.
- Recheck Supabase secrets: SUPABASE_SERVICE_ROLE_KEY, DRIVE_BRIDGE_URL, DRIVE_BRIDGE_SECRET, GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_JSON, RESEND_API_KEY, TASK_EMAIL_FROM.
- QA before deploy: Login, create/edit/delete task, create/edit subtask, board sorting, calendar view, LINE message, Google Calendar invite, Drive upload, Budget transaction, user password set.
- Deploy frontend only after QA passes.
- Deploy/verify Edge Functions after secrets are ready.

## Recommended Next Start

- If continuing UX/UI: start with Budget UI or Task Board polish.
- If stabilizing the app: start with Thai text/mojibake cleanup across the whole project.
- If preparing production: start with QA checklist and environment/secrets review.
