/**
 * AI SDK Tool Definitions
 * 
 * Converts custom Tool definitions to AI SDK tool() format with zod schemas
 * These tools are used by streamText() to enable tool calling
 */

import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tools";
import { tools as customTools } from "./tools";
import { getHandbookSearchPrompt } from "./prompts";
import handbookContent from "../docs/employee_handbook.md?raw";

/**
 * Create AI SDK tools with proper context binding
 */
export function createAITools(context: ToolContext) {
  return {
    get_current_user: tool({
      description:
        "Retrieves the authenticated user's profile including ID, name, role, employee level, and manager. Use this first to understand who is making the request.",
      parameters: z.object({}),
      execute: async () => {
        return await customTools.get_current_user.execute({}, context);
      }
    }),

    search_employee_handbook: tool({
      description:
        "Searches the employee handbook to find relevant policies and rules. Use this for any policy-related questions or validations about PTO, expenses, benefits, blackout periods, auto-approval limits, etc.",
      parameters: z.object({
        query: z
          .string()
          .describe(
            "Natural language query about company policies (e.g., 'What are the PTO auto-approval limits?', 'What are the blackout periods?', 'What is the expense reimbursement policy?')"
          )
      }),
      execute: async ({ query }) => {
        return await customTools.search_employee_handbook.execute(
          { query },
          context
        );
      }
    }),

    get_pto_balance: tool({
      description:
        "Retrieves the employee's current PTO balance, accrued days, used days, and rollover information.",
      parameters: z.object({
        employee_id: z
          .string()
          .optional()
          .describe("The employee's ID (optional, defaults to current user)")
      }),
      execute: async ({ employee_id }) => {
        return await customTools.get_pto_balance.execute(
          { employee_id },
          context
        );
      }
    }),

    check_blackout_periods: tool({
      description:
        "Checks if the requested dates overlap with company blackout periods (fiscal quarter ends, holidays). Use this to validate PTO requests.",
      parameters: z.object({
        start_date: z
          .string()
          .describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
        end_date: z
          .string()
          .describe("End date in ISO 8601 format (YYYY-MM-DD)")
      }),
      execute: async ({ start_date, end_date }) => {
        return await customTools.check_blackout_periods.execute(
          { start_date, end_date },
          context
        );
      }
    }),

    get_pto_history: tool({
      description:
        "Retrieves past PTO requests for the employee, including approved, denied, and pending requests.",
      parameters: z.object({
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
      }),
      execute: async ({ employee_id, limit, status_filter }) => {
        return await customTools.get_pto_history.execute(
          { employee_id, limit, status_filter },
          context
        );
      }
    }),

    calculate_business_days: tool({
      description:
        "Calculates the number of business days (excluding weekends and holidays) between two dates. Use this to determine the actual PTO days needed.",
      parameters: z.object({
        start_date: z
          .string()
          .describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
        end_date: z
          .string()
          .describe("End date in ISO 8601 format (YYYY-MM-DD)")
      }),
      execute: async ({ start_date, end_date }) => {
        return await customTools.calculate_business_days.execute(
          { start_date, end_date },
          context
        );
      }
    }),

    validate_pto_policy: tool({
      description:
        "Validates a PTO request against all company policies: balance, blackouts, and auto-approval limits. Use this before submitting a PTO request. CRITICAL: You MUST call get_current_user first to get the employee_id. Do NOT call this tool without all required parameters (employee_id, start_date, end_date).",
      parameters: z.object({
        employee_id: z
          .string()
          .describe(
            "Employee ID - REQUIRED. Get this by calling get_current_user first. Use the 'id' field from get_current_user result."
          ),
        start_date: z
          .string()
          .describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
        end_date: z
          .string()
          .describe("End date in ISO 8601 format (YYYY-MM-DD)"),
        reason: z
          .string()
          .optional()
          .describe("Reason for PTO request (optional)")
      }),
      execute: async ({ employee_id, start_date, end_date, reason }) => {
        return await customTools.validate_pto_policy.execute(
          { employee_id, start_date, end_date, reason },
          context
        );
      }
    }),

    submit_pto_request: tool({
      description:
        "Submits a PTO request to the database after validation. Sets status based on auto-approval or escalation. Only use this AFTER validating with validate_pto_policy.",
      parameters: z.object({
        employee_id: z.string().describe("Employee ID"),
        start_date: z
          .string()
          .describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
        end_date: z
          .string()
          .describe("End date in ISO 8601 format (YYYY-MM-DD)"),
        total_days: z.number().describe("Total business days requested"),
        reason: z.string().optional().describe("Reason for PTO request"),
        status: z
          .enum(["auto_approved", "pending", "denied"])
          .describe("Status of the request"),
        approval_type: z
          .enum(["auto", "manual"])
          .describe("Type of approval"),
        validation_notes: z
          .string()
          .optional()
          .describe("Notes from validation process")
      }),
      execute: async ({
        employee_id,
        start_date,
        end_date,
        total_days,
        reason,
        status,
        approval_type,
        validation_notes
      }) => {
        return await customTools.submit_pto_request.execute(
          {
            employee_id,
            start_date,
            end_date,
            total_days,
            reason,
            status,
            approval_type,
            validation_notes
          },
          context
        );
      }
    }),

    log_audit_event: tool({
      description:
        "Logs an action to the audit trail for compliance and tracking. Use this for all significant actions.",
      parameters: z.object({
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
          .record(z.unknown())
          .optional()
          .describe("Additional details about the action (optional)")
      }),
      execute: async ({ entity_type, entity_id, action, details }) => {
        return await customTools.log_audit_event.execute(
          { entity_type, entity_id, action, details },
          context
        );
      }
    })
  };
}

