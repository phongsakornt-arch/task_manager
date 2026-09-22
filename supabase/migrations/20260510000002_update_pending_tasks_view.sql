-- Expand pending task summary with staff and committee/participant names.

DROP VIEW IF EXISTS public.pending_tasks;

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
  COALESCE(staff.staff_count, 0)::int AS staff_count,
  COALESCE(staff.staff_names, ARRAY[]::text[]) AS staff_names,
  COALESCE(committees.committee_count, 0)::int AS committee_count,
  COALESCE(committees.committee_names, ARRAY[]::text[]) AS committee_names,
  COALESCE(participants.participant_count, 0)::int AS participant_count,
  COALESCE(participants.participant_names, ARRAY[]::text[]) AS participant_names,
  (
    COALESCE(staff.staff_count, 0)
    + COALESCE(committees.committee_count, 0)
    + COALESCE(participants.participant_count, 0)
  )::int AS assignee_count,
  (
    COALESCE(staff.staff_names, ARRAY[]::text[])
    || COALESCE(committees.committee_names, ARRAY[]::text[])
    || COALESCE(participants.participant_names, ARRAY[]::text[])
  ) AS assignee_names
FROM public.tasks t
LEFT JOIN public.sections s ON s.id = t.section_id
LEFT JOIN public.task_types tt ON tt.id = t.task_type_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS staff_count,
    ARRAY_AGG(DISTINCT COALESCE(NULLIF(u.name, ''), u.email) ORDER BY COALESCE(NULLIF(u.name, ''), u.email)) AS staff_names
  FROM public.task_staff ts
  JOIN public.users u ON u.id = ts.user_id
  WHERE ts.task_id = t.id
) staff ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS committee_count,
    ARRAY_AGG(DISTINCT c.name ORDER BY c.name) AS committee_names
  FROM public.task_members tm
  JOIN public.committees c ON c.id = tm.committee_id
  WHERE tm.task_id = t.id
    AND tm.role = 'watcher'
) committees ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS participant_count,
    ARRAY_AGG(DISTINCT m.name_th ORDER BY m.name_th) AS participant_names
  FROM public.task_members tm
  JOIN public.members m ON m.id = tm.member_id
  WHERE tm.task_id = t.id
    AND tm.role = 'watcher'
) participants ON true
WHERE t.deleted = false
  AND t.completed = false;

GRANT SELECT ON public.pending_tasks TO authenticated;
