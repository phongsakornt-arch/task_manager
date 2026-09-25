-- ============================================================
-- Fix "canceling statement due to statement timeout" on batch check
-- with a real-size list (490 rows). Root cause: the fuzzy-match
-- fallback in both resolve_master_member() and
-- resolve_master_members_batch() called word_similarity() as a plain
-- function in WHERE/ORDER BY — that can never use an index, so every
-- non-exact-match input triggered a full sequential scan over all
-- 7,094 rows with a similarity computation per row. With ~490 inputs
-- in one batch, most falling through to fuzzy, that's ~490 full
-- table scans in one statement.
--
-- Fix: use pg_trgm's `<%` (word-similarity) OPERATOR instead of the
-- bare function — that's what lets the planner use the GIN trgm
-- index already built on the combined first+last name expression
-- (master_members_name_trgm_idx). Also add plain btree indexes on
-- lower(first_name)/lower(last_name) so the exact-match tier (which
-- runs before fuzzy, for every input) isn't a seq scan either.
-- ============================================================

CREATE INDEX IF NOT EXISTS master_members_first_name_lower_idx ON master_members (lower(first_name));
CREATE INDEX IF NOT EXISTS master_members_last_name_lower_idx ON master_members (lower(last_name));

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
  -- threshold ต่ำกว่า default (0.6) ของ pg_trgm เพื่อให้จับคำสะกดใกล้เคียง
  -- ได้กว้างพอ แบบเดียวกับที่ปรับไว้ตอนแก้ search_tasks_fuzzy
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.3', true);

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

  IF p_phone IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.yec_position, m.payment_status,
           'phone'::text, 92
    FROM master_members m
    WHERE m.deleted = false AND m.phone_normalized = normalize_phone_master(p_phone) AND m.phone_normalized <> ''
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF p_email IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.yec_position, m.payment_status,
           'email'::text, 88
    FROM master_members m
    WHERE m.deleted = false AND m.email_normalized = lower(trim(p_email)) AND m.email_normalized <> ''
    LIMIT 5;
    IF FOUND THEN RETURN; END IF;
  END IF;

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

GRANT EXECUTE ON FUNCTION resolve_master_member(text, text, text, text, text) TO authenticated, service_role;

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
  full_name text;
  fn text;
  ln text;
  best RECORD;
  found_any boolean;
BEGIN
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.3', true);

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

    IF phone_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
             m.yec_position, m.payment_status, 'phone'::text AS match_type, 92 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.phone_normalized = normalize_phone_master(phone_token) AND m.phone_normalized <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    IF NOT found_any AND email_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
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

      IF fn IS NOT NULL AND ln IS NOT NULL THEN
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
               m.yec_position, m.payment_status, 'name_exact'::text AS match_type, 75 AS confidence
        INTO best FROM master_members m
        WHERE m.deleted = false AND lower(m.first_name) = lower(fn) AND lower(m.last_name) = lower(ln)
        LIMIT 1;
        IF FOUND THEN found_any := true; END IF;
      END IF;

      IF NOT found_any THEN
        -- match กับชื่อเต็ม (first+last รวมกัน) เทียบกับ index ที่มีอยู่แล้ว
        -- (master_members_name_trgm_idx) แทนการเช็คแยก first/last แบบเดิม
        -- ซึ่งไม่มี index รองรับ ทำให้ scan ทั้งตารางทุกแถวที่ไม่ match แบบตรงตัว
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email,
               m.yec_position, m.payment_status, 'name_fuzzy'::text AS match_type,
               round(word_similarity(lower(full_name), lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))) * 69)::int AS confidence
        INTO best FROM master_members m
        WHERE m.deleted = false
          AND lower(full_name) <% lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))
        ORDER BY word_similarity(lower(full_name), lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))) DESC
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
