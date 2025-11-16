-- Seeds: Add three Ramya users for demo and testing
-- The seeds create 3 users: ramya_manager, ramya_senior, ramya_junior
-- All users share the same plaintext password: "Password123!" (pre-hashed here)
-- NOTE: Passwords are PBKDF2(SHA-256) with 100000 iterations and a 16-byte random salt

-- NOTE: D1 does not allow explicit SQL transactions in migration SQL files (use state.storage.transaction() in worker code).

-- Ensure `users` and `sessions` tables exist (in case 0001_create_auth_tables.sql was not applied or got rolled back)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'employee',
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  employee_level TEXT DEFAULT 'junior', -- 'junior' or 'senior'
  manager_id TEXT REFERENCES users(id),
  hire_date TEXT, -- ISO 8601 date for PTO accrual calculation
  department TEXT,
  is_active INTEGER DEFAULT 1, -- Boolean: 1 for active, 0 for inactive
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Manager
INSERT INTO users (
  id, username, email, role, password_hash, salt, employee_level, manager_id, hire_date, department, is_active
)
VALUES (
  '9c5bce37-3f93-473b-b601-6a313d437c13',
  'ramya_manager',
  'ramya.manager@cloudflare.com',
  'manager',
  '4ky2z9jaSRMGvJbjTdrm4KjFRbNXqYvj2yiVWb7p+Kk=', -- precomputed PBKDF2 hash (base64)
  'LSNaFd+vFXmVcSWYDHUwgg==', -- salt (base64)
  'senior',
  NULL,
  '2018-06-01',
  'People Ops',
  1
)
ON CONFLICT(username) DO UPDATE SET
  email = excluded.email,
  role = excluded.role,
  password_hash = excluded.password_hash,
  salt = excluded.salt,
  employee_level = excluded.employee_level,
  manager_id = excluded.manager_id,
  hire_date = excluded.hire_date,
  department = excluded.department,
  is_active = excluded.is_active;

-- Senior (reports to manager)
INSERT INTO users (
  id, username, email, role, password_hash, salt, employee_level, manager_id, hire_date, department, is_active
)
VALUES (
  '6785cceb-d34e-40c6-8c41-f773247ba38b',
  'ramya_senior',
  'ramya.senior@cloudflare.com',
  'employee',
  'CrOAfVlFExIL8YjEUMoA4DUKFKcdeKeKi+R26A1DhZE=',
  'p+bEbwME2Po975K3VNNyhQ==',
  'senior',
  '9c5bce37-3f93-473b-b601-6a313d437c13',
  '2021-09-01',
  'Engineering',
  1
)
ON CONFLICT(username) DO UPDATE SET
  email = excluded.email,
  role = excluded.role,
  password_hash = excluded.password_hash,
  salt = excluded.salt,
  employee_level = excluded.employee_level,
  manager_id = excluded.manager_id,
  hire_date = excluded.hire_date,
  department = excluded.department,
  is_active = excluded.is_active;

-- Junior (reports to senior)
INSERT INTO users (
  id, username, email, role, password_hash, salt, employee_level, manager_id, hire_date, department, is_active
)
VALUES (
  '17696800-f2ca-4f10-8929-be3bf11ff94b',
  'ramya_junior',
  'ramya.junior@cloudflare.com',
  'employee',
  'htwCCE73YIZ/OEbaNzjkGfG3bL0cGaZIiKMndMWhVyA=',
  'OhJ23Xg60oD+xGaKGfpsoQ==',
  'junior',
  '6785cceb-d34e-40c6-8c41-f773247ba38b',
  '2024-03-01',
  'Engineering',
  1
)
ON CONFLICT(username) DO UPDATE SET
  email = excluded.email,
  role = excluded.role,
  password_hash = excluded.password_hash,
  salt = excluded.salt,
  employee_level = excluded.employee_level,
  manager_id = excluded.manager_id,
  hire_date = excluded.hire_date,
  department = excluded.department,
  is_active = excluded.is_active;

-- Migration complete (no explicit COMMIT required in D1 migrations)

-- Ensure the migration is idempotent in case it's applied more than once
-- (Optional) You can wrap inserts in a condition if your migration tooling supports it
