-- migrations/0009_add_escalation_to_pto_requests.sql

-- Add escalation and manager decision columns to PTO requests
-- NOTE: SQLite does NOT support `IF NOT EXISTS` with `ALTER TABLE ... ADD COLUMN`.
-- Use plain ALTER TABLE; the migration runner guarantees this file is executed only once.
ALTER TABLE pto_requests ADD COLUMN escalation_reason TEXT;
ALTER TABLE pto_requests ADD COLUMN approval_notes TEXT;

-- Keep migrations immutable; do not re-run this file after it's been applied successfully.
