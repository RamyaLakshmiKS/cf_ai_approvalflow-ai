import handbookContent from "../docs/employee_handbook.md?raw";
import { getHandbookSearchPrompt } from "./prompts";
import { z } from "zod";
import * as schemas from "./tools-schemas";

/**
 * Tool Registry for AI SDK Tool Execution
 * Tools are defined with zod schemas for type safety
 */

// Tool execution context interface
export interface ToolContext {
  env: Env;
  userId: string;
}

// Custom Tool type for AI SDK tool execution
export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  execute: (
    params: Record<string, unknown>,
    context: ToolContext
  ) => Promise<unknown>;
}

/**
 * Tool 1: Get Current User
 * Retrieves the authenticated user's profile
 */
const get_current_user: Tool = {
  name: "get_current_user",
  description:
    "Retrieves the authenticated user's profile including ID, name, role, employee level, and manager. Use this first to understand who is making the request.",
  parameters: schemas.getCurrentUserSchema,
  execute: async (_params: Record<string, unknown>, context: ToolContext) => {
    console.log("[TOOL] get_current_user called for userId:", context.userId);
    const user = await context.env.APP_DB.prepare(
      "SELECT id, username, employee_level, manager_id, hire_date, department, role FROM users WHERE id = ?"
    )
      .bind(context.userId)
      .first();

    if (!user) {
      console.warn("[TOOL] get_current_user - User not found:", context.userId);
      throw new Error("User not found");
    }

    console.log(
      "[TOOL] get_current_user - Retrieved user:",
      (user as { username: string }).username
    );
    return user;
  }
};

/**
 * Tool 2: Search Employee Handbook
 * Uses LLM to answer policy questions from the handbook
 */
const search_employee_handbook: Tool = {
  name: "search_employee_handbook",
  description:
    "Searches the employee handbook to find relevant policies and rules. Use this for any policy-related questions or validations about PTO, expenses, benefits, blackout periods, auto-approval limits, etc.",
  parameters: schemas.searchEmployeeHandbookSchema,
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const { query } = params as { query: string };
    console.log("[TOOL] search_employee_handbook called with query:", query);

    // Use Workers AI to answer questions from the handbook
    const prompt = getHandbookSearchPrompt(handbookContent, query);

    const response = (await context.env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct" as keyof AiModels,
      {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500
      }
    )) as { response?: string };
    console.log("[TOOL] search_employee_handbook - Got response from AI");

    return {
      answer: response.response || String(response),
      source: "Employee Handbook"
    };
  }
};

/**
 * Tool 3: Get PTO Balance
 * Retrieves current PTO information for an employee
 */
const get_pto_balance: Tool = {
  name: "get_pto_balance",
  description:
    "Retrieves the employee's current PTO balance, accrued days, used days, and rollover information.",
  parameters: schemas.getPTOBalanceSchema,
  execute: async (params: { employee_id?: string }, context: ToolContext) => {
    const userId = params.employee_id || context.userId;
    console.log("[TOOL] get_pto_balance called for employee:", userId);

    const ptoBalance = await context.env.APP_DB.prepare(
      "SELECT current_balance, total_accrued, total_used, rollover_from_previous_year FROM pto_balances WHERE employee_id = ?"
    )
      .bind(userId)
      .first();

    if (!ptoBalance) {
      console.warn(
        "[TOOL] get_pto_balance - No balance found for employee:",
        userId
      );
      return {
        error: "PTO balance not found for this employee",
        current_balance: 0,
        total_accrued: 0,
        total_used: 0,
        rollover_from_previous_year: 0
      };
    }

    console.log("[TOOL] get_pto_balance - Retrieved balance:", {
      current_balance: (ptoBalance as { current_balance: number })
        .current_balance
    });
    return ptoBalance;
  }
};

/**
 * Tool 4: Check Blackout Periods
 * Validates if dates conflict with company blackout periods
 */
const check_blackout_periods: Tool = {
  name: "check_blackout_periods",
  description:
    "Checks if the requested dates overlap with company blackout periods (fiscal quarter ends, holidays). Use this to validate PTO requests.",
  parameters: schemas.checkBlackoutPeriodsSchema,
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const { start_date, end_date } = params as {
      start_date: string;
      end_date: string;
    };
    console.log("[TOOL] check_blackout_periods called for dates:", {
      start_date,
      end_date
    });

    const blackouts = await context.env.APP_DB.prepare(
      `SELECT * FROM company_calendar 
      WHERE event_type = 'blackout' 
      AND (
        (start_date BETWEEN ?1 AND ?2) OR 
        (end_date BETWEEN ?1 AND ?2) OR
        (?1 BETWEEN start_date AND end_date) OR
        (?2 BETWEEN start_date AND end_date)
      )`
    )
      .bind(start_date, end_date)
      .all();

    console.log(
      "[TOOL] check_blackout_periods - Found",
      blackouts.results.length,
      "conflicts"
    );
    return {
      has_conflict: blackouts.results.length > 0,
      conflicting_periods: blackouts.results
    };
  }
};

/**
 * Tool 5: Get PTO History
 * Retrieves past PTO requests
 */
const get_pto_history: Tool = {
  name: "get_pto_history",
  description:
    "Retrieves past PTO requests for the employee, including approved, denied, and pending requests.",
  parameters: schemas.getPTOHistorySchema,
  execute: async (
    params: { employee_id?: string; limit?: number; status_filter?: string },
    context: ToolContext
  ) => {
    const userId = params.employee_id || context.userId;
    const limit = params.limit || 10;
    const statusFilter = params.status_filter || "all";
    console.log("[TOOL] get_pto_history called with:", {
      userId,
      limit,
      statusFilter
    });

    let query = "SELECT * FROM pto_requests WHERE employee_id = ?";
    const queryParams: string[] = [userId];

    if (statusFilter && statusFilter !== "all") {
      query += " AND status = ?";
      queryParams.push(statusFilter);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    queryParams.push(limit.toString());

    const history = await context.env.APP_DB.prepare(query)
      .bind(...queryParams)
      .all();
    console.log(
      "[TOOL] get_pto_history - Retrieved",
      (history.results as unknown[]).length,
      "records"
    );
    return history.results;
  }
};

/**
 * Tool 6: Calculate Business Days
 * Calculates business days excluding weekends and holidays
 */
const calculate_business_days: Tool = {
  name: "calculate_business_days",
  description:
    "Calculates the number of business days (excluding weekends and holidays) between two dates. Use this to determine the actual PTO days needed.",
  parameters: schemas.calculateBusinessDaysSchema,
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const { start_date, end_date } = params as {
      start_date: string;
      end_date: string;
    };
    console.log("[TOOL] calculate_business_days called for:", {
      start_date,
      end_date
    });

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    // Get company holidays in range
    const holidays = await context.env.APP_DB.prepare(
      `SELECT start_date FROM company_calendar 
      WHERE event_type = 'holiday' 
      AND start_date BETWEEN ?1 AND ?2`
    )
      .bind(start_date, end_date)
      .all();

    const holidaySet = new Set(
      (holidays.results as { start_date: string }[]).map((h) => h.start_date)
    );

    let businessDays = 0;
    let weekendDays = 0;
    const current = new Date(startDate);

    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      const dateStr = current.toISOString().split("T")[0];

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        // Weekend
        weekendDays++;
      } else if (!holidaySet.has(dateStr)) {
        // Weekday, not a holiday
        businessDays++;
      }

      current.setDate(current.getDate() + 1);
    }

    console.log("[TOOL] calculate_business_days - Calculated:", {
      businessDays,
      weekendDays,
      holidays: Array.from(holidaySet).length
    });
    return {
      business_days: businessDays,
      weekend_days: weekendDays,
      holidays: Array.from(holidaySet)
    };
  }
};

/**
 * Tool 7: Validate PTO Policy
 * Comprehensive validation against all company policies
 */
const validate_pto_policy: Tool = {
  name: "validate_pto_policy",
  description:
    "Validates a PTO request against all company policies: balance, blackouts, and auto-approval limits. Use this before submitting a PTO request.",
  parameters: schemas.validatePTOPolicySchema,
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const { employee_id, start_date, end_date } = params as {
      employee_id: string;
      start_date: string;
      end_date: string;
      reason?: string;
    };
    console.log("[TOOL] validate_pto_policy called with:", {
      employee_id,
      start_date,
      end_date
    });

    const violations: Array<{ policy: string; message: string }> = [];

    // Get employee info
    const employee = await context.env.APP_DB.prepare(
      "SELECT employee_level FROM users WHERE id = ?"
    )
      .bind(params.employee_id)
      .first();

    if (!employee) {
      console.error(
        "[TOOL] validate_pto_policy - Employee not found:",
        employee_id
      );
      throw new Error("Employee not found");
    }

    // Get balance
    const balance = await get_pto_balance.execute({ employee_id }, context);

    // Calculate business days
    const businessDays = (await calculate_business_days.execute(
      { start_date, end_date },
      context
    )) as { business_days: number; weekend_days: number; holidays: string[] };

    // Rule 1: Sufficient balance
    if (
      (balance as { current_balance: number }).current_balance <
      businessDays.business_days
    ) {
      violations.push({
        policy: "insufficient_balance",
        message: `Insufficient PTO balance. You have ${(balance as { current_balance: number }).current_balance} days available, but you're requesting ${businessDays.business_days} business days.`
      });
    }

    // Rule 2: No blackout conflicts
    const blackouts = await check_blackout_periods.execute(
      { start_date, end_date },
      context
    );
    if (
      (
        blackouts as {
          has_conflict: boolean;
          conflicting_periods: {
            name?: string;
            start_date: string;
            end_date: string;
          }[];
        }
      ).has_conflict
    ) {
      const period = (
        blackouts as {
          has_conflict: boolean;
          conflicting_periods: {
            name?: string;
            start_date: string;
            end_date: string;
          }[];
        }
      ).conflicting_periods[0];
      violations.push({
        policy: "blackout_conflict",
        message: `Request overlaps with blackout period: ${period.name || "Company blackout"} (${period.start_date} to ${period.end_date})`
      });
    }

    // Rule 3: Auto-approval threshold
    const autoApprovalLimit =
      (employee as { employee_level: string }).employee_level === "senior"
        ? 10
        : 3;
    const canAutoApprove =
      businessDays.business_days <= autoApprovalLimit &&
      violations.length === 0;
    const requiresEscalation =
      businessDays.business_days > autoApprovalLimit && violations.length === 0;

    console.log("[TOOL] validate_pto_policy - Validation result:", {
      canAutoApprove,
      requiresEscalation,
      violationCount: violations.length
    });

    return {
      is_valid: violations.length === 0,
      can_auto_approve: canAutoApprove,
      requires_escalation: requiresEscalation,
      violations,
      business_days_requested: businessDays.business_days,
      auto_approval_limit: autoApprovalLimit,
      recommendation: canAutoApprove
        ? "AUTO_APPROVE"
        : requiresEscalation
          ? "ESCALATE_TO_MANAGER"
          : "DENY"
    };
  }
};

/**
 * Tool 8: Submit PTO Request
 * Creates a PTO request in the database
 */
const submit_pto_request: Tool = {
  name: "submit_pto_request",
  description:
    "Submits a PTO request to the database after validation. Sets status based on auto-approval or escalation. Only use this AFTER validating with validate_pto_policy.",
  parameters: schemas.submitPTORequestSchema,
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const {
      employee_id,
      start_date,
      end_date,
      total_days,
      reason,
      status,
      approval_type,
      validation_notes
    } = params as {
      employee_id: string;
      start_date: string;
      end_date: string;
      total_days: number;
      reason?: string;
      status: string;
      approval_type: string;
      validation_notes?: string;
    };
    const requestId = crypto.randomUUID();
    console.log("[TOOL] submit_pto_request called with:", {
      employee_id,
      total_days,
      status
    });

    // Get manager ID
    const employee = await context.env.APP_DB.prepare(
      "SELECT manager_id FROM users WHERE id = ?"
    )
      .bind(params.employee_id)
      .first();

    // Insert PTO request
    await context.env.APP_DB.prepare(
      `INSERT INTO pto_requests (
        id, employee_id, manager_id, start_date, end_date,
        total_days, reason, status, approval_type, ai_validation_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        requestId,
        employee_id,
        (employee as { manager_id: string }).manager_id,
        start_date,
        end_date,
        total_days,
        reason || "",
        status,
        approval_type,
        validation_notes || ""
      )
      .run();

    // If auto-approved, update balance
    if (params.status === "auto_approved") {
      console.log(
        "[TOOL] submit_pto_request - Auto-approving and updating balance"
      );
      await context.env.APP_DB.prepare(
        "UPDATE pto_balances SET total_used = total_used + ?, current_balance = current_balance - ? WHERE employee_id = ?"
      )
        .bind(total_days, total_days, employee_id)
        .run();
    }

    // Log audit event
    await log_audit_event.execute(
      {
        entity_type: "pto_request",
        entity_id: requestId,
        action: "created",
        details: {
          status,
          approval_type,
          days_requested: total_days
        }
      },
      context
    );

    console.log(
      "[TOOL] submit_pto_request - Request created successfully:",
      requestId
    );

    return {
      request_id: requestId,
      status: params.status,
      message: "Request submitted successfully"
    };
  }
};

/**
 * Tool 9: Log Audit Event
 * Records all agent actions for compliance
 */
const log_audit_event: Tool = {
  name: "log_audit_event",
  description:
    "Logs an action to the audit trail for compliance and tracking. Use this for all significant actions.",
  parameters: schemas.logAuditEventSchema,
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const { entity_type, entity_id, action, details } = params as {
      entity_type: string;
      entity_id: string;
      action: string;
      details?: Record<string, unknown>;
    };
    console.log("[TOOL] log_audit_event:", {
      entity_type,
      entity_id,
      action
    });

    await context.env.APP_DB.prepare(
      `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, actor_type, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        entity_type,
        entity_id,
        action,
        context.userId,
        "ai_agent",
        details ? JSON.stringify(details) : null
      )
      .run();

    console.log("[TOOL] log_audit_event - Audit event logged successfully");
    return { success: true };
  }
};

/**
 * Tool Registry
 * Maps tool names to tool implementations
 */
export const tools: Record<string, Tool> = {
  get_current_user,
  search_employee_handbook,
  get_pto_balance,
  check_blackout_periods,
  get_pto_history,
  calculate_business_days,
  validate_pto_policy,
  submit_pto_request,
  log_audit_event
};

/**
 * Get tool descriptions for LLM
 * Formats tools as JSON for the system prompt
 */
export function getToolDescriptions(): string {
  return Object.values(tools)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }))
    .map((t) => JSON.stringify(t, null, 2))
    .join("\n\n");
}
