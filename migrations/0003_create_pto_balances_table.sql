-- migrations/0003_create_pto_balances_table.sql
-- Track PTO balances and accruals for each employee

CREATE TABLE pto_balances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE,
  total_accrued REAL NOT NULL DEFAULT 0, -- Total days accrued since hire
  total_used REAL NOT NULL DEFAULT 0, -- Total days used
  current_balance REAL NOT NULL DEFAULT 0, -- Available balance (accrued - used)
  rollover_from_previous_year REAL NOT NULL DEFAULT 0, -- Max 5 days per policy
  last_accrual_date TEXT, -- Last date PTO was accrued
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
);
