-- Assignee pickers (TaskModal staff, Kanban assignee) read the users
-- table directly, but users_read_self_or_admin only lets non-admins see
-- their own row — so editors, who are allowed to edit tasks and kanban,
-- could only ever assign work to themselves. This exposes just what a
-- picker needs (no role, no last_login) to any logged-in user.
CREATE OR REPLACE FUNCTION list_assignable_users()
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  member_id uuid,
  members jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.name, u.email, u.member_id,
         CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
           'id', m.id, 'name_th', m.name_th, 'nickname', m.nickname,
           'email', m.email, 'position_committee', m.position_committee, 'province', m.province
         ) END
  FROM users u
  LEFT JOIN members m ON m.id = u.member_id
  WHERE u.active = true AND auth.uid() IS NOT NULL
  ORDER BY u.name;
$$;

REVOKE EXECUTE ON FUNCTION list_assignable_users() FROM anon, public;
GRANT EXECUTE ON FUNCTION list_assignable_users() TO authenticated, service_role;
