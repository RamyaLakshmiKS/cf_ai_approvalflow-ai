/**
 * Zod schemas for all tools
 * Separated for cleaner code organization
 */
import { z } from "zod";

export const getCurrentUserSchema = z.object({});

export const searchEmployeeHandbookSchema = z.object({
  query: z
    .string()
    .describe(
      "Natural language query about company policies (e.g., 'What are the PTO auto-approval limits?', 'What are the blackout periods?', 'What is the expense reimbursement policy?')"
    )
});

export const getPTOBalanceSchema = z.object({
  employee_id: z
    .string()
    .optional()
    .describe("The employee's ID (optional, defaults to current user)")
});

export const checkBlackoutPeriodsSchema = z.object({
  start_date: z.string().describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO 8601 format (YYYY-MM-DD)")
});

export const getPTOHistorySchema = z.object({
  employee_id: z
    .string()
    .optional()
    .describe("Employee ID (optional, defaults to current user)"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of records to return (default: 10)"),
  status_filter: z
    .enum(["approved", "denied", "pending", "all"])
    .optional()
    .describe("Filter by status: approved, denied, pending, or all")
});

export const calculateBusinessDaysSchema = z.object({
  start_date: z.string().describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO 8601 format (YYYY-MM-DD)")
});

export const validatePTOPolicySchema = z.object({
  employee_id: z.string().describe("Employee ID"),
  start_date: z.string().describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO 8601 format (YYYY-MM-DD)"),
  reason: z.string().optional().describe("Reason for PTO request (optional)")
});

export const submitPTORequestSchema = z.object({
  employee_id: z.string().describe("Employee ID"),
  start_date: z.string().describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
  end_date: z.string().describe("End date in ISO 8601 format (YYYY-MM-DD)"),
  total_days: z.number().describe("Total business days requested"),
  reason: z.string().describe("Reason for PTO request"),
  status: z
    .enum(["auto_approved", "pending", "denied"])
    .describe("Status of the request"),
  approval_type: z.enum(["auto", "manual"]).describe("Type of approval"),
  validation_notes: z
    .string()
    .optional()
    .describe("Notes from validation process")
});

export const logAuditEventSchema = z.object({
  entity_type: z
    .string()
    .describe(
      "Type of entity (e.g., 'pto_request', 'expense_request', 'user')"
    ),
  entity_id: z.string().describe("ID of the entity"),
  action: z
    .string()
    .describe(
      "Action performed (e.g., 'created', 'approved', 'denied', 'updated')"
    ),
  details: z
    .record(z.any())
    .optional()
    .describe("Additional details about the action (optional)")
});
