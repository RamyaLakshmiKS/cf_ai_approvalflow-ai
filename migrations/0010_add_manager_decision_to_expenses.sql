-- migrations/0010_add_manager_decision_to_expenses.sql

-- Add manager decision / notes to expense requests
ALTER TABLE expense_requests ADD COLUMN approval_notes TEXT;
ALTER TABLE expense_requests ADD COLUMN denied_at INTEGER;

-- Keep migrations immutable; do not re-run this file after it's been applied successfully.
