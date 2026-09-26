-- TEMPORARY verification helper, dropped by the next migration.
-- Creates a throwaway Done card, tries to soft-delete it while
-- impersonating p_user, reports whether it was blocked, then removes it.
CREATE OR REPLACE FUNCTION tmp_test_kanban_done_delete(p_user uuid, p_status text)
RETURNS TABLE (role text, card_status text, delete_blocked boolean, message text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  card_id uuid;
  err text := NULL;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  INSERT INTO kanban_cards (title, status, deleted) VALUES ('tmp-done-delete-test', p_status, false) RETURNING id INTO card_id;
  BEGIN
    UPDATE kanban_cards SET deleted = true WHERE id = card_id;
  EXCEPTION WHEN OTHERS THEN
    err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM kanban_cards WHERE id = card_id;
  RETURN QUERY SELECT (SELECT u.role FROM users u WHERE u.id = p_user), p_status, err IS NOT NULL, err;
END;
$$;
REVOKE EXECUTE ON FUNCTION tmp_test_kanban_done_delete(uuid, text) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION tmp_test_kanban_done_delete(uuid, text) TO service_role;
