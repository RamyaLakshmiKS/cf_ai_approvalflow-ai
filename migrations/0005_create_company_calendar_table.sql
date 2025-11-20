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

-- Insert blackout periods for 2026
INSERT INTO company_calendar (id, event_type, name, start_date, end_date, description) VALUES
  ('blackout-2026-new-year-week', 'blackout', 'First Week of January', '2026-01-02', '2026-01-09', 'New year planning week - PTO restricted'),
  ('blackout-2026-q1-end', 'blackout', 'Q1 Fiscal Quarter End', '2026-03-23', '2026-03-31', 'Last week of Q1 - PTO restricted'),
  ('blackout-2026-q2-end', 'blackout', 'Q2 Fiscal Quarter End', '2026-06-22', '2026-06-30', 'Last week of Q2 - PTO restricted'),
  ('blackout-2026-q3-end', 'blackout', 'Q3 Fiscal Quarter End', '2026-09-21', '2026-09-30', 'Last week of Q3 - PTO restricted'),
  ('blackout-2026-q4-end', 'blackout', 'Q4 Fiscal Quarter End', '2026-12-21', '2026-12-31', 'Last week of Q4 - PTO restricted');

-- 2027 Company Holidays
INSERT INTO company_calendar (id, name, event_type, start_date, end_date, description)
VALUES
  ('holiday-2027-newyear', 'New Year''s Day', 'holiday', '2027-01-01', '2027-01-01', 'Paid company holiday'),
  ('holiday-2027-mlk', 'Martin Luther King Jr. Day', 'holiday', '2027-01-18', '2027-01-18', 'Paid company holiday'),
  ('holiday-2027-presidents', 'Presidents'' Day', 'holiday', '2027-02-15', '2027-02-15', 'Paid company holiday'),
  ('holiday-2027-memorial', 'Memorial Day', 'holiday', '2027-05-31', '2027-05-31', 'Paid company holiday'),
  ('holiday-2027-juneteenth', 'Juneteenth', 'holiday', '2027-06-19', '2027-06-19', 'Paid company holiday'),
  ('holiday-2027-independence', 'Independence Day', 'holiday', '2027-07-05', '2027-07-05', 'Paid company holiday'),
  ('holiday-2027-labor', 'Labor Day', 'holiday', '2027-09-06', '2027-09-06', 'Paid company holiday'),
  ('holiday-2027-thanksgiving', 'Thanksgiving Day', 'holiday', '2027-11-25', '2027-11-25', 'Paid company holiday'),
  ('holiday-2027-thanksgiving-fri', 'Day after Thanksgiving', 'holiday', '2027-11-26', '2027-11-26', 'Paid company holiday'),
  ('holiday-2027-christmas', 'Christmas Day', 'holiday', '2027-12-24', '2027-12-24', 'Paid company holiday');

-- Insert blackout periods for 2027
INSERT INTO company_calendar (id, event_type, name, start_date, end_date, description) VALUES
  ('blackout-2027-new-year-week', 'blackout', 'First Week of January', '2027-01-04', '2027-01-11', 'New year planning week - PTO restricted'),
  ('blackout-2027-q1-end', 'blackout', 'Q1 Fiscal Quarter End', '2027-03-22', '2027-03-31', 'Last week of Q1 - PTO restricted'),
  ('blackout-2027-q2-end', 'blackout', 'Q2 Fiscal Quarter End', '2027-06-21', '2027-06-30', 'Last week of Q2 - PTO restricted'),
  ('blackout-2027-q3-end', 'blackout', 'Q3 Fiscal Quarter End', '2027-09-20', '2027-09-30', 'Last week of Q3 - PTO restricted'),
  ('blackout-2027-q4-end', 'blackout', 'Q4 Fiscal Quarter End', '2027-12-20', '2027-12-31', 'Last week of Q4 - PTO restricted');

INSERT INTO company_calendar (id, name, event_type, start_date, end_date, description)
VALUES 
  ('holiday-2026-newyear', 'New Year''s Day', 'holiday', '2026-01-01', '2026-01-01', 'Paid company holiday'),
  ('holiday-2026-mlk', 'Martin Luther King Jr. Day', 'holiday', '2026-01-19', '2026-01-19', 'Paid company holiday'),
  ('holiday-2026-presidents', 'Presidents'' Day', 'holiday', '2026-02-16', '2026-02-16', 'Paid company holiday'),
  ('holiday-2026-memorial', 'Memorial Day', 'holiday', '2026-05-25', '2026-05-25', 'Paid company holiday'),
  ('holiday-2026-juneteenth', 'Juneteenth', 'holiday', '2026-06-19', '2026-06-19', 'Paid company holiday'),
  ('holiday-2026-independence', 'Independence Day', 'holiday', '2026-07-03', '2026-07-03', 'Paid company holiday'),
  ('holiday-2026-labor', 'Labor Day', 'holiday', '2026-09-07', '2026-09-07', 'Paid company holiday'),
  ('holiday-2026-thanksgiving', 'Thanksgiving Day', 'holiday', '2026-11-26', '2026-11-26', 'Paid company holiday'),
  ('holiday-2026-thanksgiving-fri', 'Day after Thanksgiving', 'holiday', '2026-11-27', '2026-11-27', 'Paid company holiday'),
  ('holiday-2026-christmas', 'Christmas Day', 'holiday', '2026-12-25', '2026-12-25', 'Paid company holiday');