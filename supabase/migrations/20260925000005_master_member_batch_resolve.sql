-- ============================================================
-- Batch resolver: ตรวจสถานะสมาชิกแบบหมู่ (พอร์ตจาก batchResolveRows/
-- batchResolveMembers ในระบบ DATA MASTER เดิม) — รับรายการ input
-- หลายรายการ (บรรทัดที่พิมพ์/วาง หรือแถวจากไฟล์ CSV/Excel ที่ join
-- ทุก cell เป็น string เดียวต่อแถว) แล้ว auto-detect ว่าแต่ละอันคือ
-- เบอร์โทร/อีเมล/ชื่อ จับคู่กับ master_members คืน "คำตอบที่ดีที่สุด
-- 1 รายการ" ต่อ 1 input (ต่างจาก resolve_master_member ที่คืนหลาย
-- candidate ให้ผู้ใช้เลือกเองตอนค้นทีละคน)
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_master_members_batch(inputs text[])
RETURNS TABLE (
  input_index int,
  input_text text,
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
DECLARE
  idx int;
  raw text;
  tokens text[];
  token text;
  phone_token text;
  email_token text;
  name_tokens text[] := '{}';
  fn text;
  ln text;
  best RECORD;
  found_any boolean;
BEGIN
  FOR idx IN 1 .. array_length(inputs, 1) LOOP
    raw := trim(coalesce(inputs[idx], ''));
    phone_token := NULL;
    email_token := NULL;
    name_tokens := '{}';
    found_any := false;

    IF raw = '' THEN
      input_index := idx; input_text := raw; id := NULL; master_id := NULL;
      first_name := NULL; last_name := NULL; province := NULL; phone := NULL; email := NULL;
      yec_position := NULL; payment_status := NULL; match_type := 'empty'; confidence := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- แตก token ด้วยตัวคั่นทั่วไปที่พบได้ทั้งจากบรรทัดพิมพ์เอง (เว้นวรรค)
    -- และแถว CSV/Excel ที่ join cell มาแล้ว (comma / tab / pipe)
    tokens := regexp_split_to_array(raw, '\s*[,|\t]\s*|\s{2,}');
    IF array_length(tokens, 1) IS NULL OR array_length(tokens, 1) = 1 THEN
      tokens := regexp_split_to_array(raw, '\s+');
    END IF;

    FOREACH token IN ARRAY tokens LOOP
      token := trim(token);
      IF token = '' THEN CONTINUE; END IF;
      IF phone_token IS NULL AND token ~ '^[\d\s\-\+]+$'
         AND length(regexp_replace(token, '\D', '', 'g')) BETWEEN 9 AND 10 THEN
        phone_token := token;
      ELSIF email_token IS NULL AND token LIKE '%@%' THEN
        email_token := token;
      ELSE
        name_tokens := array_append(name_tokens, token);
      END IF;
    END LOOP;

    best := NULL;

    -- Priority 1: เบอร์โทร
    IF phone_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
             m.yec_position, m.payment_status, 'phone'::text AS match_type, 92 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.phone_normalized = normalize_phone_master(phone_token) AND m.phone_normalized <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    -- Priority 2: อีเมล
    IF NOT found_any AND email_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
             m.yec_position, m.payment_status, 'email'::text AS match_type, 88 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.email_normalized = lower(trim(email_token)) AND m.email_normalized <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    -- Priority 3: ชื่อ+นามสกุล — เดา first/last จาก name_tokens ที่เหลือ
    IF NOT found_any AND array_length(name_tokens, 1) >= 1 THEN
      IF array_length(name_tokens, 1) >= 2 THEN
        fn := name_tokens[1];
        ln := array_to_string(name_tokens[2:array_length(name_tokens, 1)], ' ');
      ELSE
        fn := name_tokens[1];
        ln := NULL;
      END IF;

      IF fn IS NOT NULL AND ln IS NOT NULL THEN
        -- exact ชื่อ+นามสกุล (ไม่ยืนยันจังหวัด)
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
               m.yec_position, m.payment_status, 'name_exact'::text AS match_type, 75 AS confidence
        INTO best FROM master_members m
        WHERE m.deleted = false AND lower(m.first_name) = lower(fn) AND lower(m.last_name) = lower(ln)
        LIMIT 1;
        IF FOUND THEN found_any := true; END IF;
      END IF;

      IF NOT found_any THEN
        -- fuzzy ชื่อ/นามสกุลใกล้เคียง
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
               m.yec_position, m.payment_status, 'name_fuzzy'::text AS match_type,
               round(GREATEST(
                 word_similarity(lower(fn), lower(m.first_name)),
                 word_similarity(lower(coalesce(ln, fn)), lower(m.last_name))
               ) * 69)::int AS confidence
        INTO best FROM master_members m
        WHERE m.deleted = false
          AND (
            word_similarity(lower(fn), lower(m.first_name)) > 0.35
            OR (ln IS NOT NULL AND word_similarity(lower(ln), lower(m.last_name)) > 0.35)
          )
        ORDER BY GREATEST(
          word_similarity(lower(fn), lower(m.first_name)),
          word_similarity(lower(coalesce(ln, fn)), lower(m.last_name))
        ) DESC
        LIMIT 1;
        IF FOUND THEN found_any := true; END IF;
      END IF;
    END IF;

    input_index := idx;
    input_text := raw;
    IF found_any THEN
      id := best.id; master_id := best.master_id; first_name := best.first_name; last_name := best.last_name;
      province := best.province; phone := best.phone; email := best.email;
      yec_position := best.yec_position; payment_status := best.payment_status;
      match_type := best.match_type; confidence := best.confidence;
    ELSE
      id := NULL; master_id := NULL; first_name := NULL; last_name := NULL; province := NULL;
      phone := NULL; email := NULL; yec_position := NULL; payment_status := NULL;
      match_type := 'not_found'; confidence := 0;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_master_members_batch(text[]) TO authenticated, service_role;
