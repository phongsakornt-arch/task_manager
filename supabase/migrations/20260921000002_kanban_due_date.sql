-- Add a due date to kanban cards.
alter table public.kanban_cards
  add column if not exists due_date date;
