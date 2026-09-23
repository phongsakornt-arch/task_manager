-- ============================================================
-- Typo-tolerant fallback search for tasks, used by ai-assistant
-- ============================================================
-- Plain ILIKE (used by both the board's own search box and the AI's
-- search_tasks tool) requires the query to literally be a substring of
-- the title — a one-letter typo like "bimtec" vs "BIMSTEC" fails to
-- match even though a person would recognize it instantly. pg_trgm's
-- similarity() tolerates that kind of near-miss. This function is only
-- meant as a fallback when the exact ILIKE search returns nothing.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx ON tasks USING gin (title gin_trgm_ops);

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
      -- similarity() เทียบตัวพิมพ์ใหญ่เล็กตรงๆ (ไม่ normalize เอง) ต้อง lower()
      -- ทั้งสองฝั่งก่อนเสมอ ไม่งั้น "bimtec" vs "BIMSTEC" จะได้ similarity ~0
      similarity(lower(t.title), lower(search_query)) > 0.2
      OR similarity(lower(coalesce(t.description, '')), lower(search_query)) > 0.2
    )
  ORDER BY GREATEST(
    similarity(lower(t.title), lower(search_query)),
    similarity(lower(coalesce(t.description, '')), lower(search_query))
  ) DESC, t.start_date ASC NULLS LAST
  LIMIT result_limit;
$$;

-- ต้อง login เท่านั้น (เหมือน tasks_read_all) — ฟังก์ชันนี้แค่ทำ fuzzy match
-- แทน ILIKE ทั่วไป ไม่ได้เปิดสิทธิ์เห็นข้อมูลเพิ่มจากที่ RLS ของ tasks อนุญาตอยู่แล้ว
GRANT EXECUTE ON FUNCTION search_tasks_fuzzy(text, int) TO authenticated, service_role;
