# YEC Task Manager — Project Handover

> สรุปโปรเจกต์ทั้งหมดเพื่อทำต่อในเครื่องอื่น  
> อัปเดต: 2026-05-08

---

## 1. Overview

ระบบ Task Manager สำหรับ YEC หอการค้าไทย  
สร้างด้วย React + TypeScript + Supabase  
ธีมสี: Navy `#1a2744` / Gold `#c9a84c`  
Font: Kanit (หัวข้อ) + Sarabun (เนื้อหา) จาก Google Fonts

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS v4 + Inline styles |
| State | Zustand 5 |
| Routing | React Router DOM 7 |
| Backend | Supabase (PostgreSQL + Auth + Realtime + RLS) |
| Drag & Drop | @dnd-kit/core + @dnd-kit/sortable |
| Date | date-fns + date-fns/locale/th |
| Calendar (ยังไม่ build) | react-big-calendar |
| Image | Cloudinary |

---

## 3. Keys & Credentials

### Supabase
```
Project URL:    https://quyntrtlfszwkhbuyylr.supabase.co
Anon Key:       ดูใน .env (VITE_SUPABASE_ANON_KEY) — อย่า commit ค่าจริงลง git
Project Ref:    quyntrtlfszwkhbuyylr
Dashboard:      https://supabase.com/dashboard/project/quyntrtlfszwkhbuyylr
```

### Cloudinary
```
Cloud Name:     dqgt00rk0
Dashboard:      https://cloudinary.com/console
```

### Resend (SMTP สำหรับ Magic Link email)
```
API Key:        ดูใน Supabase secrets (RESEND_API_KEY) — อย่า commit ค่าจริงลง git
SMTP Host:      smtp.resend.com
SMTP Port:      465
SMTP User:      resend
Dashboard:      https://resend.com/api-keys
```

### Supabase Auth Settings (ต้องตั้งค่าในทุกเครื่อง dev)
```
Site URL:       http://localhost:5173
Redirect URLs:  http://localhost:5173/auth/callback
                http://localhost:5174/auth/callback
Auth Dashboard: https://supabase.com/dashboard/project/quyntrtlfszwkhbuyylr/auth/url-configuration
```

### Admin Account
```
Email:  phongsakorn.t@thaichamber.org
Role:   super_admin
Login:  ใช้ Magic Link (ส่งลิงก์ไปที่ email)
```

---

## 4. Project Structure

```
yec-taskmanager/
├── .env                          ← API keys (ดู section 3)
├── package.json
├── vite.config.ts
├── supabase/
│   └── migrations/
│       └── 20260507000001_initial_schema.sql   ← SQL schema ทั้งหมด
└── src/
    ├── main.tsx
    ├── App.tsx                   ← Routes + RequireAuth guard
    ├── index.css                 ← Google Fonts + global styles
    ├── lib/
    │   └── supabase.ts           ← Supabase client
    ├── types/
    │   └── index.ts              ← TypeScript types ทั้งหมด
    ├── stores/
    │   ├── authStore.ts          ← Zustand: user, session, login/logout
    │   └── taskStore.ts          ← Zustand: tasks, sections, taskTypes
    ├── hooks/
    │   ├── useTasks.ts           ← Load tasks + completeTask + deleteTask
    │   └── useRealtimeTasks.ts   ← Supabase Realtime subscription
    ├── components/
    │   ├── AppShell.tsx          ← Sidebar + layout wrapper
    │   ├── TaskCard.tsx          ← Kanban card component
    │   └── TaskModal.tsx         ← Add/Edit/Delete task modal
    └── pages/
        ├── LoginPage.tsx         ← Magic Link OTP login
        ├── AuthCallback.tsx      ← OAuth callback handler
        ├── Board/BoardPage.tsx   ← ✅ Kanban board (เสร็จแล้ว)
        ├── Pending/PendingPage.tsx    ← ✅ งานค้างจาก Supabase view
        ├── Calendar/CalendarPage.tsx  ← 🔲 ยังไม่ build
        ├── Annual/AnnualPage.tsx      ← 🔲 ยังไม่ build
        ├── Budget/BudgetPage.tsx      ← 🔲 ยังไม่ build
        ├── Directory/DirectoryPage.tsx ← ✅ ทำเนียบคณะกรรมการ + add/edit/delete
        ├── Approval/ApprovalPage.tsx  ← 🔲 ยังไม่ build
        ├── Todo/TodoPage.tsx          ← 🔲 ยังไม่ build
        └── Users/UsersPage.tsx        ← 🔲 ยังไม่ build
```

---

## 5. Database Schema (17 Tables)

```sql
committees       — คณะกรรมการ YEC
members          — สมาชิก 142 คน (import แล้วจาก `old data/YEC Task Manager.xlsx`, มี `sort_order` ตามลำดับชีต และ `province` แยกจากตำแหน่ง)
users            — ผู้ใช้ระบบ (linked กับ Supabase Auth)
sections         — สถานะงาน (Backlog / กำลังดำเนินการ / รอตรวจสอบ / เสร็จแล้ว)
task_types       — ประเภทงาน (มีสี)
tasks            — งานทั้งหมด (มี checklist[], attachments[], tags[])
task_members     — ผู้รับผิดชอบงาน (assignee / watcher)
approval_documents   — เอกสารขออนุมัติ
approval_approvers   — ผู้อนุมัติ
approval_versions    — version เอกสาร
approval_logs        — log การอนุมัติ
budget_categories    — หมวดงบประมาณ
budget_projects      — โครงการ
budget_plans         — แผนงบ
budget_transactions  — รายการเบิกจ่าย
todo_items           — รายการ Todo ส่วนตัว
activity_log         — log กิจกรรมทั้งหมด
pending_tasks        — view สำหรับหน้า Pending (คำนวณ overdue/today/soon/unscheduled)
```

### Seed Data ที่มีอยู่แล้ว

**sections:**
| code | title |
|------|-------|
| S001 | Backlog |
| S002 | กำลังดำเนินการ |
| S003 | รอตรวจสอบ |
| S004 | เสร็จแล้ว |

**task_types:** ประชุม, โครงการ, เอกสาร, ติดตาม, อื่นๆ

---

## 6. Features ที่เสร็จแล้ว (Board)

- [x] Kanban board 4 columns พร้อม gradient theme ตามสี column
- [x] Drag & drop ข้าม column (optimistic update)
- [x] Task card: type badge, title, description, checklist progress bar, due date badge, assignee avatars
- [x] Checkbox complete/uncomplete task
- [x] Done tasks collapsible section ใต้แต่ละ column
- [x] Task count badge per column
- [x] Search กรองชื่อ + description
- [x] Realtime sync (INSERT dedup + UPDATE preserves joins)
- [x] Add task modal (ปุ่ม header + ปุ่ม column + คลิก empty state)
- [x] Edit task modal (คลิก card)
- [x] Delete task พร้อม 2-step confirm
- [x] Assignees: ค้นหาชื่อ + chip + remove
- [x] Checklist: เพิ่ม / tick / แก้ text inline / ลบ
- [x] วันเริ่ม / วันสิ้นสุด
- [x] ประเภทงาน selector
- [x] Keyboard shortcut: Ctrl+Enter บันทึก, Esc ปิด modal

---

## 7. สิ่งที่ยังต้องทำ

### ด่วน
- [x] **Import สมาชิก 142 คน** เข้า `members` table จาก `old data/YEC Task Manager.xlsx`
- [x] **หน้า Pending** — แสดงงานที่เกินกำหนดและใกล้ครบกำหนดผ่าน Supabase view `pending_tasks`
- [x] **หน้า Directory** — แสดงรายชื่อสมาชิกตามคณะกรรมการ ค้นหา/กรองได้ และเรียงตาม `members.sort_order` จากชีต Excel
- [x] **จัดการกรรมการ** — เพิ่ม/แก้ไข/ลบแบบ soft delete ผ่าน Supabase
- [x] **จัดการคณะกรรมการ** — เพิ่ม/แก้ไข/ปิดใช้งานคณะกรรมการผ่าน Supabase

### ต่อไป
- [ ] **หน้า Calendar** — ใช้ `react-big-calendar` แสดง task ตามวันที่
- [ ] **หน้า Todo** — todo list ส่วนตัวแต่ละ user
- [ ] **หน้า Approval** — workflow อนุมัติเอกสาร
- [ ] **หน้า Annual** — overview งานรายปี
- [ ] **หน้า Budget** — ติดตามงบประมาณ
- [ ] **หน้า Users** — จัดการผู้ใช้ระบบ (admin only)
- [ ] **Deploy to Vercel** — production URL

---

## 8. งานล่าสุดที่ทำแล้ว (2026-05-08)

### Supabase remote

- Import `committees` จาก `old data/YEC Task Manager.xlsx` แล้ว: 7 รายการ
- Import `members` จากชีต `Members` แล้ว: 142 รายการ
- เพิ่ม `members.sort_order` และ re-import ให้ตรงลำดับแถวใน Excel
- เพิ่ม `members.province` แยกจากตำแหน่ง YEC และ normalize จังหวัดจากข้อมูลเดิม
- Normalize เบอร์โทรจาก Excel ใหม่ แก้เคส scientific notation เช่น `6.51936565E8` → `0651936565`
- เพิ่ม view `public.pending_tasks` สำหรับหน้า Pending
- เพิ่ม RPC:
  - `create_member()` สร้าง `code` แบบ `Mxxx` และ `sort_order` อัตโนมัติ
  - `create_committee()` สร้าง `code` แบบ `CGxx` อัตโนมัติ

### Frontend

- หน้า Directory เปลี่ยนเป็น **ทำเนียบคณะกรรมการ**
- แสดงสมาชิก grouped ตามคณะกรรมการ
- เรียงสมาชิกตาม `members.sort_order` จาก Excel ไม่เดา order จากข้อความตำแหน่ง
- Card สมาชิกแสดง `position_committee` เป็นตำแหน่งหลัก และแสดง `province` เฉพาะชื่อจังหวัด
- เพิ่มปุ่ม **เพิ่มกรรมการ** และ modal add/edit member
- เพิ่มปุ่ม **ลบกรรมการ** ใน modal edit โดยลบแบบ soft delete (`active=false`)
- เพิ่มปุ่ม **จัดการคณะกรรมการ** พร้อม modal add/edit/disable committee
- หน้า Pending query จาก Supabase view `pending_tasks` โดยตรง

### Migration files ที่เพิ่ม

- `20260508000002_pending_tasks_view.sql`
- `20260508000003_members_sort_order.sql`
- `20260508000004_members_province_create_member.sql`
- `20260508000005_create_committee_rpc.sql`

### Verification ล่าสุด

- `tsc -b` ผ่าน
- `vite build` ผ่าน
- ESLint ไม่มี error ใน Directory; ทั้งโปรเจกต์ยังเหลือ warning เดิม 3 จุดจาก hook deps ใน `App.tsx`, `TaskModal.tsx`, `useTasks.ts`
- Vite ยังเตือน bundle ใหญ่กว่า 500 kB ซึ่งยังไม่ block การทำงาน

---

## 9. แนวทางพัฒนาต่อจาก `function.md`

ให้ใช้ `UPGRADE.md` เป็น handover หลักของระบบปัจจุบัน และใช้ `function.md` เป็น reference ของ business logic จากระบบเดิมบน Google Apps Script ทุกครั้งที่สร้างหรือแก้ module สำคัญ

### หลักการพัฒนา

- อ้างอิง schema จาก migration ปัจจุบันร่วมกับ column จริงที่ระบุใน `function.md` ไม่ยึดเฉพาะ blueprint เก่า
- ทุก feature ต้องเคารพ role เดิม: `member`, `editor`, `admin`, `super_admin`
- ทุก query/write ที่เกี่ยวกับข้อมูลผู้ใช้ต้องผ่าน Supabase Auth + RLS และ helper role เช่น `current_user_role()`
- ทุก write สำคัญควรมี optimistic UI เฉพาะเมื่อ rollback ได้ และต้องบันทึก `activity_log` เมื่อเป็น action ระดับระบบ
- logic ที่เดิมใช้ Apps Script lock/cache ให้แปลงเป็นแนวทาง Supabase/Postgres ที่ transaction-safe และไม่พึ่ง state ฝั่ง client อย่างเดียว
- ข้อมูลที่เป็น array/json ในระบบใหม่ เช่น `checklist`, `attachments`, `tags` ต้อง normalize รูปแบบก่อน save และรองรับข้อมูลว่างอย่างปลอดภัย

### ลำดับ rebuild ที่ต้องยึด

1. ตรวจ schema จริงจาก workbook/source เดิมก่อนเพิ่ม field ใหม่
2. ทำ Auth/RLS และ permission guard ให้แน่นก่อนเปิดหน้า module
3. Import master data: committees, members, users, sections, task types
4. Migrate tasks, task_members, activity_log พร้อม mapping id ให้คงความสัมพันธ์
5. ต่อเติม Task Board ให้ครบตาม spec เดิม เช่น parent/subtask, attachment, activity, email/calendar metadata
6. ทำ Approval โดยต้องมี per-approver token และ action แบบ transaction-safe
7. ทำ Budget และ Todo หลัง master data กับ permission พร้อมแล้ว
8. ทำ Calendar/Email/Reminder หลัง task model stable แล้วเท่านั้น

### Feature rules จากระบบเดิม

- **Task Board:** create/update/delete/complete ต้องเป็น `editor` ขึ้นไป, delete เป็น soft delete, parent task ย้าย section แล้ว subtasks ต้องตามไปด้วย
- **Attachment:** จำกัดชนิดไฟล์และขนาดตาม spec เดิม, เก็บ metadata ให้ preview/reopen ได้, ถ้า upload สำเร็จแต่ DB fail ต้องมีแนวทาง cleanup หรือ retry
- **Calendar:** task ที่มี `start_date` ควร sync event, รองรับ all-day, default duration 1 ชั่วโมงเมื่อมี start time แต่ไม่มี end time, ใช้ hash/metadata กัน sync ซ้ำ
- **Email Reminder:** reminder ใช้ timezone `Asia/Bangkok`, ส่งเฉพาะงานที่ใกล้กำหนดและยังไม่ complete, ต้อง dedupe ไม่ให้ส่งซ้ำในวันเดียวกัน
- **Approval:** public approver link ใช้ token เฉพาะคนอนุมัติ, status ต้องเปลี่ยนแบบมี log และป้องกัน action ซ้ำ
- **Budget:** view/edit ต้องแยก permission ชัด, transaction ใช้ soft delete และ invalidate cache หลัง write
- **Todo:** user แก้ได้เฉพาะ todo ของตัวเอง, `super_admin` เท่านั้นที่ดู dashboard รวม

### สิ่งที่ไม่ควรยกจากระบบเดิมมาตรง ๆ

- ไม่ใช้ email-only login แบบเดิม ให้ใช้ Supabase Magic Link/Auth ต่อไป
- ไม่ใช้ GET endpoint สำหรับ session token หรือข้อมูลลับ
- ไม่ย้าย Apps Script cache/session model มาใช้ตรง ๆ
- ไม่ผูกระบบใหม่กับ Google Sheets เป็น source of truth อีกแล้ว ให้ Supabase เป็นฐานข้อมูลหลัก
- ไม่ทำ calendar/email integration ก่อน schema task และ permission เสถียร

---

## 10. Setup ในเครื่องใหม่

```bash
# 1. Clone หรือ copy โปรเจกต์
cd yec-taskmanager

# 2. ติดตั้ง dependencies
npm install

# 3. สร้างไฟล์ .env
# (copy จาก section 3 ด้านบน)
VITE_SUPABASE_URL=https://quyntrtlfszwkhbuyylr.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_ouOoZ8iiey0EsZwa3BdYcA_aeOgu887
VITE_CLOUDINARY_CLOUD_NAME=dqgt00rk0

# 4. รัน dev server
npm run dev
# → เปิดที่ http://localhost:5173

# 5. Login
# ไปที่ http://localhost:5173
# ใส่ email: phongsakorn.t@thaichamber.org
# กด "ส่ง Magic Link"
# เปิด email แล้วคลิกลิงก์
```

> **หมายเหตุ:** ถ้า Magic Link redirect ไปผิด port ให้เปลี่ยน port ใน URL ด้วยมือ  
> หรือไปตั้ง Site URL ใน Supabase Dashboard → Authentication → URL Configuration

---

## 11. Supabase CLI (optional สำหรับ migration)

```bash
# ติดตั้งผ่าน Scoop (Windows)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Link กับ project
supabase link --project-ref quyntrtlfszwkhbuyylr

# รัน migration (ถ้า schema ยังไม่มี)
supabase db push --linked

# Query ตรงไปที่ remote DB
supabase db query --linked "SELECT count(*) FROM members"
```

---

## 12. Notes สำคัญ

- **Magic Link rate limit** บน Supabase free tier = 2 emails/hour → ใช้ Resend SMTP แทน (ตั้งค่าแล้ว)
- **RLS** เปิดอยู่ทุก table — ถ้า query ไม่มีข้อมูลให้ตรวจ policy ใน Supabase Dashboard
- **`current_user_role()`** — helper function ใน DB ดึง role จาก `public.users` table
- **`create_member()`** — RPC สำหรับเพิ่มกรรมการใหม่ โดยสร้าง `code` และ `sort_order` ให้อัตโนมัติ
- **`create_committee()`** — RPC สำหรับเพิ่มคณะกรรมการใหม่ โดยสร้าง `code` รูปแบบ `CGxx` ให้อัตโนมัติ
- **Realtime** ต้องเปิด Replication ใน Supabase สำหรับ table `tasks` (Dashboard → Database → Replication)
- **Node.js path** บนเครื่องนี้อยู่ที่ `C:\Program Files\nodejs\` (ไม่อยู่ใน PATH อัตโนมัติ)
- **Supabase CLI** ติดตั้งผ่าน Scoop อยู่ที่ `%USERPROFILE%\scoop\shims\supabase.exe`
