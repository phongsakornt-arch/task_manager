-- Normalize legacy task JSON fields so the app always receives arrays.
UPDATE public.tasks
SET checklist = COALESCE((
  SELECT jsonb_agg(value ORDER BY key)
  FROM jsonb_each(checklist)
), '[]'::jsonb)
WHERE jsonb_typeof(checklist) = 'object';

UPDATE public.tasks
SET attachments = COALESCE((
  SELECT jsonb_agg(value ORDER BY key)
  FROM jsonb_each(attachments)
), '[]'::jsonb)
WHERE jsonb_typeof(attachments) = 'object';
