CREATE OR REPLACE FUNCTION public.create_committee(
  p_name text,
  p_name_en text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_head_name text DEFAULT NULL,
  p_head_email text DEFAULT NULL
)
RETURNS public.committees
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  next_number int;
  inserted public.committees;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::int), 0) + 1
  INTO next_number
  FROM public.committees
  WHERE code ~ '^CG[0-9]+$';

  INSERT INTO public.committees (
    code,
    name,
    name_en,
    color,
    head_name,
    head_email,
    active
  )
  VALUES (
    'CG' || LPAD(next_number::text, 2, '0'),
    NULLIF(BTRIM(p_name), ''),
    NULLIF(BTRIM(p_name_en), ''),
    COALESCE(NULLIF(BTRIM(p_color), ''), '#c9a84c'),
    NULLIF(BTRIM(p_head_name), ''),
    LOWER(NULLIF(BTRIM(p_head_email), '')),
    true
  )
  RETURNING * INTO inserted;

  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_committee(text, text, text, text, text) TO authenticated;
