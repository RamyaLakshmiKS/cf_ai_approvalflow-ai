-- migrations/0002_create_pto_requests_table.sql

DROP TABLE IF EXISTS pto_requests;

CREATE TABLE pto_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  manager_id TEXT, -- Allow NULL for auto-approved requests
  start_date TEXT NOT NULL, -- ISO 8601 date
  end_date TEXT NOT NULL, -- ISO 8601 date
  total_days REAL NOT NULL, -- Total business days requested
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'denied', 'auto_approved', 'cancelled'
  approval_type TEXT, -- 'auto', 'manual', NULL if pending
  denial_reason TEXT,
  ai_validation_notes TEXT, -- Notes from AI policy check
  balance_before REAL, -- PTO balance before this request
  balance_after REAL, -- Projected balance after approval
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  approved_at INTEGER,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_id) REFERENCES users(id)
);
