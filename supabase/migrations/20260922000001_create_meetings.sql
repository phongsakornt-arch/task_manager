-- ============================================================
-- Meeting check-in module (เช็คชื่อเข้าประชุม)
-- ============================================================

CREATE TABLE meetings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  title       text NOT NULL,
  tag         text,
  date        date NOT NULL,
  time        text,
  location    text,
  format      text NOT NULL DEFAULT 'onsite' CHECK (format IN ('onsite', 'online', 'hybrid')),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE meeting_members (
  meeting_id  uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, member_id)
);

-- 1 คน ตอบได้ 1 ครั้งต่อ 1 ประชุม (upsert แก้ไขคำตอบได้)
-- attend_mode ใช้เฉพาะประชุมแบบ hybrid ตอนตอบว่า "เข้าร่วม"
CREATE TABLE meeting_responses (
  meeting_id    uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('going', 'leave')),
  attend_mode   text CHECK (attend_mode IN ('onsite', 'online')),
  responded_at  timestamptz DEFAULT now(),
  PRIMARY KEY (meeting_id, member_id)
);

-- อ่าน/แก้ไขต้อง login เสมอ — หน้าเช็คชื่อสาธารณะ (ไม่ login) เข้าถึงข้อมูล
-- ผ่าน edge function (meeting-checkin-data / meeting-checkin-submit) ที่ใช้
-- service role และตรวจสอบ code ก่อนเท่านั้น ไม่เปิด RLS ให้ anon โดยตรง
-- (เหมือนแพทเทิร์นของ approval-public-data / approval-public-action)
ALTER TABLE meetings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meetings_read_all"  ON meetings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "meetings_write_editor" ON meetings FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

CREATE POLICY "meeting_members_read_all"  ON meeting_members FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "meeting_members_write_editor" ON meeting_members FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));

CREATE POLICY "meeting_responses_read_all"  ON meeting_responses FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "meeting_responses_write_editor" ON meeting_responses FOR ALL USING (current_user_role() IN ('editor','admin','super_admin'));
