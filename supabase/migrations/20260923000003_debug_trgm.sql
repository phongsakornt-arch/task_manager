CREATE OR REPLACE FUNCTION debug_trgm_sim(a text, b text)
RETURNS float LANGUAGE sql STABLE AS $$
  SELECT similarity(lower(a), lower(b));
$$;
GRANT EXECUTE ON FUNCTION debug_trgm_sim(text, text) TO authenticated, service_role;
