-- migrations/0009_create_receipt_uploads_table.sql
-- Stores receipt files and OCR extraction results for expense requests

CREATE TABLE receipt_uploads (
  id TEXT PRIMARY KEY,
  expense_request_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL, -- 'image/jpeg', 'image/png', 'application/pdf'
  file_size INTEGER NOT NULL, -- in bytes
  file_data BLOB, -- Base64 encoded or direct binary for direct processing
  upload_status TEXT NOT NULL DEFAULT 'processing', -- 'processing', 'processed', 'failed'
  ocr_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  extracted_data TEXT, -- JSON string with {amount, currency, date, merchant, line_items}
  processing_errors TEXT, -- Error messages if OCR/extraction fails
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (expense_request_id) REFERENCES expense_requests(id) ON DELETE CASCADE
);

-- Index for faster queries by expense_request_id and status
CREATE INDEX idx_receipt_uploads_expense_id ON receipt_uploads(expense_request_id);
CREATE INDEX idx_receipt_uploads_status ON receipt_uploads(ocr_status);
