-- migrations/0010_enhance_expense_requests_table.sql
-- Adds AI validation fields and receipt linking to expense_requests

-- Add new columns to expense_requests table to support AI validation and receipt processing
ALTER TABLE expense_requests ADD COLUMN ai_validation_status TEXT DEFAULT 'pending'; -- 'pending', 'completed', 'failed'
ALTER TABLE expense_requests ADD COLUMN ai_validation_notes TEXT; -- AI notes on validation
ALTER TABLE expense_requests ADD COLUMN policy_violations TEXT; -- JSON array of policy violations
ALTER TABLE expense_requests ADD COLUMN auto_approved INTEGER DEFAULT 0; -- Boolean: 1 if auto-approved
ALTER TABLE expense_requests ADD COLUMN escalation_reason TEXT; -- Why escalated to manager
ALTER TABLE expense_requests ADD COLUMN employee_level TEXT; -- 'junior', 'senior', captured at submission time
ALTER TABLE expense_requests ADD COLUMN submission_method TEXT DEFAULT 'chat'; -- 'chat', 'form', 'api'
ALTER TABLE expense_requests ADD COLUMN receipt_validation_errors TEXT; -- Errors during receipt parsing

-- Add index for faster queries by status and employee
CREATE INDEX idx_expense_requests_status_employee ON expense_requests(status, employee_id, created_at);
CREATE INDEX idx_expense_requests_ai_validation ON expense_requests(ai_validation_status);
