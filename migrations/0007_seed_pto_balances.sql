-- Seed PTO balances for test users
-- Based on the handbook:
-- - Junior employees: Accrue 1.5 days per month (18 days/year)
-- - Senior employees: Accrue 2 days per month (24 days/year)

-- ramya_manager (senior, hired 2018-06-01) - should have significant balance
INSERT INTO pto_balances (
  id,
  employee_id,
  total_accrued,
  total_used,
  current_balance,
  rollover_from_previous_year,
  last_accrual_date
)
VALUES (
  '91aa8f8e-3c42-4e59-b7b5-8f8f9a4b1c3d',
  '9c5bce37-3f93-473b-b601-6a313d437c13',
  48.0,  -- 2 years worth (24 days/year)
  10.0,  -- Has used some time
  38.0,  -- Available balance
  5.0,   -- Max rollover from previous year
  '2025-11-01'
)
ON CONFLICT(employee_id) DO UPDATE SET
  total_accrued = excluded.total_accrued,
  total_used = excluded.total_used,
  current_balance = excluded.current_balance,
  rollover_from_previous_year = excluded.rollover_from_previous_year,
  last_accrual_date = excluded.last_accrual_date;

-- ramya_senior (senior, hired 2021-09-01) - good balance
INSERT INTO pto_balances (
  id,
  employee_id,
  total_accrued,
  total_used,
  current_balance,
  rollover_from_previous_year,
  last_accrual_date
)
VALUES (
  '82bb7e7d-2b31-3d48-a6c4-7e7e8a3a0b2c',
  '6785cceb-d34e-40c6-8c41-f773247ba38b',
  24.0,  -- 1 year worth (24 days/year)
  6.0,   -- Has used some time
  18.0,  -- Available balance
  3.0,   -- Rollover from previous year
  '2025-11-01'
)
ON CONFLICT(employee_id) DO UPDATE SET
  total_accrued = excluded.total_accrued,
  total_used = excluded.total_used,
  current_balance = excluded.current_balance,
  rollover_from_previous_year = excluded.rollover_from_previous_year,
  last_accrual_date = excluded.last_accrual_date;

-- ramya_junior (junior, hired 2024-03-01) - newer employee with less balance
INSERT INTO pto_balances (
  id,
  employee_id,
  total_accrued,
  total_used,
  current_balance,
  rollover_from_previous_year,
  last_accrual_date
)
VALUES (
  '73cc6d6c-1a20-2c37-95b3-6d6d7a2a9a1b',
  '17696800-f2ca-4f10-8929-be3bf11ff94b',
  13.5,  -- 9 months (March to November) at 1.5 days/month
  2.0,   -- Used a little time
  11.5,  -- Available balance
  0.0,   -- No rollover (first year)
  '2025-11-01'
)
ON CONFLICT(employee_id) DO UPDATE SET
  total_accrued = excluded.total_accrued,
  total_used = excluded.total_used,
  current_balance = excluded.current_balance,
  rollover_from_previous_year = excluded.rollover_from_previous_year,
  last_accrual_date = excluded.last_accrual_date;
