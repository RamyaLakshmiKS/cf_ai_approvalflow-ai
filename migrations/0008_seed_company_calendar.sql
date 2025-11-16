-- Seed company calendar with holidays and blackout periods
-- Based on the handbook:
-- - 10 paid company holidays
-- - Blackout periods: last week of fiscal quarters, first week of January, major launches

-- 2025 Company Holidays
INSERT INTO company_calendar (id, name, event_type, start_date, end_date, description)
VALUES 
  ('holiday-2025-newyear', 'New Year''s Day', 'holiday', '2025-01-01', '2025-01-01', 'Paid company holiday'),
  ('holiday-2025-mlk', 'Martin Luther King Jr. Day', 'holiday', '2025-01-20', '2025-01-20', 'Paid company holiday'),
  ('holiday-2025-presidents', 'Presidents'' Day', 'holiday', '2025-02-17', '2025-02-17', 'Paid company holiday'),
  ('holiday-2025-memorial', 'Memorial Day', 'holiday', '2025-05-26', '2025-05-26', 'Paid company holiday'),
  ('holiday-2025-juneteenth', 'Juneteenth', 'holiday', '2025-06-19', '2025-06-19', 'Paid company holiday'),
  ('holiday-2025-independence', 'Independence Day', 'holiday', '2025-07-04', '2025-07-04', 'Paid company holiday'),
  ('holiday-2025-labor', 'Labor Day', 'holiday', '2025-09-01', '2025-09-01', 'Paid company holiday'),
  ('holiday-2025-thanksgiving', 'Thanksgiving Day', 'holiday', '2025-11-27', '2025-11-27', 'Paid company holiday'),
  ('holiday-2025-thanksgiving-fri', 'Day after Thanksgiving', 'holiday', '2025-11-28', '2025-11-28', 'Paid company holiday'),
  ('holiday-2025-christmas', 'Christmas Day', 'holiday', '2025-12-25', '2025-12-25', 'Paid company holiday')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  event_type = excluded.event_type,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  description = excluded.description;

-- 2025 Blackout Periods
INSERT INTO company_calendar (id, name, event_type, start_date, end_date, description)
VALUES 
  ('blackout-2025-q1-end', 'Q1 Fiscal Quarter End', 'blackout', '2025-03-24', '2025-03-31', 'Critical period - PTO generally not approved'),
  ('blackout-2025-q2-end', 'Q2 Fiscal Quarter End', 'blackout', '2025-06-23', '2025-06-30', 'Critical period - PTO generally not approved'),
  ('blackout-2025-q3-end', 'Q3 Fiscal Quarter End', 'blackout', '2025-09-22', '2025-09-30', 'Critical period - PTO generally not approved'),
  ('blackout-2025-q4-end', 'Q4 Fiscal Quarter End', 'blackout', '2025-12-22', '2025-12-31', 'Critical period - PTO generally not approved'),
  ('blackout-2026-jan-start', 'New Year Planning Week', 'blackout', '2026-01-02', '2026-01-09', 'Critical planning period - PTO generally not approved')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  event_type = excluded.event_type,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  description = excluded.description;

-- 2026 Company Holidays (partial list for continuity)
INSERT INTO company_calendar (id, name, event_type, start_date, end_date, description)
VALUES 
  ('holiday-2026-newyear', 'New Year''s Day', 'holiday', '2026-01-01', '2026-01-01', 'Paid company holiday'),
  ('holiday-2026-mlk', 'Martin Luther King Jr. Day', 'holiday', '2026-01-19', '2026-01-19', 'Paid company holiday')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  event_type = excluded.event_type,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  description = excluded.description;
