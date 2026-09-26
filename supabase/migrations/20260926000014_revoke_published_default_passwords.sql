-- 20260508000007_import_old_tasks.sql set passwords 'changeme' / 'test1'
-- in plain text, and this repository is public on GitHub. 7 accounts
-- (including admins) were still using 'changeme'. Replace every password
-- that still matches one of those published defaults with a random value
-- no one knows; an admin then sets each person's new password from the
-- Users page (the account repair in 20260926000012 made that work again).
-- Accounts whose owner already changed the password are left untouched.
UPDATE auth.users
SET encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'base64'), extensions.gen_salt('bf')),
    updated_at = now()
WHERE encrypted_password = extensions.crypt('changeme', encrypted_password)
   OR encrypted_password = extensions.crypt('test1', encrypted_password);

-- Test accounts from that same import: deactivate (reversible from the
-- Users page) rather than delete.
UPDATE public.users SET active = false WHERE email IN ('go46034@gmail.com', 'test1@gmai.com');

-- Self-check: abort (and roll back everything above) if any account can
-- still use a published default password.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM auth.users
  WHERE encrypted_password = extensions.crypt('changeme', encrypted_password)
     OR encrypted_password = extensions.crypt('test1', encrypted_password);
  IF remaining > 0 THEN
    RAISE EXCEPTION '% account(s) still use a published default password', remaining;
  END IF;
END $$;
