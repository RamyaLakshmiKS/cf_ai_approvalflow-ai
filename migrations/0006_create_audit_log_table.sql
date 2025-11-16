-- migrations/0006_create_audit_log_table.sql
-- Comprehensive audit trail for all actions in the system

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'pto_request', 'expense_request', 'user', etc.
  entity_id TEXT NOT NULL, -- ID of the entity being modified
  action TEXT NOT NULL, -- 'created', 'approved', 'denied', 'updated', 'cancelled'
  actor_id TEXT, -- User who performed the action (NULL for system actions)
  actor_type TEXT NOT NULL DEFAULT 'user', -- 'user', 'ai_agent', 'system'
  details TEXT, -- JSON string with additional context
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);
