import { tool, type ToolSet, generateText } from "ai";
import { z } from "zod/v3";
import { createWorkersAI } from "workers-ai-provider";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";
// @ts-expect-error - This is a Vite feature to import raw text
import handbookContent from "../docs/employee_handbook.md?raw";

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    // we can now read the agent context from the ALS store
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date // scheduled
        : when.type === "delayed"
          ? when.delayInSeconds // delayed
          : when.type === "cron"
            ? when.cron // cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * Tool to list all scheduled tasks
 * This executes automatically without requiring human confirmation
 */
const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Tool to cancel a scheduled task by its ID
 * This executes automatically without requiring human confirmation
 */
const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

const search_employee_handbook = tool({
  description: "Searches the employee handbook using semantic search to find relevant policies and rules. Use this for any policy-related questions or validations.",
  inputSchema: z.object({
    query: z.string().describe("Natural language query about company policies (e.g., 'PTO approval limits', 'expense reimbursement rules', 'blackout periods')")
  }),
  execute: async ({ query }) => {
    const { agent } = getCurrentAgent<Chat>();
    const workersai = createWorkersAI({ binding: agent!.env.AI });
    const model = workersai('@cf/meta/llama-3-8b-instruct');

    const { text } = await generateText({
      model,
      prompt: `You are an expert on the company's employee handbook. A user is asking a question about the handbook. Your task is to answer the user's question based on the content of the employee handbook provided below.

Employee Handbook:
${handbookContent}

User's Question:
${query}

Answer:`,
    });

    return text;
  }
});

const get_current_user = tool({
  description: "Retrieves the authenticated user's profile including ID, name, role, employee level, and manager.",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();
    // @ts-expect-error - user is not on the type, but we pass it in the body
    const user = agent.context?.user;

    if (!user) {
      return "Could not determine the current user. The user may not be logged in.";
    }

    const dbUser = await agent!.env.APP_DB.prepare(
      "SELECT id, username, employee_level, manager_id, hire_date, department, role FROM users WHERE id = ?"
    )
      .bind(user.id)
      .first();

    return dbUser;
  }
});

const get_pto_balance = tool({
  description: "Retrieves the employee's current PTO balance, accrued days, used days, and rollover.",
  inputSchema: z.object({
    employee_id: z.string().describe("The employee's ID (optional, defaults to current user)").optional()
  }),
  execute: async ({ employee_id }) => {
    const { agent } = getCurrentAgent<Chat>();
    let userId = employee_id;
    if (!userId) {
      // @ts-expect-error - user is not on the type, but we pass it in the body
      const user = agent.context?.user;
      if (!user) {
        return "Could not determine the current user. The user may not be logged in.";
      }
      userId = user.id;
    }

    const ptoBalance = await agent!.env.APP_DB.prepare(
      "SELECT current_balance, total_accrued, total_used, rollover_from_previous_year FROM pto_balances WHERE employee_id = ?"
    )
      .bind(userId)
      .first();

    return ptoBalance;
  }
});

const check_blackout_periods = tool({
  description: "Checks if the requested dates overlap with company blackout periods (fiscal quarter ends, holidays).",
  inputSchema: z.object({
    start_date: z.string().describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
    end_date: z.string().describe("End date in ISO 8601 format (YYYY-MM-DD)")
  }),
  execute: async ({ start_date, end_date }) => {
    const { agent } = getCurrentAgent<Chat>();
    const blackouts = await agent!.env.APP_DB.prepare(
      `SELECT * FROM company_calendar 
      WHERE event_type = 'blackout' 
      AND (
        (start_date BETWEEN ?1 AND ?2) OR 
        (end_date BETWEEN ?1 AND ?2) OR
        (?1 BETWEEN start_date AND end_date) OR
        (?2 BETWEEN start_date AND end_date)
      )`
    ).bind(start_date, end_date).all();

    return {
      has_conflict: blackouts.results.length > 0,
      conflicting_periods: blackouts.results
    };
  }
});

const get_pto_history = tool({
  description: "Retrieves past PTO requests for the employee, including approved, denied, and pending requests.",
  inputSchema: z.object({
    employee_id: z.string().optional(),
    limit: z.number().default(10),
    status_filter: z.enum(["approved", "denied", "pending", "all"]).optional()
  }),
  execute: async ({ employee_id, limit, status_filter }) => {
    const { agent } = getCurrentAgent<Chat>();
    let userId = employee_id;
    if (!userId) {
      // @ts-expect-error - user is not on the type, but we pass it in the body
      const user = agent.context?.user;
      if (!user) {
        return "Could not determine the current user. The user may not be logged in.";
      }
      userId = user.id;
    }

    let query = "SELECT * FROM pto_requests WHERE employee_id = ?";
    const params = [userId];

    if (status_filter && status_filter !== "all") {
      query += " AND status = ?";
      params.push(status_filter);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit.toString());

    const history = await agent!.env.APP_DB.prepare(query).bind(...params).all();
    return history.results;
  }
});

const calculate_business_days = tool({
  description: "Calculates the number of business days (excluding weekends and holidays) between two dates.",
  inputSchema: z.object({
    start_date: z.string(),
    end_date: z.string()
  }),
  execute: async ({ start_date, end_date }) => {
    const { agent } = getCurrentAgent<Chat>();
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    const holidays = await agent!.env.APP_DB.prepare(
      `SELECT start_date FROM company_calendar 
      WHERE event_type = 'holiday' 
      AND start_date BETWEEN ?1 AND ?2`
    ).bind(start_date, end_date).all();

    const holidaySet = new Set(holidays.results.map((h: any) => h.start_date));

    let businessDays = 0;
    let weekendDays = 0;
    const current = new Date(startDate);

    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      const dateStr = current.toISOString().split('T')[0];

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekendDays++;
      } else if (!holidaySet.has(dateStr)) {
        businessDays++;
      }

      current.setDate(current.getDate() + 1);
    }

    return { business_days: businessDays, weekend_days: weekendDays, holidays: Array.from(holidaySet) };
  }
});

const validate_pto_policy = tool({
  description: "Validates a PTO request against all company policies: balance, blackouts, auto-approval limits.",
  inputSchema: z.object({
    employee_id: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    reason: z.string().optional()
  }),
  execute: async ({ employee_id, start_date, end_date }) => {
    const { agent } = getCurrentAgent<Chat>();
    const violations = [];

    const employee = await agent!.env.APP_DB.prepare("SELECT * FROM users WHERE id = ?").bind(employee_id).first();
    const balanceResult = await get_pto_balance.execute({ employee_id });
    const balance = balanceResult as { current_balance: number };


    const businessDaysResult = await calculate_business_days.execute({ start_date, end_date });
    const businessDays = businessDaysResult as { business_days: number };

    if (balance.current_balance < businessDays.business_days) {
      violations.push({
        policy: "insufficient_balance",
        message: `Insufficient PTO. You have ${balance.current_balance} days but need ${businessDays.business_days} days.`
      });
    }

    const blackoutsResult = await check_blackout_periods.execute({ start_date, end_date });
    const blackouts = blackoutsResult as { has_conflict: boolean, conflicting_periods: any[] };
    if (blackouts.has_conflict) {
      violations.push({
        policy: "blackout_conflict",
        message: `Request overlaps with blackout period: ${blackouts.conflicting_periods[0].name}`
      });
    }

    // @ts-expect-error
    const autoApprovalLimit = employee.employee_level === 'senior' ? 10 : 3;
    const canAutoApprove = businessDays.business_days <= autoApprovalLimit && violations.length === 0;
    const requiresEscalation = businessDays.business_days > autoApprovalLimit && violations.length === 0;

    return {
      is_valid: violations.length === 0,
      can_auto_approve: canAutoApprove,
      requires_escalation: requiresEscalation,
      violations,
      recommendation: canAutoApprove
        ? "AUTO_APPROVE"
        : requiresEscalation
          ? "ESCALATE_TO_MANAGER"
          : "DENY"
    };
  }
});

const submit_pto_request = tool({
  description: "Submits a PTO request to the database after validation. Sets status based on auto-approval or escalation.",
  inputSchema: z.object({
    employee_id: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    total_days: z.number(),
    reason: z.string().optional(),
    status: z.enum(["auto_approved", "pending", "denied"]),
    approval_type: z.enum(["auto", "manual"]),
    validation_notes: z.string().optional()
  }),
  execute: async (params) => {
    const { agent } = getCurrentAgent<Chat>();
    const requestId = crypto.randomUUID();

    const employee = await agent!.env.APP_DB.prepare("SELECT manager_id FROM users WHERE id = ?").bind(params.employee_id).first();

    await agent!.env.APP_DB.prepare(
      `INSERT INTO pto_requests (
        id, employee_id, manager_id, start_date, end_date,
        total_days, reason, status, approval_type, ai_validation_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      requestId,
      params.employee_id,
      // @ts-expect-error
      employee.manager_id,
      params.start_date,
      params.end_date,
      params.total_days,
      params.reason || '',
      params.status,
      params.approval_type,
      params.validation_notes || ''
    ).run();

    if (params.status === 'auto_approved') {
      await agent!.env.APP_DB.prepare(
        "UPDATE pto_balances SET total_used = total_used + ?, current_balance = current_balance - ? WHERE employee_id = ?"
      ).bind(params.total_days, params.total_days, params.employee_id).run();
    }

    return {
      request_id: requestId,
      status: params.status,
      message: "Request submitted successfully"
    };
  }
});

const log_audit_event = tool({
  description: "Logs an action to the audit trail for compliance and tracking.",
  inputSchema: z.object({
    entity_type: z.string(),
    entity_id: z.string(),
    action: z.string(),
    details: z.record(z.any()).optional()
  }),
  execute: async ({ entity_type, entity_id, action, details }) => {
    const { agent } = getCurrentAgent<Chat>();
    // @ts-expect-error
    const user = agent.context?.user;
    const actor_id = user?.id || null;
    const actor_type = user ? 'user' : 'ai_agent';

    await agent!.env.APP_DB.prepare(
      `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, actor_type, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      entity_type,
      entity_id,
      action,
      actor_id,
      actor_type,
      details ? JSON.stringify(details) : null
    ).run();

    return { success: true };
  }
});


/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask,
  search_employee_handbook,
  get_current_user,
  get_pto_balance,
  check_blackout_periods,
  get_pto_history,
  calculate_business_days,
  validate_pto_policy,
  submit_pto_request,
  log_audit_event,
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {};
