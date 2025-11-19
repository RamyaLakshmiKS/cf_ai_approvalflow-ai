-- migrations/0004_create_expense_requests_table.sql
-- Track expense reimbursement requests
-- Updated: Nov 2025 - Simplified for demo (removed unnecessary fields)

CREATE TABLE expense_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  manager_id TEXT,
  category TEXT NOT NULL, -- 'travel', 'meals', 'home_office', 'training', 'software', 'supplies'
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'denied', 'auto_approved'

  -- AI validation & escalation
  ai_validation_status TEXT DEFAULT 'not_validated', -- 'not_validated', 'validated', 'failed'
  auto_approved INTEGER DEFAULT 0, -- Boolean: 1 if auto-approved
  escalation_reason TEXT, -- Why escalated or denied

  -- Audit trail
  employee_level TEXT, -- Snapshot of employee level at submission time
  submission_method TEXT DEFAULT 'chat_ai', -- 'manual', 'chat_ai', 'api'

  created_at INTEGER DEFAULT (strftime('%s','now')),
  approved_at INTEGER,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_id) REFERENCES users(id)
);

CREATE INDEX idx_expense_status_employee ON expense_requests(status, employee_id, created_at DESC);
