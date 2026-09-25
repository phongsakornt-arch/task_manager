-- Two province values in master_members were Google Sheets tab names
-- that leaked into the จังหวัด column during the original import, not
-- real province names. Exact-match updates only (no wildcards).
--
-- The "Copy of..." rows (Master_ID 1759-1817) are field-for-field
-- duplicates of the real มหาสารคาม rows (Master_ID 2496-2554), differing
-- only in date formatting. Per the user's decision they are renamed and
-- kept, not removed, so those 59 people will appear twice.

UPDATE master_members
SET province = 'มหาสารคาม'
WHERE province = 'Copy of ข้อมูลสมาชิก YEC หอการค้าจังหวัดมหาสารคาม';

UPDATE master_members
SET province = 'กรุงเทพมหานคร'
WHERE province = 'ข้อมูลสมาชิก YEC กรุงเทพฯ';
