-- Repair the 7 login accounts created by 20260508000007_import_old_tasks.sql,
-- which INSERTed straight into auth.users and left these token columns NULL.
-- Supabase Auth reads them as non-null strings, so any Auth operation on those
-- accounts (admin password reset, magic link lookup) failed with
-- "Database error loading user" / "Database error finding user".
-- Only NULLs are touched; passwords and every other column are unchanged.
UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change               = COALESCE(email_change, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR email_change_token_current IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;
