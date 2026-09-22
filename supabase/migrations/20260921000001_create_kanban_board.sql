-- Central team Kanban board (todo / in_progress / done), separate from the
-- existing personal todo_items list.
create table if not exists public.kanban_cards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  position bigint not null default 0,
  assignee_id uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kanban_cards_status_idx on public.kanban_cards (status, position);

alter table public.kanban_cards enable row level security;

create policy kanban_read_all on public.kanban_cards
  for select using (auth.uid() is not null);

create policy kanban_write_editor on public.kanban_cards
  for all
  using (current_user_role() = any (array['editor', 'admin', 'super_admin']))
  with check (current_user_role() = any (array['editor', 'admin', 'super_admin']));

create trigger kanban_cards_updated_at
  before update on public.kanban_cards
  for each row execute function update_updated_at_column();
