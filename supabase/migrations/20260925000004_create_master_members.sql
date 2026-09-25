-- ============================================================
-- Master data: YEC members nationwide (~4,385 rows), migrated from
-- the standalone "DATA MASTER" Google Apps Script system
-- (ระบบ DATA MASTER / MemberLookup.gs+html) into Supabase so it's
-- searchable from this app instead of a separate, unauthenticated
-- (anyone-with-link) Apps Script web app.
--
-- Kept as its own table, separate from `members` (the current YEC
-- committee roster, ~60 people) — this is the nationwide master list
-- across every provincial chapter, a different dataset entirely.
-- ============================================================

CREATE TABLE master_members (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id              text UNIQUE NOT NULL,  -- Master_ID จาก Google Sheet เดิม
  region                 text,                  -- ภาค
  province               text,                  -- จังหวัด
  seq_no                 text,                  -- ลำดับ
  org_info               text,                  -- ข้อมูลหน่วยงาน
  entity_type            text,                  -- ประเภทกิจการ (นิติบุคคล/บุคคล)
  business_name          text,                  -- ชื่อกิจการ (TH/EN)
  tax_id                 text,                  -- เลขนิติบุคคล/เลขประจำตัวผู้เสียภาษี
  business_type_tsic     text,                  -- ประเภทธุรกิจ (ตาม TSIC)
  business_type_network  text,                  -- ประเภทธุรกิจ (ตาม Business Network)
  business_detail        text,                  -- รายละเอียดธุรกิจพอสังเขป
  has_tcc_connect        text,                  -- ท่านมี TCC Connect หรือไม่
  prefix                 text,                  -- คำนำหน้า
  first_name             text,                  -- ชื่อ (YEC)
  last_name              text,                  -- นามสกุล (YEC)
  national_id            text,                  -- เลขบัตรประจำตัวประชาชน (YEC) — PII, จำกัดสิทธิ์เข้าถึง
  is_yec_provincial      text,                  -- เป็น YEC หอการค้าจังหวัด
  yec_position            text,                 -- ตำแหน่งใน YEC
  phone                   text,                 -- เบอร์โทร (YEC) ตามที่กรอกในชีต
  phone_normalized        text,                 -- normalize แล้ว (ตัวเลขล้วน 10 หลัก) ใช้ resolver จับคู่แบบ exact
  email                   text,                 -- E-mail (YEC) ตามที่กรอกในชีต
  email_normalized        text,                 -- lower(trim(email)) ใช้ resolver จับคู่แบบ exact
  current_address         text,                 -- ที่อยู่ปัจจุบัน
  birth_date              text,                 -- วัน/เดือน/ปีเกิด (เก็บ text ตามชีตเดิม รูปแบบไม่สม่ำเสมอ)
  member_since_date       text,                 -- วันที่เป็นสมาชิก YEC
  member_expiry_date      text,                 -- วันที่หมดอายุสมาชิก YEC
  verified_by_chair       text,                 -- ผ่านการตรวจสอบจากประธาน YEC
  payment_status          text,                 -- สถานะการชำระเงิน
  is_chamber_member       text,                 -- เป็นสมาชิกหอการค้า
  synced_at                timestamptz,         -- วันที่ Sync (จากชีตเดิม)
  deleted                  boolean DEFAULT false,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE TRIGGER master_members_updated_at
  BEFORE UPDATE ON master_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX master_members_province_idx ON master_members (province);
CREATE INDEX master_members_region_idx ON master_members (region);
CREATE INDEX master_members_payment_status_idx ON master_members (payment_status);
CREATE INDEX master_members_phone_normalized_idx ON master_members (phone_normalized);
CREATE INDEX master_members_email_normalized_idx ON master_members (email_normalized);
CREATE INDEX master_members_name_trgm_idx ON master_members
  USING gin ((lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) gin_trgm_ops);
CREATE INDEX master_members_business_trgm_idx ON master_members USING gin (lower(business_name) gin_trgm_ops);

-- อ่านได้ทุกคนที่ login แล้ว (เหมือน tasks/meetings) — เข้มกว่าระบบเดิมที่เป็น
-- "Anyone with link" ไม่ต้อง login เลยด้วยซ้ำ ส่วนแก้ไขจำกัดแค่ admin/super_admin
-- เหมือน canManageDirectory เพราะมีข้อมูลอ่อนไหว (เลขบัตรประชาชน) อยู่ในตาราง
ALTER TABLE master_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "master_members_read_all" ON master_members FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "master_members_write_admin" ON master_members FOR ALL USING (current_user_role() IN ('admin', 'super_admin'));

-- ============================================================
-- Resolver: จับคู่คน/เบอร์/อีเมลกับฐานข้อมูล master ตาม tier เดียวกับ
-- ระบบเดิม (MemberLookup.gs: resolveByPhone/Email/Name + fuzzyMatch)
-- ============================================================

CREATE OR REPLACE FUNCTION normalize_phone_master(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) = 9
      THEN '0' || regexp_replace(p, '\D', '', 'g')
    ELSE regexp_replace(coalesce(p, ''), '\D', '', 'g')
  END
$$;

CREATE OR REPLACE FUNCTION resolve_master_member(
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_province text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  master_id text,
  first_name text,
  last_name text,
  province text,
  phone text,
  email text,
  yec_position text,
  payment_status text,
  match_type text,
  confidence int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Priority 1: ชื่อ + นามสกุล + จังหวัด ตรงเป๊ะ
  IF p_first_name IS NOT NULL AND p_last_name IS NOT NULL AND p_province IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.yec_position, m.payment_status,
           'name_province'::text, 98
    FROM master_members m
    WHERE m.deleted = false
      AND lower(m.first_name) = lower(p_first_name) AND lower(m.last_name) = lower(p_last_name)
      AND lower(m.province) = lower(p_province)
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Priority 2: เบอร์โทร (normalize แล้ว) ตรงเป๊ะ
  IF p_phone IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.yec_position, m.payment_status,
           'phone'::text, 92
    FROM master_members m
    WHERE m.deleted = false AND m.phone_normalized = normalize_phone_master(p_phone) AND m.phone_normalized <> ''
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Priority 3: อีเมล (normalize แล้ว) ตรงเป๊ะ
  IF p_email IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.yec_position, m.payment_status,
           'email'::text, 88
    FROM master_members m
    WHERE m.deleted = false AND m.email_normalized = lower(trim(p_email)) AND m.email_normalized <> ''
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Priority 4: ชื่อ+นามสกุลใกล้เคียง (fuzzy, คะแนนต่ำกว่า ให้ผู้ใช้ยืนยันเอง)
  IF p_first_name IS NOT NULL OR p_last_name IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.yec_position, m.payment_status,
           'fuzzy_name'::text,
           round(GREATEST(
             word_similarity(lower(coalesce(p_first_name, '')), lower(m.first_name)),
             word_similarity(lower(coalesce(p_last_name, '')), lower(m.last_name))
           ) * 69)::int
    FROM master_members m
    WHERE m.deleted = false
      AND (
        word_similarity(lower(coalesce(p_first_name, '')), lower(m.first_name)) > 0.3
        OR word_similarity(lower(coalesce(p_last_name, '')), lower(m.last_name)) > 0.3
      )
    ORDER BY GREATEST(
      word_similarity(lower(coalesce(p_first_name, '')), lower(m.first_name)),
      word_similarity(lower(coalesce(p_last_name, '')), lower(m.last_name))
    ) DESC
    LIMIT 10;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_master_member(text, text, text, text, text) TO authenticated, service_role;
