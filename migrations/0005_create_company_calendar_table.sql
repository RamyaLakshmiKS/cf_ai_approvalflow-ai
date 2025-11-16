-- migrations/0005_create_company_calendar_table.sql
-- Track blackout periods, holidays, and critical dates

CREATE TABLE company_calendar (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL, -- 'blackout', 'holiday', 'product_launch'
  name TEXT NOT NULL,
  start_date TEXT NOT NULL, -- ISO 8601 date
  end_date TEXT NOT NULL, -- ISO 8601 date
  description TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Insert company holidays for 2025
INSERT INTO company_calendar (id, event_type, name, start_date, end_date, description) VALUES
  ('holiday-2025-newyear', 'holiday', 'New Year''s Day', '2025-01-01', '2025-01-01', 'Paid company holiday'),
  ('holiday-2025-mlk', 'holiday', 'Martin Luther King Jr. Day', '2025-01-20', '2025-01-20', 'Paid company holiday'),
  ('holiday-2025-presidents', 'holiday', 'Presidents'' Day', '2025-02-17', '2025-02-17', 'Paid company holiday'),
  ('holiday-2025-memorial', 'holiday', 'Memorial Day', '2025-05-26', '2025-05-26', 'Paid company holiday'),
  ('holiday-2025-juneteenth', 'holiday', 'Juneteenth', '2025-06-19', '2025-06-19', 'Paid company holiday'),
  ('holiday-2025-independence', 'holiday', 'Independence Day', '2025-07-04', '2025-07-04', 'Paid company holiday'),
  ('holiday-2025-labor', 'holiday', 'Labor Day', '2025-09-01', '2025-09-01', 'Paid company holiday'),
  ('holiday-2025-thanksgiving', 'holiday', 'Thanksgiving Day', '2025-11-27', '2025-11-27', 'Paid company holiday'),
  ('holiday-2025-thanksgiving-after', 'holiday', 'Day after Thanksgiving', '2025-11-28', '2025-11-28', 'Paid company holiday'),
  ('holiday-2025-christmas', 'holiday', 'Christmas Day', '2025-12-25', '2025-12-25', 'Paid company holiday');

-- Insert blackout periods (fiscal quarter ends + first week of January)
INSERT INTO company_calendar (id, event_type, name, start_date, end_date, description) VALUES
  ('blackout-2025-q1-end', 'blackout', 'Q1 Fiscal Quarter End', '2025-03-24', '2025-03-31', 'Last week of Q1 - PTO restricted'),
  ('blackout-2025-q2-end', 'blackout', 'Q2 Fiscal Quarter End', '2025-06-23', '2025-06-30', 'Last week of Q2 - PTO restricted'),
  ('blackout-2025-q3-end', 'blackout', 'Q3 Fiscal Quarter End', '2025-09-22', '2025-09-30', 'Last week of Q3 - PTO restricted'),
  ('blackout-2025-q4-end', 'blackout', 'Q4 Fiscal Quarter End', '2025-12-24', '2025-12-31', 'Last week of Q4 - PTO restricted'),
  ('blackout-2025-new-year-week', 'blackout', 'First Week of January', '2025-01-02', '2025-01-09', 'New year planning week - PTO restricted');
