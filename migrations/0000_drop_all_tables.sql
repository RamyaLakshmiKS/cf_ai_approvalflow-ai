-- migrations/0000_drop_all_tables.sql
-- Drop all existing tables to start fresh

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS company_calendar;
DROP TABLE IF EXISTS expense_requests;
DROP TABLE IF EXISTS pto_balances;
DROP TABLE IF EXISTS pto_requests;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS receipt_uploads;