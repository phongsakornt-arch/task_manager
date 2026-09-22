-- ============================================================
-- Google Calendar OAuth2 connection (replaces the service-account
-- approach, which the org's Workspace external-sharing policy
-- blocks from getting edit access to the calendar)
-- ============================================================

CREATE TABLE google_calendar_auth (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
  refresh_token   text,
  connected_email text,
  connected_by    uuid REFERENCES users(id),
  connected_at    timestamptz,
  pending_state   text, -- CSRF nonce for the in-flight OAuth redirect, cleared on callback
  updated_at      timestamptz DEFAULT now()
);

CREATE TRIGGER google_calendar_auth_updated_at
  BEFORE UPDATE ON google_calendar_auth
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ไม่มี policy ใดๆ เลย (RLS เปิดแต่ไม่มี policy = ปิดสนิทสำหรับ anon/authenticated)
-- refresh_token ต้องไม่เปิดให้ client อ่านได้เด็ดขาด — สถานะเชื่อมต่อดูผ่าน edge
-- function (google-oauth-status) ที่คืนแค่ connected/connected_email เท่านั้น
ALTER TABLE google_calendar_auth ENABLE ROW LEVEL SECURITY;
