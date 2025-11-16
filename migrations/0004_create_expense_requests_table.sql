-- migrations/0004_create_expense_requests_table.sql
-- Track expense reimbursement requests

CREATE TABLE expense_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  manager_id TEXT,
  category TEXT NOT NULL, -- 'travel', 'meals', 'home_office', 'training', etc.
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  receipt_url TEXT, -- Optional: link to uploaded receipt
  has_receipt INTEGER NOT NULL DEFAULT 0, -- Boolean: 1 if receipt provided
  travel_start_date TEXT, -- For travel expenses
  travel_end_date TEXT, -- For travel expenses
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'denied', 'auto_approved'
  denial_reason TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  approved_at INTEGER,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_id) REFERENCES users(id)
);
