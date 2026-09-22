ALTER TABLE public.members
ADD COLUMN IF NOT EXISTS province text;

CREATE INDEX IF NOT EXISTS members_province_idx
ON public.members (province);

CREATE OR REPLACE FUNCTION public.create_member(
  p_committee_id uuid,
  p_name_th text,
  p_name_en text DEFAULT NULL,
  p_nickname text DEFAULT NULL,
  p_position_committee text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS public.members
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  next_number int;
  inserted public.members;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::int), 0) + 1
  INTO next_number
  FROM public.members
  WHERE code ~ '^M[0-9]+$';

  INSERT INTO public.members (
    code,
    committee_id,
    name_th,
    name_en,
    nickname,
    position_committee,
    province,
    email,
    phone,
    active,
    sort_order
  )
  VALUES (
    'M' || LPAD(next_number::text, 3, '0'),
    p_committee_id,
    NULLIF(BTRIM(p_name_th), ''),
    NULLIF(BTRIM(p_name_en), ''),
    NULLIF(BTRIM(p_nickname), ''),
    NULLIF(BTRIM(p_position_committee), ''),
    NULLIF(BTRIM(p_province), ''),
    LOWER(NULLIF(BTRIM(p_email), '')),
    NULLIF(BTRIM(p_phone), ''),
    true,
    next_number
  )
  RETURNING * INTO inserted;

  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_member(uuid, text, text, text, text, text, text, text) TO authenticated;
