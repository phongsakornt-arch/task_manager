-- pg_trgm's similarity() compares characters as-is — it does not
-- lowercase for you. The first version of search_tasks_fuzzy() compared
-- raw title vs raw query, so "bimtec" (lowercase, as a user types it)
-- against "BIMSTEC" (as stored) scored ~0 similarity and matched nothing,
-- the exact bug this function exists to avoid. Redefine it to lower()
-- both sides, and rebuild the trigram index on the same expression so
-- it can actually be used.

DROP INDEX IF EXISTS tasks_title_trgm_idx;
CREATE INDEX IF NOT EXISTS tasks_title_trgm_lower_idx ON tasks USING gin (lower(title) gin_trgm_ops);

CREATE OR REPLACE FUNCTION search_tasks_fuzzy(search_query text, result_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid,
  title text,
  section_title text,
  start_date date,
  end_date date,
  completed boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.title, s.title AS section_title, t.start_date, t.end_date, t.completed
  FROM tasks t
  LEFT JOIN sections s ON s.id = t.section_id
  WHERE t.deleted = false
    AND (
      similarity(lower(t.title), lower(search_query)) > 0.2
      OR similarity(lower(coalesce(t.description, '')), lower(search_query)) > 0.2
    )
  ORDER BY GREATEST(
    similarity(lower(t.title), lower(search_query)),
    similarity(lower(coalesce(t.description, '')), lower(search_query))
  ) DESC, t.start_date ASC NULLS LAST
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION search_tasks_fuzzy(text, int) TO authenticated, service_role;
