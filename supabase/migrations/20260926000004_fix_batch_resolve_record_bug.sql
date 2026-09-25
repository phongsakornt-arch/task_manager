-- ============================================================
-- Fix "record ... is not assigned yet" (PG error 55000), a latent
-- bug in resolve_master_members_batch's name/business comparison
-- exposed by testing the new check-toggles: a RECORD variable that
-- has *never* been populated by a successful SELECT INTO (zero rows
-- every attempt) has no structure at all in PL/pgSQL — touching its
-- .confidence field, even inside a short-circuiting OR, fails at
-- evaluation because the field access requires a known row type
-- that was never established.
--
-- Fix: track each candidate's confidence in a plain int (0 = "no
-- match"), only ever read via that int, and only read the RECORD's
-- other fields once we know (via the int) it was actually assigned.
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_master_members_batch(
  inputs text[],
  p_check_phone boolean DEFAULT true,
  p_check_email boolean DEFAULT true,
  p_check_national_id boolean DEFAULT true,
  p_check_name boolean DEFAULT true,
  p_check_business boolean DEFAULT true
)
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
  name_conf int;
  biz_conf int;
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

    IF p_check_national_id AND nid_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
             m.yec_position, m.payment_status, 'national_id'::text AS match_type, 97 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.national_id = regexp_replace(nid_token, '\D', '', 'g') AND m.national_id <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    IF NOT found_any AND p_check_phone AND phone_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
             m.yec_position, m.payment_status, 'phone'::text AS match_type, 92 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.phone_normalized = normalize_phone_master(phone_token) AND m.phone_normalized <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    IF NOT found_any AND p_check_email AND email_token IS NOT NULL THEN
      SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
             m.yec_position, m.payment_status, 'email'::text AS match_type, 88 AS confidence
      INTO best FROM master_members m
      WHERE m.deleted = false AND m.email_normalized = lower(trim(email_token)) AND m.email_normalized <> ''
      LIMIT 1;
      IF FOUND THEN found_any := true; END IF;
    END IF;

    IF NOT found_any AND (p_check_name OR p_check_business) AND array_length(name_tokens, 1) >= 1 THEN
      IF array_length(name_tokens, 1) >= 2 THEN
        fn := name_tokens[1];
        ln := array_to_string(name_tokens[2:array_length(name_tokens, 1)], ' ');
      ELSE
        fn := name_tokens[1];
        ln := NULL;
      END IF;
      full_name := array_to_string(name_tokens, ' ');
      name_conf := 0;
      biz_conf := 0;

      IF p_check_name THEN
        IF fn IS NOT NULL AND ln IS NOT NULL THEN
          SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
                 m.yec_position, m.payment_status, 'name_exact'::text AS match_type, 75 AS confidence
          INTO name_best FROM master_members m
          WHERE m.deleted = false AND lower(m.first_name) = lower(fn) AND lower(m.last_name) = lower(ln)
          LIMIT 1;
          IF FOUND THEN name_conf := 75; END IF;
        END IF;

        IF name_conf = 0 THEN
          SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
                 m.yec_position, m.payment_status, 'name_fuzzy'::text AS match_type,
                 round(word_similarity(lower(full_name), lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))) * 69)::int AS confidence
          INTO name_best FROM master_members m
          WHERE m.deleted = false
            AND lower(full_name) <% lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))
          ORDER BY word_similarity(lower(full_name), lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))) DESC
          LIMIT 1;
          IF FOUND THEN name_conf := GREATEST(name_best.confidence, 1); END IF;
        END IF;
      END IF;

      IF p_check_business THEN
        SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
               m.yec_position, m.payment_status, 'business_exact'::text AS match_type, 80 AS confidence
        INTO biz_best FROM master_members m
        WHERE m.deleted = false AND lower(m.business_name) = lower(full_name)
        LIMIT 1;
        IF FOUND THEN biz_conf := 80; END IF;

        IF biz_conf = 0 THEN
          SELECT m.id, m.master_id, m.first_name, m.last_name, m.province, m.phone, m.email, m.business_name,
                 m.yec_position, m.payment_status, 'business_fuzzy'::text AS match_type,
                 round(word_similarity(lower(full_name), lower(m.business_name)) * 79)::int AS confidence
          INTO biz_best FROM master_members m
          WHERE m.deleted = false AND lower(full_name) <% lower(m.business_name)
          ORDER BY word_similarity(lower(full_name), lower(m.business_name)) DESC
          LIMIT 1;
          IF FOUND THEN biz_conf := GREATEST(biz_best.confidence, 1); END IF;
        END IF;
      END IF;

      IF name_conf > 0 AND name_conf >= biz_conf THEN
        best := name_best; found_any := true;
      ELSIF biz_conf > 0 THEN
        best := biz_best; found_any := true;
      END IF;
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

GRANT EXECUTE ON FUNCTION resolve_master_members_batch(text[], boolean, boolean, boolean, boolean, boolean) TO authenticated, service_role;
