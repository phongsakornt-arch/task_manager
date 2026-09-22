-- ============================================================
-- YEC Task Manager — Initial Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pg_net";

-- ============================================================
-- Helper: updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. committees
-- ============================================================

CREATE TABLE committees (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text UNIQUE,
  name       text NOT NULL,
  name_en    text,
  color      text,
  icon       text,
  head_name  text,
  head_email text,
  active     boolean DEFAULT true
);

-- ============================================================
-- 2. members
-- ============================================================

CREATE TABLE members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text UNIQUE,
  committee_id        uuid REFERENCES committees(id),
  name_th             text NOT NULL,
  name_en             text,
  nickname            text,
  position_yec        text,
  position_committee  text,
  email               text,
  phone               text,
  photo_url           text,
  lot                 text,
  active              boolean DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TRIGGER members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. users (ผูกกับ Supabase Auth)
-- ============================================================

CREATE TABLE users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text UNIQUE NOT NULL,
  name       text NOT NULL,
  role       text NOT NULL DEFAULT 'member'
               CHECK (role IN ('super_admin','admin','editor','member')),
  member_id  uuid REFERENCES members(id),
  active     boolean DEFAULT true,
  last_login timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    'member'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- Helper: current_user_role (ต้องสร้างหลัง users table)
-- ============================================================

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS text AS $$
  SELECT COALESCE(
    (SELECT role FROM public.users WHERE id = auth.uid()),
    'member'
  )
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- 4. sections
-- ============================================================

CREATE TABLE sections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text UNIQUE,
  title      text NOT NULL,
  color      text,
  icon       text,
  sort_order int DEFAULT 0,
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 5. task_types
-- ============================================================

CREATE TABLE task_types (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL,
  color text NOT NULL
);

-- ============================================================
-- 6. tasks
-- ============================================================

CREATE TABLE tasks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text UNIQUE,
  section_id               uuid REFERENCES sections(id),
  title                    text NOT NULL,
  description              text,
  start_date               date,
  end_date                 date,
  start_time               time,
  end_time                 time,
  task_type_id             uuid REFERENCES task_types(id),
  owner_id                 uuid REFERENCES users(id),
  parent_task_id           uuid REFERENCES tasks(id),
  tags                     text[] DEFAULT '{}',
  checklist                jsonb DEFAULT '[]',
  attachments              jsonb DEFAULT '[]',
  drive_folder_url         text,
  calendar_event_id        text,
  calendar_event_url       text,
  calendar_last_sync_hash  text,
  calendar_sync_status     text,
  calendar_last_sync_at    timestamptz,
  completed                boolean DEFAULT false,
  completed_at             timestamptz,
  deleted                  boolean DEFAULT false,
  deleted_at               timestamptz,
  deleted_by               uuid REFERENCES users(id),
  created_by               uuid REFERENCES users(id),
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. task_members
-- ============================================================

CREATE TABLE task_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id    uuid REFERENCES members(id),
  committee_id uuid REFERENCES committees(id),
  role         text DEFAULT 'assignee' CHECK (role IN ('assignee','watcher')),
  created_at   timestamptz DEFAULT now(),
  UNIQUE(task_id, member_id),
  CHECK (member_id IS NOT NULL OR committee_id IS NOT NULL)
);

-- ============================================================
-- 8. approval_documents
-- ============================================================

CREATE TABLE approval_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,
  title            text NOT NULL,
  description      text,
  drive_file_id    text,
  file_url         text,
  file_name        text,
  mime_type        text,
  version          int DEFAULT 1,
  status           text DEFAULT 'draft'
    CHECK (status IN ('draft','pending','approved','revision_requested','cancelled')),
  deleted          boolean DEFAULT false,
  deleted_at       timestamptz,
  created_by       uuid REFERENCES users(id),
  created_by_email text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TRIGGER approval_documents_updated_at
  BEFORE UPDATE ON approval_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. approval_approvers
-- ============================================================

CREATE TABLE approval_approvers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id    uuid NOT NULL REFERENCES approval_documents(id) ON DELETE CASCADE,
  order_no       int NOT NULL,
  approver_name  text NOT NULL,
  approver_email text NOT NULL,
  member_id      uuid REFERENCES members(id),
  token          text UNIQUE DEFAULT gen_random_uuid()::text,
  status         text DEFAULT 'waiting'
    CHECK (status IN ('waiting','approved','revision_requested')),
  acted_at       timestamptz,
  note           text,
  sent_at        timestamptz,
  UNIQUE(approval_id, order_no)
);

-- ============================================================
-- 10. approval_versions
-- ============================================================

CREATE TABLE approval_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id   uuid NOT NULL REFERENCES approval_documents(id) ON DELETE CASCADE,
  version       int NOT NULL,
  drive_file_id text,
  file_url      text,
  file_name     text,
  uploaded_by   uuid REFERENCES users(id),
  uploaded_at   timestamptz DEFAULT now(),
  change_note   text
);

-- ============================================================
-- 11. approval_logs
-- ============================================================

CREATE TABLE approval_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id  uuid NOT NULL REFERENCES approval_documents(id) ON DELETE CASCADE,
  approver_id  uuid REFERENCES approval_approvers(id),
  action       text NOT NULL,
  detail       text,
  actor_email  text,
  meta         jsonb,
  created_at   timestamptz DEFAULT now()
);

-- ============================================================
-- 12. budget_categories
-- ============================================================

CREATE TABLE budget_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_code text UNIQUE NOT NULL,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('revenue','expense')),
  sort_order      int DEFAULT 0,
  active          boolean DEFAULT true
);

-- ============================================================
-- 13. budget_projects
-- ============================================================

CREATE TABLE budget_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,
  fiscal_year      int NOT NULL,
  department_code  text NOT NULL,
  project_name     text NOT NULL,
  external_code    text,
  budget_filter    text,
  budget_category  text,
  project_type     text,
  planned_revenue  numeric DEFAULT 0,
  planned_expense  numeric DEFAULT 0,
  planned_net      numeric DEFAULT 0,
  owner_member_id  uuid REFERENCES members(id),
  status           text DEFAULT 'active',
  approved_date    date,
  source_file      text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TRIGGER budget_projects_updated_at
  BEFORE UPDATE ON budget_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 14. budget_plans
-- ============================================================

CREATE TABLE budget_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES budget_projects(id) ON DELETE CASCADE,
  accounting_code  text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('revenue','expense')),
  month            int NOT NULL CHECK (month BETWEEN 1 AND 12),
  planned_amount   numeric DEFAULT 0,
  UNIQUE(project_id, accounting_code, kind, month)
);

-- ============================================================
-- 15. budget_transactions
-- ============================================================

CREATE TABLE budget_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,
  project_id       uuid NOT NULL REFERENCES budget_projects(id),
  accounting_code  text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('revenue','expense')),
  transaction_date date NOT NULL,
  amount           numeric NOT NULL,
  vendor           text,
  description      text,
  receipt_url      text,
  receipt_file_id  text,
  created_by       uuid REFERENCES users(id),
  deleted          boolean DEFAULT false,
  deleted_at       timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- ============================================================
-- 16. todo_items
-- ============================================================

CREATE TABLE todo_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE,
  owner_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  owner_email      text,
  owner_name       text,
  created_by       uuid REFERENCES users(id),
  created_by_email text,
  title            text NOT NULL,
  note             text,
  status           text DEFAULT 'open' CHECK (status IN ('open','done','archived')),
  priority         text DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  due_date         date,
  due_time         time,
  pinned           boolean DEFAULT false,
  sort_order       bigint,
  completed_at     timestamptz,
  deleted          boolean DEFAULT false,
  deleted_at       timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TRIGGER todo_items_updated_at
  BEFORE UPDATE ON todo_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 17. activity_log
-- ============================================================

CREATE TABLE activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id),
  actor_email text,
  action      text NOT NULL,
  detail      text,
  meta        jsonb,
  created_at  timestamptz DEFAULT now()
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE committees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "committees_read_all" ON committees FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "committees_write_admin" ON committees FOR ALL USING (current_user_role() IN ('admin','super_admin'));

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_read_all" ON members FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "members_write_admin" ON members FOR ALL USING (current_user_role() IN ('admin','super_admin'));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_self_or_admin" ON users FOR SELECT USING (
  id = auth.uid() OR current_user_role() IN ('admin','super_admin')
);
CREATE POLICY "users_manage_superadmin" ON users FOR ALL USING (current_user_role() = 'super_admin');

ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sections_read_all" ON sections FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "sections_write_admin" ON sections FOR ALL USING (current_user_role() IN ('admin','super_admin'));

ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_types_read_all" ON task_types FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "task_types_write_admin" ON task_types FOR ALL USING (current_user_role() IN ('admin','super_admin'));

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_read_all" ON tasks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "tasks_write_editor" ON tasks FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE task_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_members_read_all" ON task_members FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "task_members_write_editor" ON task_members FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE approval_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_read_all" ON approval_documents FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "approval_write_editor" ON approval_documents FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE approval_approvers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approvers_read_all" ON approval_approvers FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "approvers_write_editor" ON approval_approvers FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE approval_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_versions_read_all" ON approval_versions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "approval_versions_write_editor" ON approval_versions FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE approval_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_logs_read_all" ON approval_logs FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "approval_logs_insert_all" ON approval_logs FOR INSERT WITH CHECK (true);

ALTER TABLE budget_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_cat_read_all" ON budget_categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "budget_cat_write_admin" ON budget_categories FOR ALL USING (current_user_role() IN ('admin','super_admin'));

ALTER TABLE budget_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_projects_read_all" ON budget_projects FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "budget_projects_write_editor" ON budget_projects FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE budget_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_plans_read_all" ON budget_plans FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "budget_plans_write_editor" ON budget_plans FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE budget_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_tx_read_all" ON budget_transactions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "budget_tx_write_editor" ON budget_transactions FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

ALTER TABLE todo_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "todo_own_or_admin" ON todo_items FOR ALL USING (
  owner_id = auth.uid() OR current_user_role() IN ('admin','super_admin')
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_read_admin" ON activity_log FOR SELECT USING (current_user_role() IN ('admin','super_admin'));
CREATE POLICY "activity_insert_all" ON activity_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
