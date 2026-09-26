-- cleanup: temporary verification helper from the previous migration
DROP FUNCTION IF EXISTS tmp_test_log_forgery(uuid, uuid);
