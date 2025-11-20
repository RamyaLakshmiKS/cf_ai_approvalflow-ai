-- migrations/0009_create_receipt_uploads_table.sql
-- Store receipt metadata and OCR extraction results for expense reimbursements
-- Created: Nov 2025

CREATE TABLE receipt_uploads (
  id TEXT PRIMARY KEY,
  expense_request_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL, -- e.g., 'image/jpeg', 'application/pdf'
  file_size INTEGER NOT NULL, -- bytes
  file_data TEXT, -- Store file as base64 for MVP (no R2 for now)
  upload_date INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  ocr_status TEXT DEFAULT NULL, -- 'pending', 'completed', 'failed'
  extracted_data TEXT, -- JSON: {amount, currency, date, merchant, items}
  processing_errors TEXT, -- Error messages if extraction failed
  created_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (expense_request_id) REFERENCES expense_requests(id) ON DELETE CASCADE
);