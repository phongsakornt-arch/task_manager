ALTER TABLE public.members
ADD COLUMN IF NOT EXISTS sort_order int;

CREATE INDEX IF NOT EXISTS members_committee_sort_order_idx
ON public.members (committee_id, sort_order, name_th);
