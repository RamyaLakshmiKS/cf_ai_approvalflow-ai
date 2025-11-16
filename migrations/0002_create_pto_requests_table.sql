-- migrations/0002_create_pto_requests_table.sql

DROP TABLE IF EXISTS pto_requests;

CREATE TABLE pto_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  manager_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES users(id),
  FOREIGN KEY (manager_id) REFERENCES users(id)
);
