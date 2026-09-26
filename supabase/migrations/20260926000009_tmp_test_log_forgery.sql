-- TEMPORARY verification helper for the activity_log actor trigger;
-- dropped again by the next migration. Impersonates a logged-in user,
-- inserts a row claiming to be a different user, returns what was
-- actually stored, and deletes the test row.
CREATE OR REPLACE FUNCTION tmp_test_log_forgery(p_real uuid, p_claimed uuid)
RETURNS TABLE (stored_actor_id uuid, stored_actor_email text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_real, 'role', 'authenticated')::text, true);
  INSERT INTO activity_log (actor_id, actor_email, action, detail)
  VALUES (p_claimed, 'forged@example.com', 'test.forgery_check', 'temporary test row')
  RETURNING activity_log.id INTO new_id;
  RETURN QUERY SELECT a.actor_id, a.actor_email FROM activity_log a WHERE a.id = new_id;
  DELETE FROM activity_log WHERE id = new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION tmp_test_log_forgery(uuid, uuid) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION tmp_test_log_forgery(uuid, uuid) TO service_role;
