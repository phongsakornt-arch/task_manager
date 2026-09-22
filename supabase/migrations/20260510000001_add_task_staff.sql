-- Store task staff assignments against application users.
-- task_members remains for committee/member participation.

CREATE TABLE IF NOT EXISTS task_staff (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(task_id, user_id)
);

ALTER TABLE task_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_staff_read_all" ON task_staff;
CREATE POLICY "task_staff_read_all" ON task_staff
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "task_staff_write_editor" ON task_staff;
CREATE POLICY "task_staff_write_editor" ON task_staff
  FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'))
  WITH CHECK (current_user_role() IN ('editor','admin','super_admin'));

