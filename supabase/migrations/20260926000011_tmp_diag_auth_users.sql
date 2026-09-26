-- TEMPORARY read-only diagnostic, dropped by the next migration.
-- "Database error loading user" from Supabase Auth: accounts created by
-- 20260508000007_import_old_tasks.sql were INSERTed straight into
-- auth.users, leaving token columns NULL that GoTrue scans as strings.
-- Also reports which accounts still use a default password written in
-- that (public) migration file. Returns only the default's label.
CREATE OR REPLACE FUNCTION tmp_diag_auth_users()
RETURNS TABLE (email text, null_token_columns text[], has_identity boolean, uses_default_password text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, extensions AS $$
  SELECT
    u.email::text,
    ARRAY(
      SELECT c FROM unnest(ARRAY['confirmation_token','recovery_token','email_change_token_new','email_change',
                                 'email_change_token_current','phone_change','phone_change_token','reauthentication_token']) AS c
      WHERE to_jsonb(u) ? c AND to_jsonb(u) -> c = 'null'::jsonb
    ),
    EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id),
    CASE
      WHEN u.encrypted_password = extensions.crypt('changeme', u.encrypted_password) THEN 'changeme'
      WHEN u.encrypted_password = extensions.crypt('test1', u.encrypted_password) THEN 'test1'
    END
  FROM auth.users u
  ORDER BY u.email;
$$;
REVOKE EXECUTE ON FUNCTION tmp_diag_auth_users() FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION tmp_diag_auth_users() TO service_role;
