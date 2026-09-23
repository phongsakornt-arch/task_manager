-- similarity() is a whole-string Jaccard-style score: a short query like
-- "bimtec" against a long task title scores near 0 just because most of
-- the title's trigrams aren't in the query, even when the query clearly
-- appears (approximately) inside it. word_similarity() instead finds the
-- best-matching substring of the longer string, which is what this
-- "does this short search term roughly appear in the title" use case
-- actually needs.

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
      word_similarity(lower(search_query), lower(t.title)) > 0.3
      OR word_similarity(lower(search_query), lower(coalesce(t.description, ''))) > 0.3
    )
  ORDER BY GREATEST(
    word_similarity(lower(search_query), lower(t.title)),
    word_similarity(lower(search_query), lower(coalesce(t.description, '')))
  ) DESC, t.start_date ASC NULLS LAST
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION search_tasks_fuzzy(text, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION debug_trgm_sim(a text, b text)
RETURNS float LANGUAGE sql STABLE AS $$
  SELECT word_similarity(lower(a), lower(b));
$$;
