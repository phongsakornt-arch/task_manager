-- ============================================================
-- Hide เลขบัตรประจำตัวประชาชน (national ID) from non-admin roles,
-- at the API level — not just in the UI. RLS is row-level, not
-- column-level, so a masking VIEW is the right tool: non-admin
-- readers get every column except national_id (nulled out),
-- admin/super_admin see it in full.
--
-- security_invoker = true is essential here: without it, this view
-- (owned by postgres, which has BYPASSRLS) would evaluate RLS using
-- the *owner's* privileges instead of the querying user's, silently
-- defeating both this mask AND the base table's "must be logged in"
-- policy for anyone going through the view. With it, the view runs
-- as the actual caller, so master_members_read_all (auth.uid() IS
-- NOT NULL) still applies normally underneath the mask.
-- ============================================================

CREATE VIEW master_members_view
WITH (security_invoker = true) AS
SELECT
  id, master_id, region, province, seq_no, org_info, entity_type, business_name, tax_id,
  business_type_tsic, business_type_network, business_detail, has_tcc_connect, prefix,
  first_name, last_name,
  CASE WHEN current_user_role() IN ('admin', 'super_admin') THEN national_id ELSE NULL END AS national_id,
  is_yec_provincial, yec_position, phone, email, current_address, birth_date,
  member_since_date, member_expiry_date, verified_by_chair, payment_status, is_chamber_member,
  synced_at, deleted, created_at, updated_at
FROM master_members;

GRANT SELECT ON master_members_view TO authenticated, service_role;
