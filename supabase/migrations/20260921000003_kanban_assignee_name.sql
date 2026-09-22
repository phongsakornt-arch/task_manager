-- Allow a free-typed assignee name on kanban cards, alongside the existing
-- assignee_id link (kept when the typed name matches a known user).
alter table public.kanban_cards
  add column if not exists assignee_name text;
