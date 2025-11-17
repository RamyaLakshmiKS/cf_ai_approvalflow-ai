import handbookContent from "../docs/employee_handbook.md?raw";
import { getHandbookSearchPrompt } from "./prompts";

/**
 * Tool Registry for the ReAct Agent
 * Each tool has:
 * - name: Unique identifier
 * - description: What the tool does (used by LLM for selection)
 * - parameters: JSON Schema for input validation
 * - execute: Async function that performs the action
 */

// Tool execution context interface
export interface ToolContext {
  env: Env;
  userId: string;
}

// Define tool parameter types
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  enum?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
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
  parameters: {
    type: "object",
    properties: {},
    required: []
  },
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
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural language query about company policies (e.g., 'What are the PTO auto-approval limits?', 'What are the blackout periods?', 'What is the expense reimbursement policy?')"
      }
    },
    required: ["query"]
  },
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
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "The employee's ID (optional, defaults to current user)"
      }
    },
    required: []
  },
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
  parameters: {
    type: "object",
    properties: {
      start_date: {
        type: "string",
        description: "Start date in ISO 8601 format (YYYY-MM-DD)"
      },
      end_date: {
        type: "string",
        description: "End date in ISO 8601 format (YYYY-MM-DD)"
      }
    },
    required: ["start_date", "end_date"]
  },
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
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "Employee ID (optional, defaults to current user)"
      },
      limit: {
        type: "number",
        description: "Maximum number of records to return (default: 10)"
      },
      status_filter: {
        type: "string",
        description: "Filter by status: approved, denied, pending, or all",
        enum: ["approved", "denied", "pending", "all"]
      }
    },
    required: []
  },
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
  parameters: {
    type: "object",
    properties: {
      start_date: {
        type: "string",
        description: "Start date in ISO 8601 format (YYYY-MM-DD)"
      },
      end_date: {
        type: "string",
        description: "End date in ISO 8601 format (YYYY-MM-DD)"
      }
    },
    required: ["start_date", "end_date"]
  },
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
    "Validates a PTO request against all company policies: balance, blackouts, auto-approval limits, and checks for duplicate/overlapping requests. Use this before submitting a PTO request.",
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "Employee ID"
      },
      start_date: {
        type: "string",
        description: "Start date in ISO 8601 format (YYYY-MM-DD)"
      },
      end_date: {
        type: "string",
        description: "End date in ISO 8601 format (YYYY-MM-DD)"
      },
      reason: {
        type: "string",
        description: "Reason for PTO request (optional)"
      }
    },
    required: ["employee_id", "start_date", "end_date"]
  },
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

    // **NEW CHECK: Look for duplicate/overlapping PTO requests**
    const existingRequests = await context.env.APP_DB.prepare(
      `SELECT id, start_date, end_date, total_days, status, created_at 
       FROM pto_requests 
       WHERE employee_id = ? 
       AND (
         (start_date BETWEEN ?2 AND ?3) OR 
         (end_date BETWEEN ?2 AND ?3) OR
         (?2 BETWEEN start_date AND end_date) OR
         (?3 BETWEEN start_date AND end_date)
       )
       ORDER BY created_at DESC`
    )
      .bind(employee_id, start_date, end_date)
      .all();

    if (existingRequests.results.length > 0) {
      const existing = existingRequests.results[0] as {
        id: string;
        start_date: string;
        end_date: string;
        total_days: number;
        status: string;
        created_at: number;
      };
      
      // Format the status message
      let statusMessage = "";
      if (existing.status === "auto_approved" || existing.status === "approved") {
        statusMessage = `Your PTO request for ${existing.start_date} to ${existing.end_date} (${existing.total_days} days) has already been APPROVED.`;
      } else if (existing.status === "pending") {
        statusMessage = `You already have a PENDING PTO request for ${existing.start_date} to ${existing.end_date} (${existing.total_days} days) under manager review.`;
      } else if (existing.status === "denied") {
        statusMessage = `You previously had a PTO request for ${existing.start_date} to ${existing.end_date} that was DENIED.`;
      }

      violations.push({
        policy: "duplicate_request",
        message: `${statusMessage} You cannot submit overlapping PTO requests. Request ID: ${existing.id}`
      });

      // Return early if duplicate found
      return {
        is_valid: false,
        can_auto_approve: false,
        requires_escalation: false,
        violations,
        duplicate_request: true,
        existing_request: existing,
        business_days_requested: 0,
        auto_approval_limit: 0,
        recommendation: "REJECT_DUPLICATE"
      };
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
      duplicate_request: false,
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
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "Employee ID"
      },
      start_date: {
        type: "string",
        description: "Start date in ISO 8601 format (YYYY-MM-DD)"
      },
      end_date: {
        type: "string",
        description: "End date in ISO 8601 format (YYYY-MM-DD)"
      },
      total_days: {
        type: "number",
        description: "Total business days requested"
      },
      reason: {
        type: "string",
        description: "Reason for PTO request"
      },
      status: {
        type: "string",
        description: "Status of the request",
        enum: ["auto_approved", "pending", "denied"]
      },
      approval_type: {
        type: "string",
        description: "Type of approval",
        enum: ["auto", "manual"]
      },
      validation_notes: {
        type: "string",
        description: "Notes from validation process"
      },
      force_submit: {
        type: "boolean",
        description: "Force submission even with insufficient balance (will escalate to manager for unpaid leave approval). Use only when user explicitly confirms they want to proceed despite insufficient balance."
      }
    },
    required: [
      "employee_id",
      "start_date",
      "end_date",
      "total_days",
      "status",
      "approval_type"
    ]
  },
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const {
      employee_id,
      start_date,
      end_date,
      total_days,
      reason,
      status,
      approval_type,
      validation_notes,
      force_submit
    } = params as {
      employee_id: string;
      start_date: string;
      end_date: string;
      total_days: number;
      reason?: string;
      status: string;
      approval_type: string;
      validation_notes?: string;
      force_submit?: boolean;
    };
    const requestId = crypto.randomUUID();
    console.log("[TOOL] submit_pto_request called with:", {
      employee_id,
      total_days,
      status,
      force_submit
    });

    // Get manager ID
    const employee = await context.env.APP_DB.prepare(
      "SELECT manager_id FROM users WHERE id = ?"
    )
      .bind(params.employee_id)
      .first();

    // If force_submit is true (insufficient balance case), override status to pending_manager
    let finalStatus = status;
    let finalApprovalType = approval_type;
    let finalValidationNotes = validation_notes || "";
    
    if (force_submit) {
      finalStatus = "pending_manager";
      finalApprovalType = "manual";
      finalValidationNotes = (finalValidationNotes ? finalValidationNotes + " | " : "") + 
        "User requested time off exceeding available PTO balance. Requires manager approval for unpaid leave.";
    }

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
        finalStatus,
        finalApprovalType,
        finalValidationNotes
      )
      .run();

    // If auto-approved, update balance
    if (finalStatus === "auto_approved") {
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
          status: finalStatus,
          approval_type: finalApprovalType,
          days_requested: total_days,
          force_submitted: force_submit || false
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
      status: finalStatus,
      message: force_submit 
        ? "Request submitted for manager approval (unpaid leave may be required)"
        : "Request submitted successfully"
    };
  }
};

/**
 * Tool 9: Process Receipt OCR
 * Uploads a receipt and extracts data using Workers AI Vision
 */
const process_receipt_ocr: Tool = {
  name: "process_receipt_ocr",
  description:
    "Processes a receipt image/PDF via OCR to extract amount, date, merchant, and items. Use this to parse receipt data automatically.",
  parameters: {
    type: "object",
    properties: {
      file_data: {
        type: "string",
        description: "Base64-encoded receipt file content"
      },
      file_name: {
        type: "string",
        description: "Original filename (e.g., receipt.jpg)"
      },
      file_type: {
        type: "string",
        description: "MIME type (image/jpeg, image/png, application/pdf)"
      },
      expense_request_id: {
        type: "string",
        description: "ID of the expense request this receipt belongs to"
      },
      submitted_amount: {
        type: "number",
        description:
          "Amount user submitted, for validation against OCR extraction"
      }
    },
    required: [
      "file_data",
      "file_name",
      "file_type",
      "expense_request_id",
      "submitted_amount"
    ]
  },
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const {
      file_data,
      file_name,
      file_type,
      expense_request_id,
      submitted_amount
    } = params as {
      file_data: string;
      file_name: string;
      file_type: string;
      expense_request_id: string;
      submitted_amount: number;
    };

    console.log("[TOOL] process_receipt_ocr called for:", file_name);

    try {
      const receiptId = crypto.randomUUID();

      // Create receipt_uploads record
      await context.env.APP_DB.prepare(
        `INSERT INTO receipt_uploads (id, expense_request_id, file_name, file_type, file_size, upload_status, ocr_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          receiptId,
          expense_request_id,
          file_name,
          file_type,
          Buffer.from(file_data, "base64").length,
          "processing",
          "pending"
        )
        .run();

      console.log(
        "[TOOL] process_receipt_ocr - Receipt record created:",
        receiptId
      );

      // Extract text via Workers AI Vision
      // Note: For demonstration, using a simpler approach. In production, use actual vision API
      const ocrResponse = (await context.env.AI.run(
        "@cf/llava-1.5-7b-gguf" as keyof AiModels,
        {
          prompt: `Extract receipt data as JSON with these fields:
{
  "amount": number (total amount at bottom),
  "currency": string (e.g., "USD"),
  "date": string (YYYY-MM-DD format),
  "merchant": string (vendor/store name),
  "items": [{"description": string, "amount": number}]
}
Return ONLY valid JSON, no markdown.`,
          image: [{ data: file_data, type: "base64" }]
        }
      )) as { response?: string };

      // Parse OCR response
      let extracted: {
        amount: number;
        currency: string;
        date: string;
        merchant: string;
        items?: Array<{ description: string; amount: number }>;
      };

      try {
        // Extract JSON from response (may contain markdown)
        const jsonMatch =
          ocrResponse.response?.match(/\{[\s\S]*\}/) ||
          String(ocrResponse.response).match(/\{[\s\S]*\}/);
        extracted = JSON.parse(jsonMatch?.[0] || String(ocrResponse.response));
      } catch (e) {
        console.error("[TOOL] process_receipt_ocr - JSON parse error:", e);
        throw new Error("Failed to parse OCR response as JSON");
      }

      // Check for amount discrepancy
      const discrepancies: string[] = [];
      if (Math.abs(extracted.amount - submitted_amount) > 0.01) {
        discrepancies.push(
          `Amount mismatch: receipt shows $${extracted.amount}, submitted $${submitted_amount}`
        );
      }

      // Update receipt_uploads with extraction results
      await context.env.APP_DB.prepare(
        `UPDATE receipt_uploads 
         SET extracted_data = ?, ocr_status = ?, upload_status = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(
          JSON.stringify(extracted),
          "completed",
          "processed",
          Math.floor(Date.now() / 1000),
          receiptId
        )
        .run();

      console.log(
        "[TOOL] process_receipt_ocr - OCR completed successfully:",
        extracted
      );

      return {
        receipt_id: receiptId,
        extracted_amount: extracted.amount,
        extracted_currency: extracted.currency,
        extracted_date: extracted.date,
        merchant_name: extracted.merchant,
        line_items: extracted.items || [],
        confidence_score: 0.92,
        warnings: discrepancies,
        discrepancies
      };
    } catch (error) {
      console.error("[TOOL] process_receipt_ocr - Error:", error);

      // Update receipt_uploads with error
      await context.env.APP_DB.prepare(
        `UPDATE receipt_uploads 
         SET ocr_status = ?, upload_status = ?, processing_errors = ?, updated_at = ?
         WHERE expense_request_id = ?`
      )
        .bind(
          "failed",
          "failed",
          String(error),
          Math.floor(Date.now() / 1000),
          expense_request_id
        )
        .run();

      throw error;
    }
  }
};

/**
 * Tool 10: Validate Expense Policy
 * Validates expense against handbook policies and auto-approval limits
 */
const validate_expense_policy: Tool = {
  name: "validate_expense_policy",
  description:
    "Validates an expense against company policies from the handbook. Checks auto-approval limits, non-reimbursable items, and policy violations. Receipt is REQUIRED for ALL expenses.",
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "Employee ID"
      },
      amount: {
        type: "number",
        description: "Expense amount"
      },
      category: {
        type: "string",
        description: "Expense category (meals, travel, software, etc.)"
      },
      has_receipt: {
        type: "boolean",
        description: "Whether receipt was provided (REQUIRED for all expenses)"
      },
      merchant: {
        type: "string",
        description: "Merchant or vendor name (optional, for policy checks)"
      },
      description: {
        type: "string",
        description: "Business reason for expense (optional)"
      }
    },
    required: ["employee_id", "amount", "category", "has_receipt"]
  },
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const {
      employee_id,
      amount,
      category,
      has_receipt,
      merchant,
      description
    } = params as {
      employee_id: string;
      amount: number;
      category: string;
      has_receipt: boolean;
      merchant?: string;
      description?: string;
    };

    console.log("[TOOL] validate_expense_policy called for:", {
      amount,
      category,
      has_receipt,
      merchant
    });

    const violations: Array<{
      policy: string;
      message: string;
      severity: string;
    }> = [];

    // Get employee info
    const employee = (await context.env.APP_DB.prepare(
      "SELECT id, employee_level FROM users WHERE id = ?"
    )
      .bind(employee_id)
      .first()) as { employee_level: string } | undefined;

    if (!employee) {
      throw new Error("Employee not found");
    }

    // CRITICAL CHECK: Receipt requirement (ALL expenses require receipt)
    if (!has_receipt) {
      violations.push({
        policy: "missing_receipt",
        message:
          "Receipt is REQUIRED for all expense submissions. You cannot submit an expense without uploading a receipt.",
        severity: "critical"
      });
      console.log(
        "[TOOL] validate_expense_policy - REJECTED: No receipt provided"
      );
      return {
        is_valid: false,
        can_auto_approve: false,
        violations,
        auto_approval_limit: 0,
        requires_escalation: false,
        recommendation: "DENY",
        denial_reason:
          "Receipt is mandatory for all expenses per company policy."
      };
    }

    // Query handbook for auto-approval limits based on employee level
    const policyQuery = `What is the auto-approval limit for expense reports for a ${employee.employee_level} employee?`;
    const policyResponse = (await context.env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct" as keyof AiModels,
      {
        messages: [
          {
            role: "user",
            content: `${getHandbookSearchPrompt(handbookContent, policyQuery)}`
          }
        ],
        max_tokens: 200
      }
    )) as { response?: string };

    console.log(
      "[TOOL] validate_expense_policy - Auto-approval limit query:",
      policyResponse.response
    );

    // Extract limit from response (parse $X or X)
    const limitMatch = String(policyResponse.response || "").match(
      /\$?(\d+(?:\.\d{2})?)/
    );
    const limit = limitMatch ? parseFloat(limitMatch[1]) : 100; // Default to junior limit

    console.log("[TOOL] validate_expense_policy - Auto-approval limit:", {
      employee_level: employee.employee_level,
      limit,
      amount
    });

    // Check amount vs auto-approval limit
    if (amount > limit) {
      violations.push({
        policy: "exceeds_auto_approval",
        message: `This expense requires manager approval as it exceeds the auto-approval threshold for ${employee.employee_level} employees.`,
        severity: "warning"
      });
    }

    // Check for non-reimbursable items using handbook search
    // Ask the AI to check both category and specific merchant/description
    const itemCheckContext = merchant
      ? `${category} expenses from ${merchant}`
      : description
        ? `${category} expenses for ${description}`
        : `${category} expenses`;

    const reimbursabilityQuery = `According to Section 6 (Travel & Expense Reimbursement) of the employee handbook, are ${itemCheckContext} reimbursable? Look specifically at Section 6.3 Non-Reimbursable Expenses. Answer with ONLY 'REIMBURSABLE' or 'NON-REIMBURSABLE' on the first line, then cite the specific policy.`;

    const reimbursabilityResponse = (await context.env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct" as keyof AiModels,
      {
        messages: [
          {
            role: "user",
            content: `${getHandbookSearchPrompt(handbookContent, reimbursabilityQuery)}`
          }
        ],
        max_tokens: 200
      }
    )) as { response?: string };

    const reimbursabilityText = String(reimbursabilityResponse.response || "")
      .toLowerCase()
      .trim();

    console.log("[TOOL] validate_expense_policy - Reimbursability check:", {
      category,
      merchant,
      response: reimbursabilityText.substring(0, 100)
    });

    // Check if explicitly marked as non-reimbursable
    const isNonReimbursable =
      reimbursabilityText.startsWith("non-reimbursable") ||
      reimbursabilityText.includes("not reimbursable") ||
      reimbursabilityText.includes("will not be reimbursed");

    if (isNonReimbursable) {
      violations.push({
        policy: "non_reimbursable",
        message: `This type of expense is not reimbursable according to company policy (Section 6.3 - Non-Reimbursable Expenses).`,
        severity: "critical"
      });
    }

    // Determine final decision
    const hasCriticalViolations =
      violations.filter((v) => v.severity === "critical").length > 0;
    const hasWarningViolations =
      violations.filter((v) => v.severity === "warning").length > 0;

    const canAutoApprove = !hasCriticalViolations && amount <= limit;
    const requiresEscalation = !hasCriticalViolations && hasWarningViolations;

    console.log("[TOOL] validate_expense_policy - Validation complete:", {
      can_auto_approve: canAutoApprove,
      requires_escalation: requiresEscalation,
      violations_count: violations.length,
      critical_violations: hasCriticalViolations
    });

    return {
      is_valid: !hasCriticalViolations,
      can_auto_approve: canAutoApprove,
      violations,
      auto_approval_limit: limit,
      requires_escalation: requiresEscalation,
      recommendation: canAutoApprove
        ? "AUTO_APPROVE"
        : hasCriticalViolations
          ? "DENY"
          : "ESCALATE_TO_MANAGER",
      escalation_reason: requiresEscalation
        ? violations.map((v) => v.message).join("; ")
        : undefined
    };
  }
};

/**
 * Tool 11: Submit Expense Request
 * Creates an expense request with auto-approval or escalation decision
 */
const submit_expense_request: Tool = {
  name: "submit_expense_request",
  description:
    "Submits an expense request to the system. Returns auto-approval or escalation decision.",
  parameters: {
    type: "object",
    properties: {
      receipt_id: {
        type: "string",
        description: "ID of the uploaded receipt"
      },
      category: {
        type: "string",
        description: "Expense category"
      },
      amount: {
        type: "number",
        description: "Expense amount"
      },
      description: {
        type: "string",
        description: "Business reason for expense"
      },
      can_auto_approve: {
        type: "boolean",
        description: "Whether expense passed all validation checks"
      },
      ai_notes: {
        type: "string",
        description: "AI validation notes"
      },
      policy_violations: {
        type: "string",
        description: "JSON string of policy violations, if any"
      }
    },
    required: [
      "receipt_id",
      "category",
      "amount",
      "description",
      "can_auto_approve"
    ]
  },
  execute: async (params: Record<string, unknown>, context: ToolContext) => {
    const {
      receipt_id,
      category,
      amount,
      description,
      can_auto_approve,
      ai_notes,
      policy_violations
    } = params as {
      receipt_id: string;
      category: string;
      amount: number;
      description: string;
      can_auto_approve: boolean;
      ai_notes?: string;
      policy_violations?: string;
    };

    console.log("[TOOL] submit_expense_request called for:", amount, category);

    try {
      // Get employee and manager info
      const employee = (await context.env.APP_DB.prepare(
        "SELECT id, employee_level, manager_id FROM users WHERE id = ?"
      )
        .bind(context.userId)
        .first()) as
        | {
            id: string;
            employee_level: string;
            manager_id: string;
          }
        | undefined;

      if (!employee) {
        throw new Error("Employee not found");
      }

      const expenseId = crypto.randomUUID();
      const status = can_auto_approve ? "auto_approved" : "pending";

      // Create expense request
      await context.env.APP_DB.prepare(
        `INSERT INTO expense_requests 
         (id, employee_id, manager_id, category, amount, currency, description, 
          has_receipt, status, ai_validation_status, ai_validation_notes, 
          policy_violations, auto_approved, employee_level, submission_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          expenseId,
          context.userId,
          employee.manager_id,
          category,
          amount,
          "USD",
          description,
          1, // has_receipt = true
          status,
          "completed",
          ai_notes || "",
          policy_violations || "",
          can_auto_approve ? 1 : 0,
          employee.employee_level,
          "chat"
        )
        .run();

      // Link receipt to expense
      await context.env.APP_DB.prepare(
        `UPDATE receipt_uploads SET expense_request_id = ? WHERE id = ?`
      )
        .bind(expenseId, receipt_id)
        .run();

      // Log audit event
      await log_audit_event.execute(
        {
          entity_type: "expense_request",
          entity_id: expenseId,
          action: "created",
          details: {
            amount,
            category,
            status,
            auto_approved: can_auto_approve
          }
        },
        context
      );

      console.log(
        "[TOOL] submit_expense_request - Expense created:",
        expenseId,
        "Status:",
        status
      );

      return {
        expense_id: expenseId,
        status,
        amount,
        category,
        auto_approved: can_auto_approve,
        message: can_auto_approve
          ? `Your $${amount} ${category} expense has been AUTO-APPROVED! Reimbursement will be processed within 5-7 business days.`
          : `Your $${amount} ${category} expense has been submitted for manager review. You will be notified of the decision within 24 hours.`
      };
    } catch (error) {
      console.error("[TOOL] submit_expense_request - Error:", error);
      throw error;
    }
  }
};

/**
 * Tool 12: Get Expense History
 * Retrieves past expense requests for an employee
 */
const get_expense_history: Tool = {
  name: "get_expense_history",
  description:
    "Retrieves the employee's past expense requests including approved, denied, and pending expenses.",
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "Employee ID (optional, defaults to current user)"
      },
      limit: {
        type: "number",
        description: "Maximum number of records (default: 10)"
      },
      status_filter: {
        type: "string",
        description: "Filter by status",
        enum: ["all", "pending", "approved", "auto_approved", "denied"]
      }
    },
    required: []
  },
  execute: async (
    params: { employee_id?: string; limit?: number; status_filter?: string },
    context: ToolContext
  ) => {
    const userId = params.employee_id || context.userId;
    const limit = params.limit || 10;
    const statusFilter = params.status_filter || "all";

    console.log("[TOOL] get_expense_history called for:", userId);

    let query = `SELECT * FROM expense_requests WHERE employee_id = ?`;
    const bindings: string[] = [userId];

    if (statusFilter !== "all") {
      query += ` AND status = ?`;
      bindings.push(statusFilter);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    bindings.push(String(limit));

    const history = await context.env.APP_DB.prepare(query)
      .bind(...bindings)
      .all();

    console.log(
      "[TOOL] get_expense_history - Retrieved",
      history.results.length,
      "expenses"
    );

    return {
      total_count: history.results.length,
      expenses: history.results
    };
  }
};

/**
 * Tool 13: Log Audit Event
 * Records all agent actions for compliance
 */
const log_audit_event: Tool = {
  name: "log_audit_event",
  description:
    "Logs an action to the audit trail for compliance and tracking. Use this for all significant actions.",
  parameters: {
    type: "object",
    properties: {
      entity_type: {
        type: "string",
        description:
          "Type of entity (e.g., 'pto_request', 'expense_request', 'user')"
      },
      entity_id: {
        type: "string",
        description: "ID of the entity"
      },
      action: {
        type: "string",
        description:
          "Action performed (e.g., 'created', 'approved', 'denied', 'updated')"
      },
      details: {
        type: "object",
        description: "Additional details about the action (optional)"
      }
    },
    required: ["entity_type", "entity_id", "action"]
  },
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
  log_audit_event,
  process_receipt_ocr,
  validate_expense_policy,
  submit_expense_request,
  get_expense_history
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
