-- `users` table
CREATE TABLE users (
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

-- `sessions` table (optional; you can also use JWTs)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);