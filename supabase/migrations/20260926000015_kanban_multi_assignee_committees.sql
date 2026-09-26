-- Kanban: multiple assignees + whole-committee tags, and Done cards
-- deletable by super_admin only.

-- Multiple people (users) and free-typed names per card, plus committee tags.
ALTER TABLE public.kanban_cards ADD COLUMN IF NOT EXISTS assignee_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.kanban_cards ADD COLUMN IF NOT EXISTS assignee_names text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.kanban_cards ADD COLUMN IF NOT EXISTS committee_ids uuid[] NOT NULL DEFAULT '{}';

-- Carry the single legacy assignee over. The old assignee_id/assignee_name
-- columns are left in place (no longer written by the app).
UPDATE public.kanban_cards SET assignee_ids = ARRAY[assignee_id]
WHERE assignee_id IS NOT NULL AND assignee_ids = '{}';
UPDATE public.kanban_cards SET assignee_names = ARRAY[assignee_name]
WHERE assignee_id IS NULL AND coalesce(trim(assignee_name), '') <> '' AND assignee_names = '{}';

CREATE INDEX IF NOT EXISTS kanban_cards_committee_ids_idx ON public.kanban_cards USING gin (committee_ids);
CREATE INDEX IF NOT EXISTS kanban_cards_assignee_ids_idx ON public.kanban_cards USING gin (assignee_ids);

-- Done cards: only super_admin may delete (soft delete via deleted=true, or
-- a hard DELETE). Enforced here, not just by hiding the button, because
-- kanban_write_editor lets every editor update any card. Service-role calls
-- (auth.uid() is null) are not affected.
CREATE OR REPLACE FUNCTION kanban_protect_done_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR current_user_role() = 'super_admin' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'done' THEN
    RAISE EXCEPTION 'เฉพาะ Super Admin เท่านั้นที่ลบการ์ดในช่อง Done ได้';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'done' AND NEW.deleted AND NOT OLD.deleted THEN
    RAISE EXCEPTION 'เฉพาะ Super Admin เท่านั้นที่ลบการ์ดในช่อง Done ได้';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS kanban_cards_protect_done_delete ON public.kanban_cards;
CREATE TRIGGER kanban_cards_protect_done_delete
  BEFORE UPDATE OR DELETE ON public.kanban_cards
  FOR EACH ROW EXECUTE FUNCTION kanban_protect_done_delete();
