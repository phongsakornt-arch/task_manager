-- ============================================================
-- Add เลขบัตรประชาชน (national ID) and ชื่อบริษัท (company name) as
-- additional match criteria on both resolvers, per user request.
-- National ID matching stays internal-only (used to find the row,
-- never returned in output) — matches the existing masking design
-- where master_members_view hides national_id from non-admins; the
-- resolvers already read the base table directly (SECURITY DEFINER)
-- but have never exposed national_id in their result columns, and
-- that stays true here too.
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_master_member(
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_national_id text DEFAULT NULL,
  p_business_name text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  master_id text,
  first_name text,
  last_name text,
  province text,
  phone text,
  email text,
  business_name text,
  yec_position text,
  payment_status text,
  match_type text,
  confidence int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.3', true);

  IF p_first_name IS NOT NULL AND p_last_name IS NOT NULL AND p_province IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name, m.yec_position, m.payment_status,
           'name_province'::text, 98
    FROM master_members m
    WHERE m.deleted = false
      AND lower(m.first_name) = lower(p_first_name) AND lower(m.last_name) = lower(p_last_name)
      AND lower(m.province) = lower(p_province)
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- เลขบัตรประชาชน — unique เป็นรายบุคคล ให้ความมั่นใจสูงสุดรองจาก ชื่อ+จังหวัด
  IF p_national_id IS NOT NULL AND regexp_replace(p_national_id, '\D', '', 'g') <> '' THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name, m.yec_position, m.payment_status,
           'national_id'::text, 97
    FROM master_members m
    WHERE m.deleted = false AND m.national_id = regexp_replace(p_national_id, '\D', '', 'g') AND m.national_id <> ''
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF p_phone IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name, m.yec_position, m.payment_status,
           'phone'::text, 92
    FROM master_members m
    WHERE m.deleted = false AND m.phone_normalized = normalize_phone_master(p_phone) AND m.phone_normalized <> ''
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF p_email IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name, m.yec_position, m.payment_status,
           'email'::text, 88
    FROM master_members m
    WHERE m.deleted = false AND m.email_normalized = lower(trim(p_email)) AND m.email_normalized <> ''
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- ชื่อบริษัท — exact ก่อน แล้วค่อย fuzzy
  IF p_business_name IS NOT NULL AND trim(p_business_name) <> '' THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name, m.yec_position, m.payment_status,
           'business_exact'::text, 80
    FROM master_members m
    WHERE m.deleted = false AND lower(m.business_name) = lower(trim(p_business_name))
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;

    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name, m.yec_position, m.payment_status,
           'business_fuzzy'::text, round(word_similarity(lower(trim(p_business_name)), lower(m.business_name)) * 79)::int
    FROM master_members m
    WHERE m.deleted = false AND lower(trim(p_business_name)) <% lower(m.business_name)
    ORDER BY word_similarity(lower(trim(p_business_name)), lower(m.business_name)) DESC
    LIMIT 10;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF p_first_name IS NOT NULL OR p_last_name IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name, m.yec_position, m.payment_status,
           'fuzzy_name'::text,
           round(GREATEST(
             word_similarity(lower(coalesce(p_first_name, '')), lower(m.first_name)),
             word_similarity(lower(coalesce(p_last_name, '')), lower(m.last_name))
           ) * 69)::int
    FROM master_members m
    WHERE m.deleted = false
      AND (
        lower(coalesce(p_first_name, '')) <% lower(m.first_name)
        OR lower(coalesce(p_last_name, '')) <% lower(m.last_name)
      )
    ORDER BY GREATEST(
      word_similarity(lower(coalesce(p_first_name, '')), lower(m.first_name)),
      word_similarity(lower(coalesce(p_last_name, '')), lower(m.last_name))
    ) DESC
    LIMIT 10;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_master_member(text, text, text, text, text, text, text) TO authenticated, service_role;
-- ฟังก์ชันเดิม (7 args -> ตอนนี้เปลี่ยน signature) ลบทิ้งเพื่อไม่ให้ PostgREST สับสนระหว่าง overload
DROP FUNCTION IF EXISTS resolve_master_member(text, text, text, text, text);

DROP FUNCTION IF EXISTS resolve_master_members_batch(text[]);

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
  business_name text,
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
  digits text;
  phone_token text;
  email_token text;
  nid_token text;
  name_tokens text[] := '{}';
  full_name text;
  fn text;
  ln text;
  best RECORD;
  name_best RECORD;
  biz_best RECORD;
  found_any boolean;
BEGIN
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.3', true);

  FOR idx IN 1 .. array_length(inputs, 1) LOOP
    raw := trim(coalesce(inputs[idx], ''));
    phone_token := NULL;
    email_token := NULL;
    nid_token := NULL;
    name_tokens := '{}';
    found_any := false;

    IF raw = '' THEN
      input_index := idx; input_text := raw; id := NULL; master_id := NULL;
      first_name := NULL; last_name := NULL; province := NULL; phone := NULL; email := NULL;
      business_name := NULL; yec_position := NULL; payment_status := NULL; match_type := 'empty'; confidence := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    tokens := regexp_split_to_array(raw, '\s*[,|\t]\s*|\s{2,}');
    IF array_length(tokens, 1) IS NULL OR array_length(tokens, 1) = 1 THEN
      tokens := regexp_split_to_array(raw, '\s+');
    END IF;

    FOREACH token IN ARRAY tokens LOOP
      token := trim(token);
      IF token = '' THEN CONTINUE; END IF;
      digits := regexp_replace(token, '\D', '', 'g');
      IF nid_token IS NULL AND length(digits) = 13 AND token ~ '^[\d\s\-]+$' THEN
        nid_token := token;
      ELSIF phone_token IS NULL AND token ~ '^[\d\s\-\+]+$' AND length(digits) BETWEEN 9 AND 10 THEN
        phone_token := token;
      ELSIF email_token IS NULL AND token LIKE '%@%' THEN
        email_token := token;
      ELSE
        name_tokens := array_append(name_tokens, token);
      END IF;
    END LOOP;

    best := NULL;

    IF nid_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
             m.yec_position, m.payment_status, 'national_id'::text AS match_type, 97 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.national_id = regexp_replace(nid_token, '\D', '', 'g') AND m.national_id <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    IF NOT found_any AND phone_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
             m.yec_position, m.payment_status, 'phone'::text AS match_type, 92 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.phone_normalized = normalize_phone_master(phone_token) AND m.phone_normalized <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    IF NOT found_any AND email_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
             m.yec_position, m.payment_status, 'email'::text AS match_type, 88 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.email_normalized = lower(trim(email_token)) AND m.email_normalized <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    IF NOT found_any AND array_length(name_tokens, 1) >= 1 THEN
      IF array_length(name_tokens, 1) >= 2 THEN
        fn := name_tokens[1];
        ln := array_to_string(name_tokens[2:array_length(name_tokens, 1)], ' ');
      ELSE
        fn := name_tokens[1];
        ln := NULL;
      END IF;
      full_name := array_to_string(name_tokens, ' ');
      name_best := NULL;
      biz_best := NULL;

      -- ลองทั้งชื่อคนและชื่อบริษัทกับ text ก้อนเดียวกัน เพราะแยกไม่ออกล่วงหน้า
      -- ว่าผู้ใช้พิมพ์ชื่อคนหรือชื่อกิจการมา — เลือกอันที่ confidence สูงกว่า
      IF fn IS NOT NULL AND ln IS NOT NULL THEN
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
               m.yec_position, m.payment_status, 'name_exact'::text AS match_type, 75 AS confidence
        INTO name_best FROM master_members m
        WHERE m.deleted = false AND lower(m.first_name) = lower(fn) AND lower(m.last_name) = lower(ln)
        LIMIT 1;
      END IF;

      IF name_best IS NULL THEN
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
               m.yec_position, m.payment_status, 'name_fuzzy'::text AS match_type,
               round(word_similarity(lower(full_name), lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))) * 69)::int AS confidence
        INTO name_best FROM master_members m
        WHERE m.deleted = false
          AND lower(full_name) <% lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))
        ORDER BY word_similarity(lower(full_name), lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))) DESC
        LIMIT 1;
      END IF;

      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
             m.yec_position, m.payment_status, 'business_exact'::text AS match_type, 80 AS confidence
      INTO biz_best FROM master_members m
      WHERE m.deleted = false AND lower(m.business_name) = lower(full_name)
      LIMIT 1;

      IF biz_best IS NULL THEN
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
               m.yec_position, m.payment_status, 'business_fuzzy'::text AS match_type,
               round(word_similarity(lower(full_name), lower(m.business_name)) * 79)::int AS confidence
        INTO biz_best FROM master_members m
        WHERE m.deleted = false AND lower(full_name) <% lower(m.business_name)
        ORDER BY word_similarity(lower(full_name), lower(m.business_name)) DESC
        LIMIT 1;
      END IF;

      IF name_best IS NOT NULL AND (biz_best IS NULL OR name_best.confidence >= biz_best.confidence) THEN
        best := name_best;
      ELSIF biz_best IS NOT NULL THEN
        best := biz_best;
      END IF;
      IF best IS NOT NULL THEN found_any := true; END IF;
    END IF;

    input_index := idx;
    input_text := raw;
    IF found_any THEN
      id := best.id; master_id := best.master_id; first_name := best.first_name; last_name := best.last_name;
      province := best.province; phone := best.phone; email := best.email; business_name := best.business_name;
      yec_position := best.yec_position; payment_status := best.payment_status;
      match_type := best.match_type; confidence := best.confidence;
    ELSE
      id := NULL; master_id := NULL; first_name := NULL; last_name := NULL; province := NULL;
      phone := NULL; email := NULL; business_name := NULL; yec_position := NULL; payment_status := NULL;
      match_type := 'not_found'; confidence := 0;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_master_members_batch(text[]) TO authenticated, service_role;
