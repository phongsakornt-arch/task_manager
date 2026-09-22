# function.md — YEC Task Manager v1 Apps Script Function & Feature Specification

> เอกสารนี้ถอดจากระบบเดิมที่รันบน Google Apps Script เพื่อใช้เป็น reference สำหรับ rebuild/migration ไปยัง React + Supabase โดยเก็บทั้งฟีเจอร์ เงื่อนไขการทำงาน สิทธิ์ ข้อมูลที่เกี่ยวข้อง และ inventory ฟังก์ชันฝั่ง server/client

## 0. Source Files

| ประเภท | ไฟล์ | ใช้เพื่อ |
|---|---|---|
| Blueprint | `YEC_TaskManager_v.supabase_UPDATED_v2.md` | เป้าหมายระบบใหม่และ migration plan |
| Apps Script Server | `code.gs.txt` | business logic, API endpoints, Sheet/Drive/Calendar/Mail integration |
| Apps Script Manifest | `appsscript.json` | timezone, scopes, advanced Calendar service, web app access |
| Apps Script UI | `index.txt` | single-page HTML/CSS/JS UI, client state, Google Script bridge |
| Main DB | `YEC Task Manager (3).xlsx` | Task, Members, Committees, Users, Sections, Task Types, Activity Log |
| Approval DB | `YEC Task Manager - Approval.xlsx` | Document approval data |
| Budget DB | `YEC Task Manager - Budget.xlsx` | Budget projects/plans/transactions |
| Todo DB | `_YEC Task Manager - Todo.xlsx` | Personal/team todo data |

---

## 1. System Runtime Summary

| รายการ | ค่า/พฤติกรรม |
|---|---|
| Runtime | Google Apps Script V8 |
| Timezone | `Asia/Bangkok` |
| Web App Execute As | `USER_DEPLOYING` |
| Web App Access | `ANYONE_ANONYMOUS` |
| Advanced Service | Google Calendar API v3 เปิดใช้ใน manifest |
| Main UI | Single HTML file ชื่อ `Index` ผ่าน `HtmlService.createHtmlOutputFromFile("Index")` |
| API Bridge | `google.script.run` เรียก `*Html` wrapper functions |
| Data Store | Google Sheets หลาย workbook แยกตาม module |
| File Store | Google Drive ผ่าน `DriveApp` |
| Calendar | Google Calendar ผ่าน `CalendarApp` + Advanced Calendar API fallback |
| Email | `MailApp` / `GmailApp` style ผ่าน Apps Script mail scopes |

### 1.1 OAuth Scopes

```json
[
  "https://www.googleapis.com/auth/script.send_mail",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/userinfo.email"
]
```

---

## 2. Workbook / Sheet Inventory

| Workbook | Sheet | Rows รวม header | Key Columns |
|---|---|---:|---|
| `YEC Task Manager (3).xlsx` | `📌 คู่มือ` | 14 | `manual / description` |
| `YEC Task Manager (3).xlsx` | `Task_Types` | 17 | `id`, `label`, `color`, `active`, `sort_order` |
| `YEC Task Manager (3).xlsx` | `🏛 Committees` | 8 | `id`, `name`, `name_en`, `color`, `head_name`, `head_email`, `member_count`, `active` |
| `YEC Task Manager (3).xlsx` | `👥 Members` | 143 | `id`, `committee_id`, `committee_name`, `fullname_th`, `fullname_en`, `nickname`, `position_yec`, `position_committee`, `email`, `phone`, `active` |
| `YEC Task Manager (3).xlsx` | `📋 Tasks` | 296 | `id`, `title`, `section_id`, `tags`, `start_date`, `end_date`, `start_time`, `end_time`, `owner_id`, `description`, `completed`, `created_at` ... |
| `YEC Task Manager (3).xlsx` | `🔗 Task_Members` | 58 | `id`, `task_id`, `member_id`, `committee_id`, `assigned_at` |
| `YEC Task Manager (3).xlsx` | `📊 Sections` | 17 | `id`, `title`, `icon`, `sort_order`, `active` |
| `YEC Task Manager (3).xlsx` | `🔐 Users` | 9 | `id`, `name`, `email`, `role`, `member_id`, `active`, `last_login`, `password` |
| `YEC Task Manager (3).xlsx` | `🕐 Activity_Log` | 1232 | `id`, `task_id`, `user_id`, `action`, `detail`, `timestamp` |
| `YEC Task Manager - Approval.xlsx` | `Approval_Documents` | 18 | `id`, `title`, `description`, `file_id`, `file_url`, `file_name`, `file_type`, `version`, `status`, `created_by`, `created_at`, `updated_at` |
| `YEC Task Manager - Approval.xlsx` | `Approval_Approvers` | 50 | `id`, `approval_id`, `order_no`, `approver_name`, `approver_email`, `member_id`, `token`, `status`, `acted_at`, `note`, `sent_at` |
| `YEC Task Manager - Approval.xlsx` | `Approval_Logs` | 95 | `id`, `approval_id`, `approver_id`, `action`, `detail`, `timestamp`, `actor_email`, `meta_json` |
| `YEC Task Manager - Approval.xlsx` | `Approval_Versions` | 4 | `id`, `approval_id`, `version`, `file_id`, `file_url`, `file_name`, `uploaded_by`, `uploaded_at`, `change_note` |
| `YEC Task Manager - Budget.xlsx` | `Budget_Projects` | 19 | `id`, `fiscal_year`, `department_code`, `project_name`, `external_code`, `budget_filter`, `project_type`, `budget_category`, `planned_revenue`, `planned_expense`, `planned_net`, `owner_member_id` ... |
| `YEC Task Manager - Budget.xlsx` | `Budget_Categories` | 25 | `accounting_code`, `name`, `kind`, `sort_order`, `active` |
| `YEC Task Manager - Budget.xlsx` | `Budget_Plans` | 461 | `id`, `project_id`, `accounting_code`, `kind`, `month`, `planned_amount`, `source_file`, `created_at`, `updated_at` |
| `YEC Task Manager - Budget.xlsx` | `Budget_Transactions` | 14 | `id`, `project_id`, `accounting_code`, `kind`, `transaction_date`, `amount`, `vendor`, `description`, `receipt_file_id`, `receipt_url`, `created_by`, `created_at` ... |
| `_YEC Task Manager - Todo.xlsx` | `Todo_Items` | 43 | `id`, `title`, `note`, `owner_email`, `owner_name`, `created_by`, `status`, `priority`, `due_date`, `due_time`, `pinned`, `sort_order` ... |

### 2.1 Module Routing in Apps Script

`moduleForSheet_(sheetName)` แบ่ง workbook ตามชื่อ sheet:

| Module | Sheets | Workbook Constant |
|---|---|---|
| SHARED | `Members`, `Committees`, `Users`, `Activity_Log` | `SHEETS.SHARED` |
| TASK | `Tasks`, `Task_Members`, `Sections`, `Task_Types` | `SHEETS.TASK` |
| APPROVAL | `Approval_Documents`, `Approval_Approvers`, `Approval_Logs`, `Approval_Versions` | `SHEETS.APPROVAL` |
| BUDGET | `Budget_Projects`, `Budget_Categories`, `Budget_Plans`, `Budget_Transactions` | `SHEETS.BUDGET` |
| TODO | `Todo_Items` | `SHEETS.TODO` |

---

## 3. Roles & Permission Model

ระบบเดิมใช้ `Users` sheet เป็น whitelist และ role control โดย login ด้วย email เท่านั้น ไม่ได้ใช้ password จริงในการ auth ฝั่ง Apps Script

| Role | สิทธิ์หลัก | Functions ที่เกี่ยวข้อง |
|---|---|---|
| `member` | เข้าดูระบบ/ข้อมูลพื้นฐานได้ | `requireAuth_`, `getFrontendBootstrap_` |
| `editor` | แก้ไข task, ส่ง email, สร้าง approval, บันทึก budget | `canEditTasks_`, `canEditBudget_` |
| `admin` | จัดการระบบบางส่วน เช่น member, backup, resync calendar | `canManageSystem_` |
| `super_admin` | จัดการ user/role และดู todo dashboard รวม | `canManageUsers_`, `canViewTodoDashboard_` |

### 3.1 Permission Functions

| Function | เงื่อนไข |
|---|---|
| `canEditTasks_(email)` | role ∈ `super_admin`, `admin`, `editor` |
| `canManageSystem_(email)` | role ∈ `super_admin`, `admin` |
| `canManageUsers_(email)` | role = `super_admin` |
| `canViewBudget_(email)` | user ต้องผ่าน auth; logic budget เปิดให้ view ตาม role ที่กำหนดใน code |
| `canEditBudget_(email)` | role ที่แก้ budget ได้ |
| `canEditTodoOwner_(email, ownerEmail)` | email ของ session ต้องตรงกับ owner ของ todo |
| `canViewTodoDashboard_(email)` | role = `super_admin` เท่านั้น |

---

## 4. HTTP / API Endpoint Map

### 4.1 `doGet(e)`

| เงื่อนไข | ผลลัพธ์ |
|---|---|
| ไม่มี `action` | คืนหน้า `Index` เป็น Web App UI |
| มี `approvalId` และ `token` | เปิด Public Approval Page แบบไม่ต้อง login ผ่าน `serveApprovalPublicPage_()` |
| `action=health` | คืน JSON health `{ok, app, env}` |
| `action=bootstrap` | ปฏิเสธด้วย 405 เพราะห้ามใช้ session token ผ่าน GET URL |
| action อื่น | 405 `Authenticated GET endpoints are disabled` |

### 4.2 `doPost(e)` action map

| Action | Auth | Permission | Backend Function | Notes |
|---|---|---|---|---|
| `loginEmail` | No session | email ต้องอยู่ใน Users และ active | `loginWithEmail_` | สร้าง session_token |
| `logout` | session optional | - | `clearAppSession_` | ล้าง session และ mark revoked |
| `bootstrap` | required | active user | `getFrontendBootstrap_` | โหลดข้อมูลหลักทั้งหมด |
| `getApproverPageData` | public token | doc token valid | `getApproverPageData_` | public approval |
| `doApproverAction` | public token | doc token valid | `doApproverAction_` | approve/revision |
| `createTask` | required | editor+ | `createTask_` | สร้าง task + Drive folder + assignment + calendar sync |
| `updateTask` | required | editor+ | `updateTask_` | แก้ task + assignment + calendar sync |
| `deleteTask` | required | editor+ | `softDeleteTask_` | soft delete + delete calendar event |
| `restoreTask` | required | editor+ | `restoreTask_` | restore + calendar sync |
| `completeTask` | required | editor+ | `completeTask_` | toggle completed + calendar sync |
| `sendEmail` | required | editor+ | `sendTaskEmail_` | manual email to assignees |
| `addUser` | required | super_admin | `addUser_` | เพิ่ม user |
| `removeUser` | required | super_admin | `removeUser_` | set active false / remove |
| `updateUserRole` | required | super_admin | `updateUserRole_` | เปลี่ยน role |
| `updateMember` | required | admin+ | `updateMember_` | แก้ข้อมูล member |
| `backupNow` | required | admin+ | `backupNow_` | backup snapshot |
| `restoreLatestBackup` | required | admin+ | `restoreLatestBackup_` | restore ล่าสุด |
| `listBackups` | required | admin+ | `listRecentBackups_` | list backup files |
| `resyncCalendarAll` | required | admin+ | `resyncAllTasksToCalendar_` | sync calendar ทั้งระบบ |
| `getApprovalDocs` | required | active user | `getApprovalDocs_` | list docs |
| `createApprovalDoc` | required | editor+ | `createApprovalDoc_` | upload file + draft doc |
| `updateApprovalDoc` | required | editor+ | `updateApprovalDoc_` | แก้ draft doc เท่านั้น |
| `cancelApprovalDoc` | required | editor+ | `cancelApprovalDoc_` | cancel ถ้ายังไม่ approved/cancelled |
| `submitApproval` | required | editor+ | `submitApproval_` | draft/revision → pending |
| `uploadNewApprovalVersion` | required | editor+ | `uploadNewApprovalVersion_` | new file version; status กลับ draft |
| `getApprovalLogs` | required | active user | `getApprovalLogsForDoc_` | logs by doc |
| `setupApprovalSheets` | required | admin+ | `ensureAllApprovalSheets_` | create/setup approval sheets |
| `getBudgetBootstrap` | required | view budget | `getBudgetBootstrapHtml` | โหลด budget |
| `createBudgetTransaction` | required | edit budget | `createBudgetTransactionHtml` | เพิ่มรายการงบ |
| `deleteBudgetTransaction` | required | edit budget | `deleteBudgetTransactionHtml` | soft delete transaction |
| `setupBudgetSheets` | required | admin+ | `ensureBudgetSheets_` | create/setup budget sheets |

---

## 5. Feature Specification by Module


### 5.1 Authentication & Session

**ฟีเจอร์**
- Login ด้วย email จาก `Users` sheet
- สร้าง `session_token` แบบ UUID 2 ชุดเชื่อมด้วย `.`
- เก็บ session ซ้ำ 3 ที่: `UserCache`, `ScriptCache`, `ScriptProperties`
- TTL = 8 ชั่วโมง (`SESSION_TTL_SEC = 60 * 60 * 8`)
- Logout ลบ session และเก็บ `revoked:{token}` ใน ScriptCache
- `requireAuth_()` ตรวจว่า session valid และ user ยัง active

**เงื่อนไขการทำงาน**
- email ต้อง normalize เป็น lower-case + trim
- user ต้องอยู่ใน `Users` sheet และ `active = TRUE`
- session หมดอายุแล้วจะ return `Session หมดอายุหรือไม่ถูกต้อง`
- GET endpoint ไม่รับ session token เพื่อลด token leak ใน URL

**Functions หลัก**
`loginWithEmail_`, `createAppSession_`, `getSessionEmail_`, `clearAppSession_`, `requireAuth_`, `getUserByEmail_`, `updateLastLogin_`

---

### 5.2 Frontend Bootstrap & Data Loading

**ฟีเจอร์**
- โหลดข้อมูลเริ่มต้นให้หน้า UI: users, members, committees, sections, taskTypes, tasks
- มี fast bootstrap สำหรับโหลดเฉพาะ active tasks เพื่อลด payload
- มี lazy loading สำหรับ Members/Users/Budget/Todo/Approval บาง module
- ใช้ cache version สำหรับ tasks paging

**เงื่อนไขการทำงาน**
- ต้องมี session valid
- `getFrontendBootstrapFastSafeHtml()` fallback ไป full bootstrap ถ้า fast ล้มเหลว
- Activity log ต่อ task จำกัดล่าสุด 20 รายการตอน bootstrap เพื่อลด payload

**Functions หลัก**
`getFrontendBootstrap_`, `getFrontendBootstrapFast_`, `getFrontendBootstrapFastSafeHtml`, `getTasksPageData_`, `getActiveTasksData_`, `getAllTasksHtml`, `getCompletedTasksHtml`, `getMembersBootstrap`, `getUsersBootstrap`

---

### 5.3 Task Board / Kanban

**ฟีเจอร์**
- Board แบบหลาย section/column
- Task card แสดง title, date, tags, owner/assignee, Drive, attachment, calendar sync status
- เพิ่ม task แบบ inline หรือผ่าน modal
- แก้ไข task ผ่าน modal
- ย้าย task ระหว่าง section ด้วย drag & drop
- เรียง task ใน section ตาม due/date/title/status ฝั่ง client
- Search/filter แบบ partial keyword
- Load active tasks ก่อน และ load completed/all เพิ่มได้
- รองรับ parent task / subtask ผ่าน `parent_task_id`
- ถ้าย้าย parent task ไป section ใหม่ จะย้าย subtasks ตาม section ด้วย

**เงื่อนไขการทำงาน**
- create/update/delete/complete ต้องเป็น editor/admin/super_admin
- create task จะสร้าง Drive folder อัตโนมัติ
- create/update จะ sync assignment ลง `Task_Members`
- create/update/complete/restore จะ upsert calendar event
- delete เป็น soft delete และพยายามลบ calendar event
- ทุก write ใช้ `withScriptLock_()` กัน concurrent write
- ทุก write บันทึก `Activity_Log`
- หลัง write ต้อง `bumpTaskCacheVersion_()` เพื่อ invalidate task cache

**Data dependency**
- `Tasks`
- `Task_Members`
- `Sections`
- `Task_Types`
- `Members`
- `Committees`
- `Users`
- `Activity_Log`

**Functions หลัก**
`createTask_`, `updateTask_`, `softDeleteTask_`, `restoreTask_`, `completeTask_`, `syncTaskAssignmentsUnlocked_`, `getTaskForUI_`, `taskRowForUI_`, `buildTaskAssignmentsMap_`, `buildActivityMap_`, `addSectionHtml`, `updateSectionOrderHtml`

---

### 5.4 Task Attachment & Google Drive

**ฟีเจอร์**
- ทุก task มี Drive folder แยกตาม task id/title
- รองรับ attachment ทั้ง file upload และ external link
- จำกัดไฟล์ `MAX_ATTACHMENT_BYTES = 8MB`
- จำกัด MIME types: jpg, png, gif, webp, pdf, xls/xlsx, doc/docx
- Upload แล้วตั้ง sharing เป็น anyone with link/view
- เก็บ attachment metadata ใน `attachments_json`

**เงื่อนไขการทำงาน**
- ถ้า update attachment แล้วไม่มี Drive folder เดิม จะสร้าง folder ใหม่
- `processAttachments_()` รับ list จาก UI แล้วแปลงเป็น stored attachment objects
- Apps Script เดิมยังไม่ atomic: ถ้า upload Drive สำเร็จแต่ write sheet fail อาจเกิด orphan file ได้

**Functions หลัก**
`createTaskDriveFolder_`, `makeTaskFolderName_`, `getFolderFromUrl_`, `processAttachments_`, `normalizeStoredAttachments_`, `sanitizeHttpUrl_`

---

### 5.5 Calendar Sync

**ฟีเจอร์**
- Task ที่มี `start_date` จะสร้างหรืออัปเดต Google Calendar event
- รองรับ all-day event เมื่อไม่มี start/end time
- ถ้ามี start time แต่ไม่มี end time จะ default duration = 1 ชั่วโมง
- ถ้ามี end_date หลายวัน และไม่มีเวลา จะตั้ง end เป็นวันถัดจาก end_date ตามกฎ all-day ของ Google Calendar
- ใช้ hash เพื่อกัน sync ซ้ำ (`calendar_last_sync_hash`)
- เก็บ event metadata: `calendar_event_id`, `calendar_event_url`, `calendar_sync_status`, `calendar_last_sync_at`
- ใช้ Advanced Calendar API ก่อน ถ้า unavailable/fallback error จึงใช้ CalendarApp fallback
- มี health check และ invite delivery check

**เงื่อนไขการทำงาน**
- ถ้า task ไม่มีช่วงวันที่ที่ parse ได้ จะไม่สร้าง event
- ถ้า task ถูก soft delete จะ delete calendar event
- ถ้า task completed ยัง sync metadata/status แต่ไม่ได้ลบ event โดยอัตโนมัติ
- Calendar ID มาจาก `CALENDAR_ID = yec@thaichamber.org` หรือ Script Properties
- ต้องมีสิทธิ์ calendar edit ของ owner/deploying user

**Functions หลัก**
`buildTaskCalendarRange_`, `parseTaskDateTime_`, `normalizeTaskTime_`, `buildCalendarHash_`, `buildCalendarDescription_`, `upsertTaskCalendarEvent_`, `upsertTaskCalendarEventViaApi_`, `deleteTaskCalendarEvent_`, `calendarApiRequest_`, `calendarHealthCheck_`, `calendarInviteDeliveryCheck_`, `resyncAllTasksToCalendar_`

---

### 5.6 Email & Daily Reminder

**ฟีเจอร์**
- ส่ง email แจ้ง task แบบ manual จาก task modal
- ส่ง reminder อัตโนมัติทุกวันสำหรับงานที่ `start_date = tomorrow` และ `completed != TRUE`
- สร้าง email HTML template พร้อม link Google Calendar template
- เก็บ log การส่งใน `Activity_Log`
- มี dedupe ผ่าน Activity_Log และ CacheService เพื่อไม่ส่งซ้ำในวันเดียวกัน
- มี setup daily trigger

**เงื่อนไขการทำงาน**
- Reminder ใช้ timezone `Asia/Bangkok`
- Reminder ใช้ `start_date` เป็นวันอ้างอิง ไม่ใช่ `end_date`
- ถ้าเจอ log ส่งแล้วหรือ cache ส่งแล้ว จะข้ามและ log `ข้ามเตือนซ้ำ`
- ส่งล้มเหลวจะ log `ส่งเตือนล้มเหลว`
- ใช้ script lock กัน reminder run ซ้อน

**Functions หลัก**
`sendTaskEmail_`, `buildEmailHtml_`, `buildCalendarTemplateLink_`, `dailyReminder`, `getReminderSentTaskIdSet_`, `isReminderSentCached_`, `markReminderSentCached_`, `getReminderStats_`, `setupDailyTrigger_`

---

### 5.7 Member / Committee / User Management

**ฟีเจอร์**
- Member directory: ค้นหา/แสดงข้อมูลกรรมการจาก `Members`
- Committee summary: รวมสมาชิกตาม committee
- User management: เพิ่ม user, remove user, update role
- Member edit เฉพาะ admin+
- User role management เฉพาะ super_admin

**เงื่อนไขการทำงาน**
- User login ต้อง match email ใน `Users`
- `activeRows_()` ถือว่า empty active = active หรือ `TRUE`
- `removeUser_()` ใช้แนวคิด deactivate/remove ตาม logic ใน code
- `password` column ใน Users มีอยู่ใน sheet แต่ไม่ควรถือเป็น auth จริงของระบบใหม่

**Functions หลัก**
`buildMembersForDirectory_`, `buildCommitteesForUI_`, `buildUsersForUI_`, `updateMember_`, `addUser_`, `removeUser_`, `updateUserRole_`

---

### 5.8 Approval Module

**ฟีเจอร์**
- สร้างเอกสารอนุมัติเป็น draft
- แนบไฟล์ขึ้น Google Drive folder `Approval_Documents` หรือ `Approval_Documents_DEMO`
- ระบุ approvers แบบเรียงลำดับ `order_no`
- Submit เอกสารจาก `draft` หรือ `revision_requested` เป็น `pending`
- Public approver page เปิดผ่าน `approvalId + token` โดยไม่ต้อง login
- Approver action: `approved` หรือ `revision_requested`
- คำนวณ status เอกสารใหม่จากสถานะ approvers
- อัปโหลด version ใหม่หลัง revision แล้ว status กลับเป็น `draft`
- มี Approval logs และ export/report UI

**เงื่อนไขการทำงาน**
- create/update/submit/upload version ต้องเป็น editor+
- update doc แก้ได้เฉพาะ `draft`
- cancel ไม่ได้ถ้า status เป็น `approved` หรือ `cancelled`
- `isApprovalTerminalStatus_()` ถือว่า `approved`, `cancelled`, `deleted` เป็น terminal
- Public approval ใช้ doc-level HMAC token จาก `getDocToken_(approvalId)` ไม่ใช่ per-approver token แม้ใน sheet จะมี `token` ต่อ approver
- `doApproverAction_()` เลือก approver ถัดไปจากคนแรกที่ status = `waiting` ไม่ได้ยืนยัน `approverId` เฉพาะคน
- มี `withScriptLock_()` กัน action ซ้อน แต่ยังไม่ใช่ transaction/row lock แบบ database

**Status logic**
- ถ้ามี approver `revision_requested` → doc status = `revision_requested`
- ถ้ามี approver `waiting` → doc status = `pending`
- ถ้าทุกคน `approved` หรือ `skipped` → doc status = `approved`
- อื่น ๆ → `pending`

**Functions หลัก**
`createApprovalDoc_`, `updateApprovalDoc_`, `replaceApprovers_`, `submitApproval_`, `getDocToken_`, `buildApprovalLinks_`, `getApproverPageData_`, `doApproverAction_`, `computeDocStatus_`, `uploadNewApprovalVersion_`, `getApprovalDocs_`, `getApprovalLogsForDoc_`, `serveApprovalPublicPage_`

---

### 5.9 Budget Module

**ฟีเจอร์**
- โหลด projects, categories, plans, transactions
- คำนวณ actual revenue/expense/net จาก transactions
- คำนวณ remaining expense และ used percentage ต่อ project
- Filter / dashboard / export CSV / export PDF ฝั่ง client
- เพิ่ม transaction รายรับ/รายจ่าย
- Soft delete transaction
- Cache budget categories 1 ชั่วโมง
- Seed/setup budget sheets ได้

**เงื่อนไขการทำงาน**
- `getBudgetBootstrapHtml()` ต้องผ่าน auth และ `canViewBudget_()`
- `createBudgetTransactionHtml()` ต้องผ่าน `canEditBudget_()`
- project ต้องมีอยู่และ status ไม่ใช่ `deleted`
- category ต้อง active
- `kind` ที่ user ส่งมาต้องตรงกับ category kind
- amount ต้อง > 0
- transaction date ต้องเป็น `YYYY-MM-DD`
- delete transaction ใช้ `deleted = TRUE`

**Data dependency**
- `Budget_Projects`
- `Budget_Categories`
- `Budget_Plans`
- `Budget_Transactions`

**Functions หลัก**
`getBudgetBootstrapHtml`, `budgetProjectForUI_`, `budgetCategoryForUI_`, `budgetPlanForUI_`, `budgetTransactionForUI_`, `createBudgetTransactionHtml`, `deleteBudgetTransactionHtml`, `getBudgetCategoriesCached_`, `invalidateBudgetCache_`, `seedBudgetData_`, `ensureBudgetSheets_`

---

### 5.10 Todo Module

**ฟีเจอร์**
- Todo แยก owner ตาม email session
- เพิ่ม todo แบบ quick add
- patch title/note/priority/due/pinned/sortOrder
- toggle done/open
- soft delete todo
- dashboard รวม todo ทั้งทีมสำหรับ super_admin
- client UI แยก mode ส่วนตัว/ทีม
- sorting: pinned ก่อน, sort_order, updated_at/created_at

**เงื่อนไขการทำงาน**
- User เห็น todo ของตัวเองเท่านั้นใน `getTodoBootstrapHtml()`
- แก้ todo ได้เฉพาะ owner email ตรงกับ session email
- Dashboard รวมต้อง `super_admin`
- delete ใช้ `deleted = TRUE`
- done ตั้ง `status = done` และ `completed_at = now`
- reopen ตั้ง `status = open` และล้าง `completed_at`

**Data dependency**
- `Todo_Items`
- `Users` สำหรับ dashboard owner name

**Functions หลัก**
`getTodoBootstrapHtml`, `getTodoDashboardHtml`, `createTodoHtml`, `patchTodoHtml`, `completeTodoHtml`, `deleteTodoHtml`, `todoRowForUI_`, `todoOwnerFromSession_`, `canEditTodoOwner_`, `canViewTodoDashboard_`

---

### 5.11 Backup / Restore / Health Check

**ฟีเจอร์**
- สร้าง backup snapshot ของ spreadsheet/workbook
- List recent backups
- Restore latest backup
- Setup daily backup trigger
- Health check ตรวจ Sheet, module sheets, Drive, Mail quota, Calendar access/write
- Resync calendar all active tasks

**เงื่อนไขการทำงาน**
- backup/restore/resync ต้องเป็น admin+
- health check สร้าง calendar event ทดสอบแล้วลบทิ้ง
- Calendar health ขึ้นกับ deploy execute-as และสิทธิ์ calendar ของ account ที่รัน

**Functions หลัก**
`backupNow_`, `createBackupSnapshot_`, `backupSpreadsheetDaily`, `setupDailyBackupTrigger_`, `listRecentBackups_`, `restoreLatestBackup_`, `restoreFromBackupFile_`, `calendarHealthCheck_`, `resyncAllTasksToCalendar_`

---

### 5.12 Frontend UI Feature Map

**Views หลักจาก `index.html`**
- Login
- Board / Kanban
- Pending summary
- Annual view
- Calendar view
- Committee / Member directory
- Users management
- Approval dashboard/modal/public actions
- Budget dashboard/detail/export
- Todo personal/team dashboard

**Client state หลัก**
- `S.sessionToken`
- `S.loginUser`
- `S.tasks`
- `S.members`
- `S.committees`
- `S.sections`
- `S.taskTypes`
- `S.budget`
- `S.todo`
- `S.approval`

**Client-to-server bridge**
- ใช้ `gsCall(fn, ...args)` ห่อ `google.script.run.withSuccessHandler/withFailureHandler`
- ใช้ `gsCallTry([...])` fallback หาก backend function name บางตัวไม่มี
- แสดง global loader ด้วย `_glShow()` / `_glHide()` ระหว่าง call

---

## 6. Data Rules / Normalization Rules

| Rule | รายละเอียด |
|---|---|
| Email normalization | trim + lowercase ผ่าน `normalizeEmail_()` |
| Boolean parsing | เฉพาะ string `TRUE` เท่านั้นที่ถือว่า true ผ่าน `toBool_()` |
| CSV field | `tags` ถูก split ด้วย comma ผ่าน `splitCsv_()` |
| JSON field | `checklist_json`, `attachments_json`, `meta_json` parse ผ่าน `safeParseJson_()` |
| Date display | Date object ใน Sheet ถูก normalize เป็น `yyyy-MM-dd` หรือ `HH:mm` ตามชื่อ header |
| Sequential ID | ใช้ ScriptProperties sequence เช่น `SEQ_TASK_ID`, `SEQ_TODO_ID` และ fallback จาก max existing ID |
| Concurrency | write สำคัญใช้ `LockService.getScriptLock()` ผ่าน `withScriptLock_()` |
| Soft delete | Task/Budget/Todo ใช้ `deleted = TRUE`; Approval มี status `deleted` |
| Cache | Task paging cache version, Approval docs cache 300 sec, Budget categories cache 1 hr, Reminder dedupe cache |

---

## 7. Migration Notes for Supabase Rebuild

### 7.1 สิ่งที่ควรยกไปเป็น logic/spec

- Task CRUD + soft delete + restore + complete
- Assignment model: task ↔ members/committees
- Calendar date/time rules
- Calendar sync hash idea
- Daily reminder rule: start_date = tomorrow, not completed, dedupe
- Approval lifecycle: draft → pending → approved/revision_requested/cancelled
- Budget totals/actual/remaining/usedPct
- Todo owner-based access
- UI layout and wording

### 7.2 สิ่งที่ไม่ควรยกไปตรง ๆ

- Custom session token + CacheService → เปลี่ยนเป็น Supabase Auth
- SpreadsheetApp CRUD → เปลี่ยนเป็น PostgreSQL queries
- LockService → เปลี่ยนเป็น DB transaction / row lock
- DriveApp base64 upload → เปลี่ยนเป็น Google Drive API stream upload
- CalendarApp → เปลี่ยนเป็น Google Calendar API via service account
- MailApp/GmailApp → เปลี่ยนเป็น Resend หรือ email provider
- Public approval doc-level token → ควรเปลี่ยนเป็น per-approver token validation
- `password` column ใน Users → ไม่ migrate เป็น auth secret

### 7.3 Critical differences to fix in new system

| Area | เดิม | ควรเป็นใน Supabase |
|---|---|---|
| Approval token | doc-level HMAC token | per-approver token + `.eq(token)` ทุก query |
| Approval action | เลือก waiting approver คนแรก | validate approverId + token + status + row lock |
| Calendar write-back | เขียนกลับ Sheet ใน same function | caller/transaction pattern ต้องกัน event ซ้ำ |
| File upload | Drive upload + Sheet write ไม่ atomic | rollback Drive file ถ้า DB insert fail |
| Auth | session token ใน Apps Script | Supabase Magic Link + RLS |
| Timezone | Apps Script Asia/Bangkok | SQL/cron ต้อง explicit `Asia/Bangkok` |

---

## 8. Public Server Functions Inventory

### 8.1 API bridge functions called from client

| Function | Module | Purpose |
|---|---|---|
| `loginWithEmailHtml` | API / HTML bridge | Auth: login by email and return session_token |
| `getTasksPageHtml` | API / HTML bridge | Load paged tasks |
| `getAllTasksHtml` | API / HTML bridge | Load all tasks |
| `getCompletedTasksHtml` | API / HTML bridge | Load completed tasks |
| `getFrontendBootstrapFastSafeHtml` | API / HTML bridge | Bootstrap active task data with fallback |
| `getReminderStatsHtml` | API / HTML bridge | Reminder stats |
| `logoutApp` | API / HTML bridge | Clear session |
| `getBudgetBootstrapHtml` | API / HTML bridge | Budget bootstrap |
| `createBudgetTransactionHtml` | API / HTML bridge | Create budget transaction |
| `deleteBudgetTransactionHtml` | API / HTML bridge | Soft delete budget transaction |
| `getTodoBootstrapHtml` | API / HTML bridge | Todo bootstrap for current owner |
| `getTodoDashboardHtml` | API / HTML bridge | Todo dashboard for super_admin |
| `createTodoHtml` | API / HTML bridge | Create todo |
| `completeTodoHtml` | API / HTML bridge | Toggle todo done |
| `patchTodoHtml` | API / HTML bridge | Patch todo fields |
| `deleteTodoHtml` | API / HTML bridge | Soft delete todo |
| `updateSectionOrderHtml` | API / HTML bridge | Update board section order |
| `updateTaskHtml` | API / HTML bridge | Update task |
| `createTaskHtml` | API / HTML bridge | Create task |
| `addSectionHtml` | API / HTML bridge | Add board section |
| `getTaskHtml` | API / HTML bridge | Load one task |
| `completeTaskHtml` | API / HTML bridge | Toggle complete |
| `deleteTaskHtml` | API / HTML bridge | Soft delete task |
| `sendTaskEmailHtml` | API / HTML bridge | Send task email |
| `updateMemberHtml` | API / HTML bridge | Update member |
| `updateUserRoleHtml` | API / HTML bridge | Update user role |
| `removeUserHtml` | API / HTML bridge | Remove user |
| `calendarHealthCheckHtml` | API / HTML bridge | Calendar/sheet/drive/mail health check |
| `calendarInviteDeliveryCheckHtml` | API / HTML bridge | Calendar invite test |
| `resyncCalendarAllHtml` | API / HTML bridge | Resync all calendar events |
| `backupNowHtml` | API / HTML bridge | Backup now |
| `restoreLatestBackupHtml` | API / HTML bridge | Restore latest backup |
| `addUserHtml` | API / HTML bridge | Add user |
| `getApprovalBootstrap` | Approval | Approval bootstrap |
| `createApprovalDocHtml` | API / HTML bridge | Create approval document |
| `submitApprovalHtml` | API / HTML bridge | Submit approval |
| `getApprovalLinksHtml` | API / HTML bridge | Build approval link |
| `deleteApprovalDocHtml` | API / HTML bridge | Delete approval document / set deleted |
| `cancelApprovalDocHtml` | API / HTML bridge | Cancel approval document |
| `getApprovalLogsHtml` | API / HTML bridge | Get approval logs |
| `uploadNewApprovalVersionHtml` | API / HTML bridge | Upload new approval version |
| `getAppMetaHtml` | API / HTML bridge | App metadata |

---

## 9. Complete Server Function Inventory (`code.gs`)

รวมฟังก์ชันที่ตรวจพบ: **283** รายการ

| Line | Category | Function |
|---:|---|---|
| 1 | Utility / other | `scriptProp_()` |
| 21 | Utility / other | `envCriticalProp_()` |
| 29 | Sheet / data access | `sheetProp_()` |
| 75 | Sheet / data access | `moduleForSheet_()` |
| 89 | Sheet / data access | `getWorkbook_()` |
| 98 | Sheet / data access | `getWorkbookForSheet_()` |
| 135 | Sheet / data access | `normalizeSheetKey_()` |
| 141 | Sheet / data access | `canonicalSheetToken_()` |
| 154 | Sheet / data access | `getSheetByLogicalName_()` |
| 179 | API / HTML bridge | `doGet()` |
| 213 | API / HTML bridge | `doPost()` |
| 359 | API / HTML bridge | `resp_()` |
| 365 | Auth / permission | `normalizeEmail_()` |
| 369 | Task / master data | `getTaskCacheVersion_()` |
| 376 | Task / master data | `bumpTaskCacheVersion_()` |
| 382 | Task / master data | `makeTaskPageCacheKey_()` |
| 386 | Auth / permission | `isAuthorized_()` |
| 390 | Auth / permission | `getUserByEmail_()` |
| 401 | Auth / permission | `getUserRole_()` |
| 406 | Auth / permission | `getNormalizedRole_()` |
| 410 | Auth / permission | `canEditTasks_()` |
| 415 | Auth / permission | `canManageSystem_()` |
| 420 | Auth / permission | `canManageUsers_()` |
| 424 | Auth / permission | `updateLastLogin_()` |
| 444 | Auth / permission | `getSessionSigningSecret_()` |
| 455 | Auth / permission | `createAppSession_()` |
| 474 | Auth / permission | `cleanupExpiredSessions_()` |
| 491 | Auth / permission | `getSessionEmailFromSignedToken_()` |
| 521 | Auth / permission | `getSessionEmail_()` |
| 562 | Auth / permission | `clearAppSession_()` |
| 572 | Auth / permission | `requireAuth_()` |
| 584 | Auth / permission | `loginWithEmail_()` |
| 612 | API / HTML bridge | `loginWithEmailHtml()` |
| 616 | API / HTML bridge | `getAppMetaHtml()` |
| 620 | API / HTML bridge | `logoutApp()` |
| 625 | Utility / other | `pickUIColor_()` |
| 629 | Utility / other | `extractHexColor_()` |
| 637 | Task / master data | `taskTypeColorChoiceForHex_()` |
| 646 | Utility / other | `splitCsv_()` |
| 653 | Utility / normalization | `safeParseJson_()` |
| 662 | Utility / normalization | `safeStringifyJson_()` |
| 666 | Utility / normalization | `toBool_()` |
| 670 | Utility / other | `makeIni_()` |
| 675 | Sheet / data access | `activeRows_()` |
| 681 | Task / master data | `getMemberCommitteeId_()` |
| 695 | Utility / normalization | `uid_()` |
| 699 | Utility / other | `withScriptLock_()` |
| 709 | Utility / normalization | `nextSequenceValue_()` |
| 717 | Utility / normalization | `ensureSequenceAtLeast_()` |
| 727 | Utility / normalization | `getMaxSequentialIdNumber_()` |
| 741 | Utility / other | `makeSequentialId_()` |
| 746 | Utility / other | `appendDemoSuffixToName_()` |
| 758 | Task / master data | `makeTaskFolderName_()` |
| 765 | Task / master data | `createTaskDriveFolder_()` |
| 770 | Task / master data | `buildTaskAssignmentsMap_()` |
| 796 | Utility / other | `buildActivityMap_()` |
| 821 | Drive / attachment | `normalizeStoredAttachments_()` |
| 836 | Utility / other | `buildUsersForUI_()` |
| 851 | Task / master data | `getMemberEmailRaw_()` |
| 863 | Task / master data | `buildMembersForDirectory_()` |
| 883 | Task / master data | `buildCommitteesForUI_()` |
| 902 | Task / master data | `buildSectionsForUI_()` |
| 916 | Sheet / data access | `ensureTaskTypesSheet_()` |
| 948 | Sheet / data access | `formatTaskTypesSheet_()` |
| 989 | Task / master data | `buildTaskTypesForUI_()` |
| 1012 | Sheet / data access | `setupTaskTypesSheet_()` |
| 1022 | Task / master data | `buildTasksForUI_()` |
| 1032 | Sheet / data access | `taskRowForUI_()` |
| 1062 | Task / master data | `buildTaskAssignmentsMapForTask_()` |
| 1074 | Task / master data | `buildActivityMapForTask_()` |
| 1092 | Task / master data | `getTaskForUI_()` |
| 1103 | Utility / other | `appMeta_()` |
| 1110 | Utility / other | `getFrontendBootstrap_()` |
| 1128 | Utility / other | `getFrontendBootstrapFast_()` |
| 1156 | API / HTML bridge | `getFrontendBootstrapFastSafeHtml()` |
| 1177 | Task / master data | `getMembersBootstrap()` |
| 1187 | Utility / other | `getUsersBootstrap()` |
| 1197 | Task / master data | `getTasksPageData_()` |
| 1226 | API / HTML bridge | `getTasksPageHtml()` |
| 1232 | Task / master data | `getActiveTasksData_()` |
| 1249 | API / HTML bridge | `getAllTasksHtml()` |
| 1263 | API / HTML bridge | `getCompletedTasksHtml()` |
| 1282 | API / HTML bridge | `getTaskHtml()` |
| 1288 | Task / master data | `getTasks_()` |
| 1294 | Task / master data | `getDeletedTasks_()` |
| 1300 | Task / master data | `getTask_()` |
| 1319 | Task / master data | `ensureTaskCalendarColumns_()` |
| 1341 | Sheet / data access | `normalizeSheetCellForObject_()` |
| 1359 | Sheet / data access | `rowToObject_()` |
| 1372 | Sheet / data access | `ensureSheetHasHeaders_()` |
| 1386 | Sheet / data access | `setRowValueByHeader_()` |
| 1391 | Utility / other | `pad2_()` |
| 1395 | Utility / normalization | `makeDateInAppTimezone_()` |
| 1406 | Task / master data | `normalizeTaskTime_()` |
| 1429 | Calendar / email / reminder | `writeCalendarSyncMeta_()` |
| 1444 | Task / master data | `parseTaskDateTime_()` |
| 1469 | Utility / other | `addDays_()` |
| 1475 | Task / master data | `buildTaskCalendarRange_()` |
| 1526 | Auth / permission | `normalizeEmailList_()` |
| 1544 | Task / master data | `getTaskAssigneesMeta_()` |
| 1606 | Calendar / email / reminder | `buildCalendarHash_()` |
| 1626 | Calendar / email / reminder | `buildCalendarDescription_()` |
| 1642 | Sheet / data access | `getTaskCalendarOrThrow_()` |
| 1655 | Calendar / email / reminder | `calendarHealthCheck_()` |
| 1749 | Calendar / email / reminder | `calendarInviteDeliveryCheck_()` |
| 1823 | Utility / other | `applyGuestsToEvent_()` |
| 1832 | Calendar / email / reminder | `getCalendarEventUrl_()` |
| 1857 | Calendar / email / reminder | `getCalendarEventUrlById_()` |
| 1873 | Calendar / email / reminder | `calendarApiAvailable_()` |
| 1877 | Calendar / email / reminder | `isCalendarApiDisabledError_()` |
| 1886 | Calendar / email / reminder | `isCalendarApiFallbackError_()` |
| 1901 | Calendar / email / reminder | `calendarApiRequest_()` |
| 1952 | Calendar / email / reminder | `resolveCalendarApiEventId_()` |
| 1975 | Calendar / email / reminder | `toCalendarApiDate_()` |
| 1979 | Calendar / email / reminder | `toCalendarApiDateTime_()` |
| 1983 | Calendar / email / reminder | `buildCalendarApiEventResource_()` |
| 2004 | Task / master data | `upsertTaskCalendarEventViaApi_()` |
| 2045 | Task / master data | `upsertTaskCalendarEvent_()` |
| 2139 | Task / master data | `deleteTaskCalendarEvent_()` |
| 2166 | Task / master data | `createTask_()` |
| 2250 | Task / master data | `updateTask_()` |
| 2374 | Task / master data | `softDeleteTask_()` |
| 2416 | Task / master data | `restoreTask_()` |
| 2464 | Task / master data | `completeTask_()` |
| 2509 | Task / master data | `syncTaskAssignmentsUnlocked_()` |
| 2558 | Task / master data | `syncTaskAssignments_()` |
| 2564 | Task / master data | `getMembers_()` |
| 2571 | Task / master data | `getCommittees_()` |
| 2577 | Task / master data | `getSections_()` |
| 2583 | Utility / other | `getUsers_()` |
| 2589 | Task / master data | `updateMember_()` |
| 2630 | Utility / other | `addUser_()` |
| 2666 | Utility / other | `removeUser_()` |
| 2684 | Auth / permission | `updateUserRole_()` |
| 2723 | Task / master data | `sendTaskEmail_()` |
| 2772 | Calendar / email / reminder | `addEmailRaw_()` |
| 2912 | Task / master data | `syncTaskCalendarForEmail_()` |
| 2952 | Calendar / email / reminder | `testGmailPermission_()` |
| 2967 | Calendar / email / reminder | `sendTestEmail_()` |
| 2992 | Task / master data | `getReminderSentTaskIdSet_()` |
| 3009 | Calendar / email / reminder | `isReminderEmailLogAction_()` |
| 3014 | Calendar / email / reminder | `reminderSentCacheKey_()` |
| 3018 | Calendar / email / reminder | `isReminderSentCached_()` |
| 3023 | Calendar / email / reminder | `markReminderSentCached_()` |
| 3029 | Utility / normalization | `escapeHtml_()` |
| 3038 | Utility / normalization | `sanitizeHttpUrl_()` |
| 3045 | Calendar / email / reminder | `sanitizeCalendarUrl_()` |
| 3052 | Calendar / email / reminder | `toCalendarStamp_()` |
| 3057 | Calendar / email / reminder | `toCalendarDayStamp_()` |
| 3062 | Calendar / email / reminder | `buildCalendarTemplateLink_()` |
| 3085 | Calendar / email / reminder | `buildEmailHtml_()` |
| 3184 | Calendar / email / reminder | `dailyReminder()` |
| 3228 | Calendar / email / reminder | `getReminderStats_()` |
| 3262 | Utility / other | `setupDailyTrigger_()` |
| 3275 | Backup / restore | `getOrCreateBackupFolder_()` |
| 3283 | Backup / restore | `createBackupSnapshot_()` |
| 3298 | Sheet / data access | `backupSpreadsheetDaily()` |
| 3309 | Backup / restore | `setupDailyBackupTrigger_()` |
| 3322 | Backup / restore | `listRecentBackups_()` |
| 3340 | Backup / restore | `restoreFromBackupFile_()` |
| 3376 | Backup / restore | `restoreLatestBackup_()` |
| 3383 | Backup / restore | `backupNow_()` |
| 3387 | Task / master data | `resyncAllTasksToCalendar_()` |
| 3490 | Utility / other | `logActivity_()` |
| 3512 | Sheet / data access | `getSheetData_()` |
| 3553 | API / HTML bridge | `createTaskHtml()` |
| 3560 | API / HTML bridge | `updateTaskHtml()` |
| 3567 | API / HTML bridge | `completeTaskHtml()` |
| 3574 | API / HTML bridge | `deleteTaskHtml()` |
| 3581 | API / HTML bridge | `restoreTaskHtml()` |
| 3588 | API / HTML bridge | `sendTaskEmailHtml()` |
| 3595 | API / HTML bridge | `getReminderStatsHtml()` |
| 3601 | API / HTML bridge | `backupNowHtml()` |
| 3608 | API / HTML bridge | `listRecentBackupsHtml()` |
| 3615 | API / HTML bridge | `restoreLatestBackupHtml()` |
| 3622 | API / HTML bridge | `resyncCalendarAllHtml()` |
| 3629 | API / HTML bridge | `calendarHealthCheckHtml()` |
| 3636 | API / HTML bridge | `calendarInviteDeliveryCheckHtml()` |
| 3643 | Calendar / email / reminder | `grantCalendarPermission_()` |
| 3647 | API / HTML bridge | `addUserHtml()` |
| 3654 | API / HTML bridge | `removeUserHtml()` |
| 3661 | API / HTML bridge | `updateUserRoleHtml()` |
| 3668 | API / HTML bridge | `updateMemberHtml()` |
| 3675 | API / HTML bridge | `addSectionHtml()` |
| 3700 | Drive / attachment | `getFolderFromUrl_()` |
| 3712 | Drive / attachment | `processAttachments_()` |
| 3755 | API / HTML bridge | `updateSectionOrderHtml()` |
| 3786 | Utility / normalization | `nowIso_()` |
| 3790 | Approval | `makeApprovalId_()` |
| 3795 | Approval | `makeApproverId_()` |
| 3800 | Approval | `makeApprovalVersionId_()` |
| 3805 | Approval | `makeApprovalLogId_()` |
| 3810 | Approval | `makeApproverToken_()` |
| 3815 | Sheet / data access | `getApprovalSheetHeaders_()` |
| 3825 | Sheet / data access | `ensureApprovalSheet_()` |
| 3837 | Sheet / data access | `ensureAllApprovalSheets_()` |
| 3845 | Sheet / data access | `appendRowToSheet_()` |
| 3855 | Sheet / data access | `updateSheetRow_()` |
| 3898 | Sheet / data access | `ensureBudgetSheet_()` |
| 3920 | Sheet / data access | `ensureBudgetSheets_()` |
| 3929 | Auth / permission | `canViewBudget_()` |
| 3933 | Auth / permission | `canEditBudget_()` |
| 3937 | Budget | `budgetNumber_()` |
| 3946 | Budget | `budgetKind_()` |
| 3953 | Budget | `budgetProjectOrderNo_()` |
| 3962 | Budget | `budgetProjectForUI_()` |
| 3987 | Budget | `budgetCategoryForUI_()` |
| 3997 | Budget | `budgetPlanForUI_()` |
| 4011 | Budget | `budgetTransactionForUI_()` |
| 4030 | Budget | `makeBudgetTransactionId_()` |
| 4043 | Budget | `getBudgetCategoriesCached_()` |
| 4061 | Budget | `invalidateBudgetCache_()` |
| 4066 | API / HTML bridge | `getBudgetBootstrapHtml()` |
| 4142 | API / HTML bridge | `createBudgetTransactionHtml()` |
| 4189 | API / HTML bridge | `deleteBudgetTransactionHtml()` |
| 4204 | Budget | `seedBudgetData_()` |
| 4327 | API / HTML bridge | `setupBudgetSheetsHtml()` |
| 4345 | Sheet / data access | `ensureTodoSheet_()` |
| 4367 | Todo | `makeTodoId_()` |
| 4373 | Auth / permission | `canEditTodoOwner_()` |
| 4377 | Auth / permission | `canViewTodoDashboard_()` |
| 4381 | Auth / permission | `todoOwnerFromSession_()` |
| 4390 | Sheet / data access | `todoRowForUI_()` |
| 4412 | Todo | `getTodoUsersForUI_()` |
| 4416 | API / HTML bridge | `getTodoBootstrapHtml()` |
| 4440 | API / HTML bridge | `getTodoDashboardHtml()` |
| 4513 | API / HTML bridge | `createTodoHtml()` |
| 4547 | Todo | `getTodoById_()` |
| 4553 | API / HTML bridge | `patchTodoHtml()` |
| 4575 | API / HTML bridge | `completeTodoHtml()` |
| 4593 | API / HTML bridge | `deleteTodoHtml()` |
| 4606 | Sheet / data access | `findSheetRow_()` |
| 4611 | Approval | `logApproval_()` |
| 4625 | Approval | `computeDocStatus_()` |
| 4634 | Approval | `normalizeApprovalStatus_()` |
| 4638 | Approval | `isApprovalTerminalStatus_()` |
| 4643 | Approval | `getOrCreateApprovalFolder_()` |
| 4651 | Approval | `uploadApprovalFile_()` |
| 4667 | Approval | `createApprovalDoc_()` |
| 4690 | Approval | `getApprovalDocs_()` |
| 4727 | Approval | `invalidateApprovalCache_()` |
| 4731 | Approval | `getApprovalDoc_()` |
| 4736 | Approval | `updateApprovalDoc_()` |
| 4760 | Approval | `replaceApprovers_()` |
| 4786 | Approval | `cancelApprovalDoc_()` |
| 4800 | Approval | `submitApproval_()` |
| 4827 | Approval | `getDocToken_()` |
| 4838 | Approval | `buildApprovalLinks_()` |
| 4851 | API / HTML bridge | `getApprovalLinksHtml()` |
| 4859 | Calendar / email / reminder | `buildApprovalEmailHtml_()` |
| 4860 | Utility / other | `eg()` |
| 4869 | Approval | `uploadNewApprovalVersion_()` |
| 4893 | Approval | `getApprovalLogsForDoc_()` |
| 4907 | Approval | `getApproverPageData_()` |
| 4937 | Approval | `doApproverAction_()` |
| 4979 | Approval | `getApprovalBootstrap()` |
| 4985 | API / HTML bridge | `createApprovalDocHtml()` |
| 4992 | API / HTML bridge | `updateApprovalDocHtml()` |
| 4999 | API / HTML bridge | `cancelApprovalDocHtml()` |
| 5006 | API / HTML bridge | `submitApprovalHtml()` |
| 5013 | API / HTML bridge | `uploadNewApprovalVersionHtml()` |
| 5020 | API / HTML bridge | `getApprovalLogsHtml()` |
| 5026 | API / HTML bridge | `getApproverPageDataHtml()` |
| 5030 | API / HTML bridge | `doApproverActionHtml()` |
| 5035 | API / HTML bridge | `setupApprovalSheetsHtml()` |
| 5042 | API / HTML bridge | `deleteApprovalDocHtml()` |
| 5056 | Approval | `buildApprovalPublicServerHtml_()` |
| 5057 | Utility / other | `eh()` |
| 5064 | Approval | `fileIdFromDoc_()` |
| 5069 | Drive / attachment | `filePreview_()` |
| 5133 | Approval | `serveApprovalPublicPage_()` |
| 5134 | Utility / other | `sp()` |
| 5304 | Utility / other | `esc()` |
| 5305 | Utility / other | `escAttr()` |
| 5307 | Utility / other | `gs()` |
| 5308 | Utility / normalization | `fmtDate()` |
| 5310 | Drive / attachment | `driveEmbed()` |
| 5322 | Utility / other | `setMode()` |
| 5328 | Utility / other | `render()` |
| 5434 | Utility / other | `bindDynamicActions()` |
| 5445 | Utility / other | `renderDone()` |
| 5458 | Utility / other | `renderError()` |
| 5468 | Utility / other | `doAct()` |

---

## 10. Complete Client Function Inventory (`index.html`)

รวมฟังก์ชัน client-side ที่ตรวจพบ: **242** รายการ

| Line | Category | Function |
|---:|---|---|
| 2360 | Client utility | `esc()` |
| 2361 | Client utility | `escJs()` |
| 2362 | Client utility | `escAttr()` |
| 2363 | Client utility / other | `currentRole_()` |
| 2364 | Task Board / views | `canEditTasksClient_()` |
| 2365 | Client utility / other | `canManageUsersClient_()` |
| 2366 | Client bootstrap / auth | `applyAppMeta_()` |
| 2376 | Client utility / other | `autoResizeTextarea_()` |
| 2384 | Client bootstrap / auth | `storageGet_()` |
| 2387 | Client bootstrap / auth | `storageSet_()` |
| 2390 | Client bootstrap / auth | `storageRemove_()` |
| 2394 | Client bootstrap / auth | `setBootLoading_()` |
| 2439 | Client utility / other | `_glShow()` |
| 2440 | Client utility / other | `_glHide()` |
| 2442 | Client bootstrap / auth | `gsCall()` |
| 2453 | Client bootstrap / auth | `gsCallTry()` |
| 2456 | Client utility / other | `next()` |
| 2471 | Client utility | `fmtDateRange()` |
| 2481 | Client utility | `ymdToLocalDate_()` |
| 2487 | Client utility | `todayLocalDate_()` |
| 2492 | Task Board / views | `getTaskDueStatus()` |
| 2512 | Task Board / views | `getTaskTypes_()` |
| 2513 | Task Board / views | `getActiveTaskTypes_()` |
| 2518 | Client utility | `tagColor()` |
| 2519 | Client utility / other | `getUser()` |
| 2520 | Client utility / other | `getTag()` |
| 2522 | Client utility / other | `ini()` |
| 2524 | Client utility / other | `avEl()` |
| 2531 | Client utility | `detectLinkType()` |
| 2542 | Client utility | `linkIcon()` |
| 2543 | Client utility / other | `fileIcon()` |
| 2544 | Client utility | `sanitizeExternalUrl_()` |
| 2550 | Client utility | `openExternalUrl_()` |
| 2559 | Client utility / other | `hexToRgba_()` |
| 2570 | Client utility | `hashString_()` |
| 2579 | Client utility | `getSectionColor_()` |
| 2586 | Client utility / other | `fileTypeFromName()` |
| 2595 | Task Board / views | `taskMatches()` |
| 2603 | Client utility | `getGroupEarliestDate_()` |
| 2614 | Task Board / views | `sortTasks()` |
| 2641 | Client bootstrap / auth | `login()` |
| 2660 | Client bootstrap / auth | `showLoginErr()` |
| 2662 | Task Board / views | `applyTaskPageResponse()` |
| 2687 | Task Board / views | `adjustTaskPaging()` |
| 2694 | Task Board / views | `loadMoreTasks()` |
| 2721 | Task Board / views | `loadAllTasks()` |
| 2748 | Task Board / views | `loadCompletedTasks()` |
| 2776 | Task Board / views | `refreshBoardData_()` |
| 2806 | Task Board / views | `ensureAllTasksLoaded()` |
| 2816 | Client utility / other | `refreshReminderStats()` |
| 2841 | Client bootstrap / auth | `bootstrap()` |
| 2886 | Client bootstrap / auth | `hydrateAfterLogin()` |
| 2928 | Client utility / other | `ensureMembersLoadedForAssign_()` |
| 2941 | Client utility / other | `ensureCommitteeDataLoaded_()` |
| 2959 | Client utility / other | `ensureUsersDataLoaded_()` |
| 2977 | Client bootstrap / auth | `logout()` |
| 2988 | Client utility / other | `initUI()` |
| 3040 | Rendering / export | `setView()` |
| 3095 | Rendering / export | `updateBadge()` |
| 3106 | Budget UI | `budgetMoney_()` |
| 3111 | Budget UI | `budgetToday_()` |
| 3116 | Budget UI | `budgetProjectById_()` |
| 3120 | Budget UI | `budgetCategoryByCode_()` |
| 3124 | Budget UI | `budgetTxnMonth_()` |
| 3129 | Budget UI | `ensureBudgetLoaded_()` |
| 3137 | Budget UI | `loadBudget()` |
| 3157 | Budget UI | `renderBudgetLoading_()` |
| 3162 | Budget UI | `renderBudget()` |
| 3184 | Budget UI | `calcBudgetTotals_()` |
| 3197 | Budget UI | `renderBudgetFilters_()` |
| 3214 | Budget UI | `getBudgetProjectsFiltered_()` |
| 3224 | Budget UI | `renderBudgetProjects_()` |
| 3234 | Budget UI | `renderBudgetProjectCard_()` |
| 3253 | Budget UI | `renderBudgetForm_()` |
| 3282 | Budget UI | `buildBudgetProjectDetail_()` |
| 3286 | Client utility / other | `ensure()` |
| 3317 | Budget UI | `renderBudgetDetail_()` |
| 3338 | Client utility | `fmt()` |
| 3339 | Client utility / other | `overCls()` |
| 3340 | Rendering / export | `renderCell()` |
| 3356 | Client utility / other | `buildSection()` |
| 3417 | Budget UI | `openBudgetDetail_()` |
| 3424 | Budget UI | `closeBudgetDetail_()` |
| 3429 | Budget UI | `setBudgetDetailView_()` |
| 3434 | Budget UI | `renderBudgetTransactions_()` |
| 3453 | Budget UI | `selectBudgetProject_()` |
| 3463 | Budget UI | `saveBudgetTransaction_()` |
| 3490 | Budget UI | `deleteBudgetTxn_()` |
| 3506 | Budget UI | `exportBudgetReport_()` |
| 3509 | Rendering / export | `csv()` |
| 3532 | Budget UI | `exportBudgetProjectReport_()` |
| 3537 | Rendering / export | `csv()` |
| 3555 | Budget UI | `budgetDetailTotals_()` |
| 3576 | Budget UI | `budgetPdfMoney_()` |
| 3581 | Client utility / other | `openPrintHtml_()` |
| 3589 | Budget UI | `budgetPdfBaseCss_()` |
| 3615 | Budget UI | `exportBudgetOverviewPdf_()` |
| 3669 | Budget UI | `exportBudgetProjectPdf_()` |
| 3673 | Client utility / other | `cell()` |
| 3703 | Budget UI | `bindBudgetEvents()` |
| 3735 | Todo UI | `todoOwner_()` |
| 3739 | Task Board / views | `normalizeEmailClient_()` |
| 3743 | Todo UI | `todoList_()` |
| 3747 | Todo UI | `setTodoList_()` |
| 3751 | Todo UI | `ensureTodoLoaded_()` |
| 3762 | Todo UI | `loadTodo()` |
| 3779 | Todo UI | `setTodoMode()` |
| 3789 | Todo UI | `loadTodoDashboard()` |
| 3807 | Todo UI | `renderTodoLoading_()` |
| 3812 | Todo UI | `todoDateKey_()` |
| 3813 | Client utility / other | `isToday_()` |
| 3819 | Client utility / other | `isOverdue_()` |
| 3826 | Todo UI | `renderTodo()` |
| 3835 | Todo UI | `sortTodo()` |
| 3858 | Todo UI | `renderTodoDashboard()` |
| 3877 | Todo UI | `renderTodoDashboardOwner_()` |
| 3890 | Todo UI | `renderTodoCard_()` |
| 3912 | Todo UI | `updateTodoBadge_()` |
| 3917 | Todo UI | `addTodoQuick()` |
| 3936 | Todo UI | `findTodo_()` |
| 3937 | Todo UI | `patchTodoLocal_()` |
| 3942 | Todo UI | `toggleTodoDone()` |
| 3948 | Todo UI | `toggleTodoPin()` |
| 3953 | Todo UI | `toggleTodoPriority()` |
| 3959 | Todo UI | `deleteTodo()` |
| 3966 | Todo UI | `bindTodoEvents()` |
| 3976 | Task Board / views | `renderBoard()` |
| 4076 | Task Board / views | `renderBoardLoadMoreBar()` |
| 4108 | Task Board / views | `getPendingFilterState()` |
| 4116 | Client utility | `formatDateThai()` |
| 4122 | Client utility | `formatDateRangeShort()` |
| 4130 | Client utility / other | `formatTimeRange()` |
| 4137 | Task Board / views | `getTaskAssigneeEntries()` |
| 4151 | Task Board / views | `getTaskAssigneeText()` |
| 4156 | Task Board / views | `getTaskOwnerText_()` |
| 4161 | Task Board / views | `getPendingTasksByFilter()` |
| 4167 | Client utility / other | `toYMD()` |
| 4213 | Task Board / views | `getPendingDueInfo()` |
| 4240 | Task Board / views | `renderPending()` |
| 4281 | Task Board / views | `renderPendingLoadMoreBar()` |
| 4297 | Task Board / views | `buildPendingCsv()` |
| 4298 | Rendering / export | `csvEscape()` |
| 4315 | Task Board / views | `getPendingFilterSummary()` |
| 4340 | Task Board / views | `exportPendingCsv()` |
| 4359 | Task Board / views | `exportPendingPdf()` |
| 4433 | Task Board / views | `initSortableDragAndDrop()` |
| 4492 | Task Board / views | `renderTaskCard()` |
| 4559 | Task Board / views | `renderSubTaskCard_()` |
| 4576 | Task Board / views | `bindBoardEvents()` |
| 4669 | Client utility / other | `save()` |
| 4731 | Task Board / views | `openEditTask()` |
| 4738 | Task Board / views | `openModal()` |
| 4752 | Task Board / views | `closeModal()` |
| 4757 | Task Board / views | `isModalReadOnly_()` |
| 4761 | Task Board / views | `enableModalEdit_()` |
| 4768 | Task Board / views | `renderModal()` |
| 4881 | Task Board / views | `renderMemberSelector()` |
| 4922 | Client utility / other | `switchMemberTab_()` |
| 4930 | Client utility / other | `toggleCommitteeGroupSelection_()` |
| 4944 | Client utility / other | `toggleCommitteeMemberSelection_()` |
| 4957 | Client utility | `updateGroupList()` |
| 4968 | Client utility | `updateMemList()` |
| 5002 | Client utility | `updateMemSummary()` |
| 5026 | Task Board / views | `normalizeChecklist_()` |
| 5059 | Task Board / views | `renderChecklist()` |
| 5084 | Task Board / views | `getSubTasks_()` |
| 5090 | Task Board / views | `renderSubTasks_()` |
| 5122 | Task Board / views | `openCreateSubTask_()` |
| 5137 | Task Board / views | `renderDriveSection()` |
| 5156 | Task Board / views | `saveDrive()` |
| 5162 | Task Board / views | `renderAttachments()` |
| 5192 | Rendering / export | `renderActivity()` |
| 5207 | Task Board / views | `collectModalData()` |
| 5224 | Task Board / views | `saveTask()` |
| 5299 | Task Board / views | `getCalendarSyncUi()` |
| 5310 | Task Board / views | `getCalendarSyncUiResolved()` |
| 5319 | Client utility / other | `toggleComplete()` |
| 5352 | Task Board / views | `deleteTask()` |
| 5385 | Task Board / views | `showEmailPreview()` |
| 5476 | Task Board / views | `copyTextToClipboard_()` |
| 5497 | Task Board / views | `buildLineMessageFromTask_()` |
| 5517 | Task Board / views | `shareTaskToLine()` |
| 5537 | Task Board / views | `getAnnualFilterState()` |
| 5553 | Task Board / views | `renderAnnualTagMulti_()` |
| 5579 | Task Board / views | `getAnnualFilteredTasks()` |
| 5594 | Task Board / views | `getAnnualDensityClass_()` |
| 5604 | Task Board / views | `fitAnnualYear_()` |
| 5648 | Task Board / views | `scheduleAnnualFit_()` |
| 5655 | Task Board / views | `buildAnnualMonths_()` |
| 5676 | Task Board / views | `renderAnnualTaskChip_()` |
| 5685 | Task Board / views | `renderAnnual()` |
| 5727 | Task Board / views | `exportAnnualPdf()` |
| 5740 | Task Board / views | `renderPdfTask_()` |
| 5748 | Rendering / export | `renderMonthBlock_()` |
| 5760 | Client utility / other | `chunks_()` |
| 5884 | Task Board / views | `renderCalendar()` |
| 5896 | Task Board / views | `getTasksForDate()` |
| 5908 | Client utility | `getTagColor()` |
| 5968 | Rendering / export | `renderCommittee()` |
| 6084 | Rendering / export | `renderUsers()` |
| 6158 | Client utility / other | `bindEvents()` |
| 6406 | Client utility / other | `handleFiles()` |
| 6430 | Client utility / other | `formatSize()` |
| 6432 | Client utility | `addLink()` |
| 6454 | Approval UI | `loadApprovalDocs()` |
| 6461 | Approval UI | `refreshApprovalIfVisible_()` |
| 6471 | Approval UI | `apvToast()` |
| 6480 | Approval UI | `fmtApvDate_()` |
| 6486 | Client utility / other | `setUploadZone()` |
| 6497 | Approval UI | `renderApvDocPreview()` |
| 6515 | Approval UI | `renderApvChainView()` |
| 6546 | Approval UI | `filterApproval()` |
| 6554 | Approval UI | `renderApproval()` |
| 6577 | Client utility | `docSortDate_()` |
| 6582 | Rendering / export | `renderDocCard_()` |
| 6648 | Approval UI | `updateApprovalSummary()` |
| 6661 | Client utility / other | `metric()` |
| 6674 | Approval UI | `updateApprovalBadge()` |
| 6687 | Approval UI | `openApprovalModal()` |
| 6742 | Approval UI | `closeApprovalModal()` |
| 6748 | Approval UI | `renderApproverInputs()` |
| 6770 | Approval UI | `removeApproverRow()` |
| 6775 | Approval UI | `collectApprovers()` |
| 6786 | Client utility / other | `toggleMemberPicker()` |
| 6796 | Rendering / export | `renderMemberPickerList()` |
| 6814 | Approval UI | `addApproverFromMember()` |
| 6821 | Approval UI | `addManualApprover()` |
| 6829 | Approval UI | `saveApprovalDoc()` |
| 6850 | Approval UI | `submitApprovalDoc()` |
| 6880 | Client utility | `showLinksPanel()` |
| 6894 | Approval UI | `copyApprovalLink()` |
| 6906 | Client utility | `getAndShowLinks()` |
| 6916 | Approval UI | `deleteApprovalDoc()` |
| 6934 | Approval UI | `exportApprovalReportPdf()` |
| 6943 | Client utility / other | `statusLabel()` |
| 6944 | Approval UI | `approverRows()` |
| 6988 | Approval UI | `cancelApprovalDoc()` |
| 6997 | Approval UI | `showApprovalLogs()` |
| 7015 | Approval UI | `handleApprovalFile()` |
| 7042 | Approval UI | `bindApprovalVersionModal()` |
| 7083 | Approval UI | `bindApprovalEvents()` |
| 7128 | Client bootstrap / auth | `boot()` |

---

## 11. Implementation Priority if Rebuilding

1. Freeze schema from actual workbook columns, not only from the earlier blueprint.
2. Rebuild Auth/RLS first because almost every module depends on role/permission.
3. Migrate master data: committees, members, users, sections, task types.
4. Migrate tasks + task_members + activity_log with UUID mapping.
5. Rebuild task board service and UI.
6. Rebuild approval with per-approver token and transaction-safe action.
7. Rebuild budget and todo modules.
8. Rebuild calendar/email/reminder integration after task model is stable.

---

*Generated from current Apps Script + uploaded workbook data for YEC Task Manager migration planning.*