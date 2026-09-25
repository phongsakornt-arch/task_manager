-- ============================================================
-- "ช่องทางใหม่ในการ input ข้อมูล" — ตอนนี้ยังไม่มีทางเพิ่มสมาชิกใหม่เข้า
-- Data Master ผ่านหน้าเว็บเลย (มีแต่แก้ไขของเดิม) เพราะข้อมูลเดิมทั้งหมด
-- import มาจาก Google Sheet ครั้งเดียว หลังจากปิดระบบ DATA MASTER เดิมแล้ว
-- ต้องมีทางเพิ่มสมาชิกใหม่ผ่านแอปนี้แทน — ฟังก์ชันนี้สร้าง Master_ID ถัดไป
-- ต่อจากเลขเดิม (ตัวเลขล้วน) ให้อัตโนมัติ กันชนกับที่ import มาแล้ว
-- ============================================================

CREATE OR REPLACE FUNCTION next_master_id()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (COALESCE(MAX(master_id::int), 0) + 1)::text
  FROM master_members
  WHERE master_id ~ '^\d+$';
$$;

GRANT EXECUTE ON FUNCTION next_master_id() TO authenticated, service_role;
