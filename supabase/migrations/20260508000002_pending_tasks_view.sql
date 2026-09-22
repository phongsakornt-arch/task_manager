-- Pending task summary for the React Pending page.
-- Uses security_invoker so base table RLS still controls visibility.

CREATE OR REPLACE VIEW public.pending_tasks
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.code,
  t.title,
  t.description,
  t.start_date,
  t.end_date,
  COALESCE(t.end_date, t.start_date) AS due_date,
  CASE
    WHEN COALESCE(t.end_date, t.start_date) IS NULL THEN 'unscheduled'
    WHEN COALESCE(t.end_date, t.start_date) < CURRENT_DATE THEN 'overdue'
    WHEN COALESCE(t.end_date, t.start_date) = CURRENT_DATE THEN 'today'
    WHEN COALESCE(t.end_date, t.start_date) <= CURRENT_DATE + 7 THEN 'soon'
    ELSE 'scheduled'
  END AS due_status,
  CASE
    WHEN COALESCE(t.end_date, t.start_date) IS NULL THEN NULL
    ELSE COALESCE(t.end_date, t.start_date) - CURRENT_DATE
  END AS days_until_due,
  t.section_id,
  s.code AS section_code,
  s.title AS section_title,
  t.task_type_id,
  tt.name AS task_type_name,
  tt.color AS task_type_color,
  t.completed,
  t.deleted,
  t.created_at,
  t.updated_at,
  COUNT(tm.id)::int AS assignee_count,
  COALESCE(
    ARRAY_AGG(DISTINCT m.name_th ORDER BY m.name_th) FILTER (WHERE m.id IS NOT NULL),
    ARRAY[]::text[]
  ) AS assignee_names
FROM public.tasks t
LEFT JOIN public.sections s ON s.id = t.section_id
LEFT JOIN public.task_types tt ON tt.id = t.task_type_id
LEFT JOIN public.task_members tm ON tm.task_id = t.id
LEFT JOIN public.members m ON m.id = tm.member_id
WHERE t.deleted = false
  AND t.completed = false
GROUP BY
  t.id,
  s.code,
  s.title,
  tt.name,
  tt.color;

GRANT SELECT ON public.pending_tasks TO authenticated;
