# Expense Reimbursement Feature Implementation Plan

**Last Updated:** November 2025
**Status:** Design & Planning
**Owner:** Engineering Team
**Related:** PTO Feature, ApprovalFlow AI MVP

**⚠️ MIGRATION STRATEGY:** This implementation uses a **drop and recreate** approach for the `expense_requests` table. All existing data will be lost. The schema has been **simplified for demo purposes**, removing unnecessary fields while keeping core functionality intact.

---

## Executive Summary

This document outlines the complete implementation plan for the **Expense Reimbursement** feature in ApprovalFlow AI. The feature is **receipt-first**: employees upload receipts first, the AI agent extracts and parses receipt data (amount, date, merchant, items), verifies the details with the employee, then submits for validation against company policy with auto-approval or escalation.

**Key Components:**

- **Receipt-first workflow**: Upload receipt → AI parses → User confirms → Validation
- Database schema for receipt storage and extraction results
- AI-powered OCR for receipt data extraction
- Policy validation against employee handbook
- Enhanced UI with file upload as primary input
- New agent tools for receipt processing and expense management
- Workflow automation with escalation logic

---

## 1. Database Schema Changes

### 1.1 New Tables & Modifications

#### A. Receipt Storage Table (`receipt_uploads`)

**Purpose:** Store receipt metadata and OCR extraction results

```sql
-- migrations/0009_create_receipt_uploads_table.sql
CREATE TABLE receipt_uploads (
  id TEXT PRIMARY KEY,
  expense_request_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL, -- e.g., 'image/jpeg', 'application/pdf'
  file_size INTEGER NOT NULL, -- bytes
  file_data BLOB, -- Store file as base64 or binary for MVP (no R2)
  upload_date INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  ocr_status TEXT DEFAULT NULL, -- 'pending', 'completed', 'failed'
  extracted_data JSONB, -- Extracted data from OCR: {amount, currency, date, merchant}
  processing_errors TEXT, -- Error messages if extraction failed
  created_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (expense_request_id) REFERENCES expense_requests(id) ON DELETE CASCADE
);
```

**Table Definition:**

```sql
-- migrations/0004_create_expense_requests_table.sql (Simplified for Demo)
CREATE TABLE expense_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  manager_id TEXT,
  category TEXT NOT NULL, -- 'travel', 'meals', 'home_office', 'training', 'software', 'supplies'
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'denied', 'auto_approved'

  -- AI validation & escalation
  ai_validation_status TEXT DEFAULT 'not_validated', -- 'not_validated', 'validated', 'failed'
  auto_approved INTEGER DEFAULT 0, -- Boolean: 1 if auto-approved
  escalation_reason TEXT, -- Why escalated or denied

  -- Audit trail
  employee_level TEXT, -- Snapshot of employee level at submission time
  submission_method TEXT DEFAULT 'chat_ai', -- 'manual', 'chat_ai', 'api'

  created_at INTEGER DEFAULT (strftime('%s','now')),
  approved_at INTEGER,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_id) REFERENCES users(id)
);

CREATE INDEX idx_expense_status_employee ON expense_requests(status, employee_id, created_at DESC);
```

**Why This Is Sufficient for Demo:**

- ✅ Tracks all essential expense data (amount, category, description)
- ✅ Supports auto-approval logic (employee_level, amount, status)
- ✅ Handles manager escalation (escalation_reason, manager_id)
- ✅ Receipt tracking via separate receipt_uploads table
- ✅ Audit trail (created_at, approved_at, employee_level, submission_method)
- ✅ Simple and easy to understand

#### C. Expense Category & Policy Table

## Policies are read directly from the employee handbook using the AI search tool.

## 2. Ideal Workflow for Expense Reimbursement

### 2.1 Complete User Journey (Sequence Diagram)

```
Employee Input → Agent Requests Receipt → User Uploads Receipt → AI Parses Receipt →
Agent Shows Details & Asks Confirmation → User Confirms → AI Validates Policy →
Auto-Approve/Escalate → Manager/Notification
```

**Key Difference from PTO:** Receipt is the INPUT, not the optional attachment. The workflow is:

1. **Receipt First** - Upload before any validation
2. **Parse & Verify** - AI extracts data and asks user to confirm
3. **Policy Check** - After user confirms, check against policies
4. **Decision** - Auto-approve or escalate

### 2.2 Step-by-Step Workflow

#### Phase 1: Receipt Capture & Parsing (Receipt-First Approach)

1. **Employee Initiates Request**
   - User sends chat message: _"I need to be reimbursed for a meal"_ or _"I have an expense to submit"_
   - Agent **immediately asks for receipt**: "Let's start by uploading your receipt. Please attach the receipt image or PDF."
   - Agent does NOT ask for amount, date, or description yet - receipt is the source of truth

2. **Receipt Upload**
   - User uploads receipt image/PDF (mandatory)
   - File size validation (<5MB for MVP)
   - File type validation (jpg, png, pdf)
   - File required - cannot proceed without receipt
   - Create `receipt_uploads` record in database

3. **OCR Extraction (Automatic)**
   - Tool: `process_receipt_ocr()` extracts data automatically
   - Workers AI Vision extracts:
     - **Total amount** (primary amount at bottom)
     - **Currency** (USD, EUR, etc.)
     - **Date** (transaction date from receipt)
     - **Merchant name** (vendor/store name)
     - **Line items** (itemized list if available)
   - Store extracted data in `receipt_uploads.extracted_data`
   - If OCR fails → Show error, ask user to resubmit receipt (may be blurry/damaged)

4. **Agent Verification & Confirmation**
   - Agent displays extracted data to user in formatted message:

     ```
     ✓ Receipt parsed successfully!

     **Merchant:** Michelin Restaurant
     **Date:** November 15, 2025
     **Items:**
       - Dinner meal: $120.00
       - Tax: $18.00
       - Tip: $12.00
     **Total:** $150.00
     **Currency:** USD

     Is this information correct? (yes/no)
     ```

   - User confirms: "yes" → proceed to Phase 2
   - User says "no" → Ask which field is wrong, allow user to correct specific fields
   - User can manually override extracted values if OCR misread

#### Phase 2: Category & Description (After Receipt Confirmed)

5. **Collect Remaining Details** (now that receipt is verified)
   - Agent asks: "What category best describes this expense?"
   - Options: Meals, Travel, Training, Software, Supplies, Home Office
   - Agent asks: "Can you provide a brief description or reason for this expense?"
   - User input: "Client lunch with Product team"
   - Agent confirms: "Perfect! Let me validate this against company policy..."

#### Phase 3: Policy Validation

6. **Get Employee Info**
   - Tool: `get_current_user()` → fetch employee level (junior/senior)
   - Load employee's expense history
   - Get manager info for escalations

7. **Policy Lookup from Handbook**
   - Query employee handbook via `search_employee_handbook` tool
   - Ask: "What is the auto-approval limit for expenses for a [junior/senior] employee?"
   - Ask: "What are the non-reimbursable expenses?"

8. **Validate Against Policy**
   - Tool: `validate_expense_policy()` with:
     - Extracted amount vs. auto-approval limit
     - Receipt verification (now guaranteed present)
     - Category validity
     - Non-reimbursable item check
   - Returns: `is_valid`, `can_auto_approve`, `violations[]`

#### Phase 4: Decision & Action

9. **Auto-Approval Decision**

   ```
   IF (receipt_valid) AND
      (amount ≤ limit) AND
      (no violations) THEN
     → AUTO_APPROVE
   ELSE IF (violations exist) THEN
     → ESCALATE_TO_MANAGER
   ELSE IF (amount exceeds limit) THEN
     → ESCALATE_TO_MANAGER
   ELSE
     → DENY with reason
   ```

10. **Create Expense Request**
    - Tool: `submit_expense_request()` with status
    - Store in `expense_requests` table
    - Link receipt via `expense_request_id`
    - Log AI validation notes

11. **Update Balance & Audit**
    - If auto-approved: Update reimbursement tracking
    - Tool: `log_audit_event()` for compliance

#### Phase 5: Manager Review (If Escalated)

12. **Manager Notification** (if escalated)
    - Notify manager of escalated expense
    - Include: Employee info, extracted receipt data, category, policy violation reasons

13. **Manager Review Flow**
    - Manager views: Receipt image, extracted data, AI validation notes, policy rules
    - Option to approve/deny with reason

14. **Employee Notification**
    - On approval: _"Your $150 meal expense has been approved!"_
    - On denial: _"Your expense was denied: reason_"\_

### 2.3 Decision Tree

```
┌────────────────────────────────────────────┐
│   Employee Initiates Expense Request       │
│   "I need reimbursement for a meal"        │
└──────────────────┬─────────────────────────┘
                   │
        ┌──────────▼──────────────┐
        │ Agent Requests Receipt  │
        │ Upload image or PDF     │
        └──────────────┬──────────┘
                       │
        ┌──────────────▼──────────────┐
        │ User Uploads Receipt        │
        │ File validation (<5MB)      │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ OCR Extract Receipt Data    │
        │ (Amount, Date, Merchant)   │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ Agent Shows Extracted Data  │
        │ "Is this correct?"          │
        └──────┬──────────────┬───────┘
               │              │
            NO │              │ YES
               │              │
     ┌─────────▼──┐    ┌──────▼─────────────┐
     │User Corrects   │Ask Category &       │
     │Fields          │Description          │
     └─────────┬──┘    └──────┬─────────────┘
               │              │
               └──────┬───────┘
                      │
         ┌────────────▼─────────────┐
         │Query Handbook Policies   │
         │(Auto-approve limit, etc) │
         └────────────┬─────────────┘
                      │
         ┌────────────▼─────────────┐
         │Validate vs. Policies     │
         │Check: Amount, Limits,    │
         │Violations                │
         └──────┬──────────┬────────┘
                │          │
             OK │          │ VIOLATIONS FOUND
                │          │
          ┌─────▼──┐  ┌────▼──────────────┐
          │✅      │  │⏱ ESCALATE         │
          │AUTO-   │  │TO_MANAGER         │
          │APPROVE │  └────┬──────────────┘
          └─────┬──┘       │
                │          │
          ┌─────▼──────────▼──────────┐
          │Update Balance & Log Audit │
          │(if auto-approved)         │
          └─────┬──────────┬──────────┘
                │          │
           ┌────▼──────────▼──┐
           │Notify Employee   │
           │                  │
           │ Approved: ✅     │
           │ Escalated: ⏱     │
           └──────────────────┘
```

        │  │ │  │   OK │          VIOLATION
        │  │ │  │      │              │
        │  │ESCALATE   │          ESCALATE
        │  │           │              │
        │  └───┬───────┘              │
        │      │                      │
        │  AUTO-APPROVE               │
        │      │                      │
        ▼      ▼                      ▼
      DENY  APPROVED              MANAGER REVIEW
                                      │
                              ┌───────┴────────┐
                              │                │
                          APPROVE          DENY

````

---

## 3. Receipt Processing Tool Architecture

### 3.1 Receipt Processing Service

**File:** `src/tools/receipt-processor.ts`

This service handles end-to-end receipt processing:

```typescript
interface ReceiptProcessingResult {
  receipt_id: string;
  extracted_amount: number;
  extracted_currency: string;
  extracted_date: string;
  merchant_name: string;
  line_items: Array<{
    description: string;
    amount: number;
  }>;
  confidence_score: number; // 0-1
  warnings: string[];
}

interface ReceiptUploadRequest {
  file: File; // From FormData
  expense_request_id: string;
  submitted_amount: number;
  submitted_category: string;
}
````

#### Tool: `process_receipt_image`

**Description:** Processes a receipt image/PDF via OCR extraction and validates against the submitted expense.

**Parameters:**

- `file_data`: Base64-encoded file content
- `file_name`: Original filename
- `file_type`: MIME type
- `expense_request_id`: Link to expense
- `submitted_amount`: Expected amount from form

**Execution Steps:**

1. **Create Receipt Record**

   ```typescript
   const receiptId = crypto.randomUUID();
   await env.APP_DB.prepare(
     `INSERT INTO receipt_uploads (
        id, expense_request_id, file_name, file_type, file_size,
        upload_status, ocr_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
   )
     .bind(
       receiptId,
       expenseId,
       filename,
       fileType,
       fileSize,
       "processing",
       "pending"
     )
     .run();
   ```

2. **Extract Text via Workers AI Vision (Direct Processing)**

   ```typescript
   // Convert file to base64 or URL for AI processing
   const base64Data = Buffer.from(fileBuffer).toString("base64");

   const ocrResponse = await env.AI.run("@cf/llava-1.5-7b-gguf", {
     prompt: `Extract receipt data as JSON: {
         amount: number (total),
         currency: string,
         date: string (YYYY-MM-DD),
         merchant: string,
         items: [{description, amount}]
       }`,
     image: [{ data: base64Data, type: "base64" }]
   });
   ```

3. **Parse & Validate Extracted Data**

   ```typescript
   const extracted = JSON.parse(ocrResponse.response);

   // Validate
   const discrepancies = [];
   if (Math.abs(extracted.amount - submitted_amount) > 0.01) {
     discrepancies.push(
       `Amount mismatch: receipt shows $${extracted.amount}, submitted $${submitted_amount}`
     );
   }

   // Store results
   await env.APP_DB.prepare(
     `UPDATE receipt_uploads 
      SET extracted_data = ?, ocr_status = ?, upload_status = ?
      WHERE id = ?`
   )
     .bind(JSON.stringify(extracted), "completed", "processed", receiptId)
     .run();
   ```

4. **Return Result**
   ```typescript
   return {
     receipt_id: receiptId,
     extracted_amount: extracted.amount,
     extracted_currency: extracted.currency,
     extracted_date: extracted.date,
     merchant_name: extracted.merchant,
     line_items: extracted.items,
     confidence_score: 0.85, // Mock for now
     warnings: discrepancies
   };
   ```

### 3.2 Expense Validation Workflow (Cloudflare Workflows)

**Design Philosophy:** Use **Cloudflare Workflows** for expense validation. Workflows provides built-in orchestration, automatic retries, and state persistence - perfect for multi-step validation logic.

**Workflow Architecture:**

- ✅ **Main Chat Agent** (`src/server.ts`) - Handles user conversation
- ✅ **ExpenseValidation Workflow** (`src/expense-validation-workflow.ts`) - Orchestrates validation steps
- ✅ **Automatic Retries** - Each step retries on failure
- ✅ **Observable Steps** - Each validation check is a named step
- ✅ **Tool Access** - Workflow steps can call handbook search and DB queries

**Why Workflows Instead of Separate Agent:**

| Aspect            | Separate Agent            | Cloudflare Workflow         |
| ----------------- | ------------------------- | --------------------------- |
| Purpose           | General AI reasoning      | Multi-step orchestration    |
| Retries           | Manual implementation     | Built-in automatic retries  |
| Observability     | Agent logs                | Named, trackable steps      |
| State Persistence | Must implement manually   | Built-in across steps       |
| Complexity        | Requires agent management | Simple step-based model     |
| Best For          | Complex AI reasoning      | Sequential validation logic |

#### Workflow Step Diagram

```
┌────────────────────────────────────────────────────────────┐
│         ExpenseValidation Workflow Execution               │
└────────────────────────────────────────────────────────────┘

Input: {
  employee_id: "user123",
  amount: 150,
  category: "meals",
  description: "dinner with clients",
  has_receipt: false
}

  ↓
┌─────────────────────────────────────────┐
│ Step 1: "get employee info"            │
│ → get_current_user()                   │
│ → Returns: { employee_level: "junior" }│
│ ✓ Auto-retry on failure                │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 2: "query auto-approval limits"   │
│ → search_employee_handbook()           │
│ → Returns: "$100 for junior employees" │
│ ✓ Auto-retry on failure                │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 3: "check amount limit"           │
│ → if (150 > 100) → VIOLATION           │
│ → Add to violations array              │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 4: "query receipt requirements"   │
│ → search_employee_handbook()           │
│ → Returns: "Required for expenses >$75"│
│ ✓ Auto-retry on failure                │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 5: "check receipt requirement"    │
│ → if (150 > 75 && !has_receipt)        │
│ → VIOLATION: missing_receipt           │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 6: "query non-reimbursable items" │
│ → search_employee_handbook()           │
│ → Returns: List of prohibited items    │
│ ✓ Auto-retry on failure                │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 7: "check patterns"               │
│ → Scan description for keywords        │
│ → No violations found                  │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 8: "query today's meal expenses"  │
│ → get_expense_history(today, meals)    │
│ → Returns: $0 spent today              │
│ ✓ Auto-retry on failure                │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 9: "check daily meal limit"       │
│ → if (150 + 0 > 75) → VIOLATION        │
│ → Add to violations array              │
└─────────────┬───────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Step 10: "make final decision"         │
│ → violations.length = 3                │
│ → recommendation: DENY                 │
│ → Return ValidationResult              │
└─────────────┬───────────────────────────┘
              ↓
Output: {
  recommendation: "DENY",
  violations: [
    "exceeds_auto_approval_limit",
    "missing_receipt",
    "exceeds_daily_limit"
  ],
  can_auto_approve: false
}
```

#### Workflow Implementation

**File:** `src/expense-validation-workflow.ts`

Create a Cloudflare Workflow that orchestrates validation steps:

```typescript
import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent
} from "cloudflare:workers";
import type { Env } from "./types";
import {
  search_employee_handbook,
  get_expense_history,
  get_current_user
} from "./tools";

interface ExpenseValidationParams {
  employee_id: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  has_receipt: boolean;
  receipt_data?: {
    merchant: string;
    date: string;
    extracted_amount: number;
  };
}

interface ValidationResult {
  is_valid: boolean;
  can_auto_approve: boolean;
  requires_escalation: boolean;
  violations: Array<{ policy: string; message: string }>;
  auto_approval_limit: number;
  employee_level: string;
  recommendation: "AUTO_APPROVE" | "ESCALATE_TO_MANAGER" | "DENY";
  checks_performed: {
    amount_check: "pass" | "fail";
    receipt_check: "pass" | "fail" | "not_required";
    policy_violations: string[];
  };
}

/**
 * ExpenseValidation Workflow
 *
 * Multi-step workflow for validating expense requests.
 * Each step is automatically retried on failure and tracked for observability.
 */
export class ExpenseValidationWorkflow extends WorkflowEntrypoint<
  Env,
  ExpenseValidationParams
> {
  async run(event: WorkflowEvent<ExpenseValidationParams>, step: WorkflowStep) {
    const params = event.params;
    const violations: Array<{ policy: string; message: string }> = [];

    console.log(
      `[WORKFLOW] Starting validation for $${params.amount} ${params.category}`
    );

    // Build tool context
    const toolContext = {
      env: this.env,
      userId: params.employee_id
    };

    // STEP 1: Get employee info
    const employee = await step.do("get employee info", async () => {
      return await get_current_user.execute(
        {
          employee_id: params.employee_id
        },
        toolContext
      );
    });

    console.log(`[WORKFLOW] Employee level: ${employee.employee_level}`);

    // STEP 2: Query handbook for auto-approval limits
    const limitQuery = await step.do("query auto-approval limits", async () => {
      return await search_employee_handbook.execute(
        {
          query: `What is the auto-approval limit for ${employee.employee_level} employee ${params.category} expenses?`
        },
        toolContext
      );
    });

    console.log(`[WORKFLOW] Handbook response:`, limitQuery);

    // Parse limit (Junior: $100, Senior: $500)
    const autoApprovalLimit = employee.employee_level === "senior" ? 500 : 100;

    // STEP 3: Check amount vs limit
    await step.do("check amount limit", async () => {
      if (params.amount > autoApprovalLimit) {
        violations.push({
          policy: "exceeds_auto_approval_limit",
          message: `Amount $${params.amount} exceeds auto-approval limit of $${autoApprovalLimit} for ${employee.employee_level} employees.`
        });
      }
      return { checked: true };
    });

    // STEP 4: Query and check receipt requirements
    const receiptPolicy = await step.do(
      "query receipt requirements",
      async () => {
        return await search_employee_handbook.execute(
          {
            query: "Are receipts required for expenses over $75?"
          },
          toolContext
        );
      }
    );

    await step.do("check receipt requirement", async () => {
      if (params.amount > 75 && !params.has_receipt) {
        violations.push({
          policy: "missing_receipt",
          message:
            "Receipt is required for expenses over $75 per company policy (Section 6.1)."
        });
      }
      return { checked: true };
    });

    // STEP 5: Check for non-reimbursable items
    const nonReimbursableQuery = await step.do(
      "query non-reimbursable items",
      async () => {
        return await search_employee_handbook.execute(
          {
            query: `Is a ${params.category} expense for "${params.description}" reimbursable? What expenses are not reimbursable?`
          },
          toolContext
        );
      }
    );

    await step.do("check non-reimbursable patterns", async () => {
      const nonReimbursableKeywords = [
        "alcohol",
        "parking ticket",
        "speeding ticket",
        "mini-bar",
        "movie rental",
        "family",
        "spouse",
        "personal"
      ];

      const descriptionLower = params.description.toLowerCase();
      for (const keyword of nonReimbursableKeywords) {
        if (descriptionLower.includes(keyword)) {
          violations.push({
            policy: "non_reimbursable_item",
            message: `Expense may contain non-reimbursable items (detected: "${keyword}"). Per Section 6.3.`
          });
          break;
        }
      }
      return { checked: true };
    });

    // STEP 6: Check daily limits for meals
    if (params.category === "meals") {
      const todayExpenses = await step.do(
        "query today's meal expenses",
        async () => {
          return await get_expense_history.execute(
            {
              employee_id: params.employee_id,
              timeframe: "today",
              category: "meals"
            },
            toolContext
          );
        }
      );

      await step.do("check daily meal limit", async () => {
        const dailyMealLimit = 75; // Per diem from handbook
        const totalToday = todayExpenses.total_amount + params.amount;

        if (totalToday > dailyMealLimit) {
          violations.push({
            policy: "exceeds_daily_limit",
            message: `Total meal expenses for today ($${totalToday}) would exceed daily limit of $${dailyMealLimit}.`
          });
        }
        return { checked: true };
      });
    }

    // STEP 7: Make final decision
    const result = await step.do(
      "make final decision",
      async (): Promise<ValidationResult> => {
        const canAutoApprove =
          violations.length === 0 && params.amount <= autoApprovalLimit;
        const requiresEscalation =
          params.amount > autoApprovalLimit ||
          violations.some((v) => v.policy === "exceeds_auto_approval_limit");

        let recommendation: "AUTO_APPROVE" | "ESCALATE_TO_MANAGER" | "DENY";
        if (
          violations.some(
            (v) =>
              v.policy === "non_reimbursable_item" ||
              v.policy === "missing_receipt"
          )
        ) {
          recommendation = "DENY";
        } else if (requiresEscalation) {
          recommendation = "ESCALATE_TO_MANAGER";
        } else {
          recommendation = "AUTO_APPROVE";
        }

        console.log(
          `[WORKFLOW] Decision: ${recommendation}, Violations: ${violations.length}`
        );

        return {
          is_valid: violations.length === 0,
          can_auto_approve: canAutoApprove,
          requires_escalation: requiresEscalation,
          violations,
          auto_approval_limit: autoApprovalLimit,
          employee_level: employee.employee_level,
          recommendation,
          checks_performed: {
            amount_check: params.amount <= autoApprovalLimit ? "pass" : "fail",
            receipt_check:
              params.amount > 75
                ? params.has_receipt
                  ? "pass"
                  : "fail"
                : "not_required",
            policy_violations: violations.map((v) => v.policy)
          }
        };
      }
    );

    return result;
  }
}
```

#### Tool: `validate_expense_with_workflow`

Create a tool in `src/tools.ts` that invokes the ExpenseValidation workflow:

```typescript
const validate_expense_with_workflow: Tool = {
  name: "validate_expense_with_workflow",
  description: `Invokes the ExpenseValidation workflow to validate an expense request.
    Uses Cloudflare Workflows for multi-step orchestration with automatic retries.
    Returns validation result with decision (AUTO_APPROVE, ESCALATE, or DENY).`,
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "Employee making the expense request"
      },
      amount: {
        type: "number",
        description: "Expense amount"
      },
      currency: {
        type: "string",
        description: "Currency code (default: USD)"
      },
      category: {
        type: "string",
        description:
          "Expense category: meals, travel, home_office, training, software, supplies"
      },
      description: {
        type: "string",
        description: "Brief description of the expense"
      },
      has_receipt: {
        type: "boolean",
        description: "Whether a receipt is attached"
      },
      receipt_data: {
        type: "object",
        properties: {
          merchant: { type: "string" },
          date: { type: "string" },
          extracted_amount: { type: "number" }
        }
      }
    },
    required: ["employee_id", "amount", "category", "has_receipt"]
  },

  execute: async (params, context: ToolContext) => {
    console.log(`[TOOL] validate_expense_with_workflow: Starting workflow`);

    // Invoke the ExpenseValidation workflow and wait for result
    const instance = await context.env.EXPENSE_VALIDATION_WORKFLOW.create({
      params: {
        employee_id: params.employee_id,
        amount: params.amount,
        currency: params.currency || "USD",
        category: params.category,
        description: params.description,
        has_receipt: params.has_receipt,
        receipt_data: params.receipt_data
      }
    });

    // Wait for workflow to complete and return result
    const result = await instance.wait();

    console.log(`[TOOL] Workflow completed: ${result.recommendation}`);

    return result;
  }
};
```

#### How the Workflow Integration Works

```
User: "I need to expense a $150 dinner with clients"
  ↓
Main Chat Agent (src/server.ts):
  1. Calls get_current_user(employee_id)
  2. Agent collects: amount, category, description
  3. Calls validate_expense_with_workflow({
       employee_id: "user123",
       amount: 150,
       currency: "USD",
       category: "meals",
       description: "dinner with clients",
       has_receipt: false
     })
  ↓
validate_expense_with_workflow Tool:
  - Creates workflow instance via EXPENSE_VALIDATION_WORKFLOW.create()
  - HANDS OFF CONTROL TO WORKFLOW
  - Waits for workflow to complete via instance.wait()
  ↓
ExpenseValidation Workflow (runs in parallel):
  Step 1: "get employee info" → get_current_user
  Step 2: "query auto-approval limits" → search_employee_handbook
  Step 3: "check amount limit" → Compare amount vs limit
  Step 4: "query receipt requirements" → search_employee_handbook
  Step 5: "check receipt requirement" → Validate receipt
  Step 6: "query non-reimbursable items" → search_employee_handbook
  Step 7: "check non-reimbursable patterns" → Pattern matching
  Step 8: "query today's meal expenses" → get_expense_history
  Step 9: "check daily meal limit" → Validate daily limit
  Step 10: "make final decision" → Return ValidationResult
  ↓
  WORKFLOW COMPLETES & RETURNS RESULT
  ↓
Main Chat Agent (receives validation result):
  - Interprets result.recommendation
  - Calls submit_expense_request with status='denied'
  - Responds to user with natural language explanation
  ↓
User sees:
"I cannot process your $150 meal expense for the following reasons:
  • Exceeds auto-approval limit of $100 for junior employees
  • Receipt required for expenses over $75 per Section 6.1

Please upload your receipt. Once provided, I can escalate this
to your manager for approval since it exceeds your auto-approval limit."
```

#### Benefits of Workflows

**vs. Separate Agent or Tool:**

| Aspect            | Single Tool   | Separate Agent  | Cloudflare Workflow          |
| ----------------- | ------------- | --------------- | ---------------------------- |
| Orchestration     | Manual        | Agent reasoning | Built-in step-based          |
| Retries           | Manual        | Manual          | Automatic per step           |
| Observability     | Console logs  | Agent logs      | Named steps, trackable       |
| State Persistence | None          | Durable Object  | Built-in across steps        |
| Error Recovery    | Try/catch     | Try/catch       | Automatic retry + checkpoint |
| Best For          | Simple checks | AI reasoning    | Multi-step validation        |

#### wrangler.jsonc Configuration

Add the ExpenseValidation workflow binding:

```jsonc
{
  "workflows": [
    {
      "name": "expense-validation-workflow",
      "binding": "EXPENSE_VALIDATION_WORKFLOW",
      "class_name": "ExpenseValidationWorkflow"
    }
  ]
}
```

### 3.3 Tool: `submit_expense_request`

**Purpose:** Create expense request with validated status

**Parameters:**

- `employee_id`: Employee ID
- `category`: Expense category
- `amount`: Amount in USD
- `description`: Description
- `receipt_upload_id`: Optional receipt ID
- `status`: 'auto_approved', 'pending', 'denied'
- `approval_type`: 'auto', 'manual'
- `validation_notes`: JSON string of validation results

**Result:**

- Returns `{ request_id, status, message }`
- Updates audit log
- If auto-approved: sends confirmation message to employee

---

## 4. UI Changes Required

### 4.1 New Components

#### A. `FileUploadInput` Component

**File:** `src/components/file-upload/FileUploadInput.tsx`

```typescript
interface FileUploadInputProps {
  onFileSelected: (file: File) => void;
  onUpload: (file: File) => Promise<{ success: boolean; error?: string }>;
  accept?: string; // 'image/*,application/pdf'
  maxSize?: number; // bytes
  disabled?: boolean;
  isLoading?: boolean;
}

export const FileUploadInput: React.FC<FileUploadInputProps> = ({
  onFileSelected,
  onUpload,
  accept = "image/*,application/pdf",
  maxSize = 10 * 1024 * 1024, // 10MB
  disabled = false,
  isLoading = false
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files?.length > 0) {
      await processFile(files[0]);
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files?.length > 0) {
      await processFile(files[0]);
    }
  };

  const processFile = async (file: File) => {
    // Validate size
    if (file.size > maxSize) {
      alert(`File size exceeds ${maxSize / 1024 / 1024}MB limit`);
      return;
    }

    // Validate type
    if (!file.type.match(accept)) {
      alert(`File type not accepted. Allowed: ${accept}`);
      return;
    }

    onFileSelected(file);

    // Upload
    if (onUpload) {
      const result = await onUpload(file);
      if (!result.success) {
        alert(result.error || "Upload failed");
      }
    }
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-8 text-center
        transition-colors cursor-pointer
        ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        onChange={handleChange}
        accept={accept}
        disabled={disabled}
        style={{ display: 'none' }}
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="btn btn-primary"
      >
        {isLoading ? 'Uploading...' : 'Choose File or Drag Here'}
      </button>

      <p className="text-sm text-gray-500 mt-2">
        Supported: Images (JPG, PNG) or PDF, max {maxSize / 1024 / 1024}MB
      </p>

      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="mt-4">
          <progress value={uploadProgress} max="100" className="w-full" />
          <p className="text-sm">{uploadProgress}%</p>
        </div>
      )}
    </div>
  );
};
```

#### B. `ReceiptPreview` Component

**File:** `src/components/receipt-preview/ReceiptPreview.tsx`

```typescript
interface ReceiptPreviewProps {
  receiptUrl: string;
  extractedData?: {
    amount: number;
    currency: string;
    date: string;
    merchant: string;
  };
  isLoading?: boolean;
  onRemove?: () => void;
}

export const ReceiptPreview: React.FC<ReceiptPreviewProps> = ({
  receiptUrl,
  extractedData,
  isLoading = false,
  onRemove
}) => {
  return (
    <Card className="mt-4">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          {receiptUrl.endsWith('.pdf') ? (
            <FileText size={48} />
          ) : (
            <img
              src={receiptUrl}
              alt="Receipt"
              className="w-32 h-32 object-cover rounded"
            />
          )}
        </div>

        {extractedData && (
          <div className="flex-1">
            <h3 className="font-semibold">Extracted Data</h3>
            <dl className="text-sm">
              <dt className="font-medium">Merchant:</dt>
              <dd>{extractedData.merchant}</dd>

              <dt className="font-medium mt-1">Amount:</dt>
              <dd>{extractedData.currency} {extractedData.amount}</dd>

              <dt className="font-medium mt-1">Date:</dt>
              <dd>{extractedData.date}</dd>
            </dl>
          </div>
        )}

        {onRemove && (
          <button
            onClick={onRemove}
            className="flex-shrink-0 text-gray-500 hover:text-red-500"
          >
            <Trash size={20} />
          </button>
        )}
      </div>
    </Card>
  );
};
```

#### B. `ExpenseForm` Component

**File:** `src/components/expense-form/ExpenseForm.tsx`

```typescript
interface ExpenseFormProps {
  onSubmit: (data: ExpenseSubmission) => Promise<void>;
  isLoading?: boolean;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({ onSubmit, isLoading }) => {
  const [formData, setFormData] = useState({
    category: 'meals',
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    receipt_file: null as File | null // REQUIRED
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const handleFileSelected = (file: File) => {
    setFormData(prev => ({ ...prev, receipt_file: file }));
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!formData.category) errors.category = 'Category is required';
    if (!formData.amount || parseFloat(formData.amount) <= 0)
      errors.amount = 'Valid amount is required';
    if (!formData.description) errors.description = 'Description is required';
    if (!formData.receipt_file)
      errors.receipt_file = 'Receipt is required for all expenses'; // MANDATORY

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    try {
      // Receipt upload is mandatory - file will always exist here
      const uploadResult = await uploadReceipt(formData.receipt_file!);
      const receiptUploadId = uploadResult.receipt_id;

      await onSubmit({
        category: formData.category,
        amount: parseFloat(formData.amount),
        description: formData.description,
        date: formData.date,
        receipt_upload_id: receiptUploadId
      });
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="category">Category</Label>
        <Select
          id="category"
          value={formData.category}
          onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
          options={[
            { value: 'meals', label: 'Meals' },
            { value: 'travel', label: 'Travel' },
            { value: 'home_office', label: 'Home Office' },
            { value: 'training', label: 'Training' },
            { value: 'software', label: 'Software' },
            { value: 'supplies', label: 'Supplies' }
          ]}
          error={validationErrors.category}
        />
      </div>

      <div>
        <Label htmlFor="amount">Amount (USD)</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
          placeholder="0.00"
          onValueChange={(val) => setFormData(prev => ({ ...prev, amount: val }))}
          error={validationErrors.amount}
        />
      </div>

      <div>
        <Label htmlFor="date">Date of Expense</Label>
        <Input
          id="date"
          type="date"
          value={formData.date}
          onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
          onValueChange={(val) => setFormData(prev => ({ ...prev, date: val }))}
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="E.g., Client lunch at Michelin-star restaurant"
          rows={3}
          onValueChange={(val) => setFormData(prev => ({ ...prev, description: val }))}
          error={validationErrors.description}
        />
      </div>

      <div>
        <Label>Receipt <span className="text-red-500">*</span> Required</Label>
        <FileUploadInput
          onFileSelected={handleFileSelected}
          onUpload={uploadReceipt}
          accept="image/*,application/pdf"
          maxSize={5 * 1024 * 1024} // 5MB limit
          disabled={isLoading}
        />

        {validationErrors.receipt_file && (
          <p className="text-red-600 text-sm mt-2">{validationErrors.receipt_file}</p>
        )}

        {formData.receipt_file && (
          <p className="text-sm text-green-600 mt-2">
            ✓ {formData.receipt_file.name} selected ({(formData.receipt_file.size / 1024).toFixed(1)}KB)
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? 'Submitting...' : 'Submit Expense'}
      </Button>
    </form>
  );
};
```

### 4.2 Chat Interface Integration

**File:** `src/app.tsx` - Enhancement to chat interface

```typescript
// Add to chat message handler
const handleAgentSubmit = async (
  e: React.FormEvent,
  extraData: Record<string, unknown> = {}
) => {
  e.preventDefault();

  // Check if user is attaching a file for expense submission
  const hasExpenseAttachment = extraData.expense_receipt_file;

  if (hasExpenseAttachment) {
    // Encode file to base64 for transmission
    const file = extraData.expense_receipt_file as File;
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const message = `${agentInput}
[ATTACHMENT: Receipt]
File: ${file.name}
Type: ${file.type}
Size: ${file.size}
Base64: ${base64.substring(0, 100)}...`;

    // Send message with attachment metadata
    await agent.sendMessage({
      content: message,
      metadata: {
        hasAttachment: true,
        attachmentType: "receipt",
        fileName: file.name,
        fileType: file.type,
        fileBase64: base64
      }
    });
  } else {
    // Regular message without attachment
    await agent.sendMessage(agentInput);
  }

  setAgentInput("");
};
```

### 4.3 Dashboard/History Component

**File:** `src/components/expense-history/ExpenseHistory.tsx`

```typescript
export const ExpenseHistory: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all');

  useEffect(() => {
    // Fetch from API
    fetchExpenses();
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['all', 'pending', 'approved', 'denied'] as const).map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded ${
              filter === status ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {expenses.map(expense => (
          <Card key={expense.id} className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{expense.description}</p>
                <p className="text-sm text-gray-600">
                  {expense.category} • {new Date(expense.created_at * 1000).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold">${expense.amount}</p>
                <span className={`text-sm px-2 py-1 rounded ${
                  expense.status === 'approved' ? 'bg-green-100 text-green-800' :
                  expense.status === 'denied' ? 'bg-red-100 text-red-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {expense.status}
                </span>
              </div>
            </div>

            {expense.receipt_url && (
              <a
                href={expense.receipt_url}
                target="_blank"
                className="text-blue-500 hover:underline text-sm mt-2"
              >
                View Receipt
              </a>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};
```

---

## 5. Agent Tools Implementation

### 5.1 Tool Architecture Overview

**Simplified Approach:** Instead of many specialized tools, use:

1. **Simple database query tools** (get employee, get expenses)
2. **Existing handbook search tool** (already implemented)
3. **One LLM agent** that orchestrates validation logic

### 5.2 New Tools to Add to `src/tools.ts`

**Pattern:** Follow the exact structure of existing PTO tools. Add these to the tools registry after the PTO tools.

```typescript
// ============================================
// EXPENSE REIMBURSEMENT TOOLS
// ============================================

// Tool 1: Get Expense History
const get_expense_history: Tool = {
  name: "get_expense_history",
  description:
    "Retrieves expense history for an employee to check daily/monthly spending limits.",
  parameters: {
    type: "object",
    properties: {
      employee_id: {
        type: "string",
        description: "Employee ID to query"
      },
      timeframe: {
        type: "string",
        enum: ["today", "this_week", "this_month", "all"],
        description: "Time period to query"
      },
      category: {
        type: "string",
        description:
          "Optional: filter by expense category (meals, travel, etc.)"
      }
    },
    required: ["employee_id", "timeframe"]
  },
  execute: async (params, context: ToolContext) => {
    const { employee_id, timeframe, category } = params as {
      employee_id: string;
      timeframe: "today" | "this_week" | "this_month" | "all";
      category?: string;
    };

    console.log(
      `[TOOL] get_expense_history: ${timeframe} for employee ${employee_id}`
    );

    let timeCondition = "";
    const now = Math.floor(Date.now() / 1000);

    switch (timeframe) {
      case "today":
        const startOfDay = now - (now % 86400);
        timeCondition = `AND created_at >= ${startOfDay}`;
        break;
      case "this_week":
        const startOfWeek = now - 7 * 86400;
        timeCondition = `AND created_at >= ${startOfWeek}`;
        break;
      case "this_month":
        const startOfMonth = now - 30 * 86400;
        timeCondition = `AND created_at >= ${startOfMonth}`;
        break;
    }

    const query = `
      SELECT id, category, amount, currency, description, status, created_at
      FROM expense_requests
      WHERE employee_id = ?
      ${category ? "AND category = ?" : ""}
      ${timeCondition}
      ORDER BY created_at DESC
    `;

    const bindings = category ? [employee_id, category] : [employee_id];
    const results = await context.env.APP_DB.prepare(query)
      .bind(...bindings)
      .all();

    const total = results.results.reduce(
      (sum, exp: any) => sum + exp.amount,
      0
    );

    console.log(
      `[TOOL] Found ${results.results.length} expenses, total: $${total}`
    );

    return {
      expenses: results.results,
      total_amount: total,
      count: results.results.length,
      timeframe
    };
  }
};

// Tool 2: Validate Expense Policy
// (Implementation provided in Section 3.2 above)
const validate_expense_policy: Tool = {
  // ... see Section 3.2 for full implementation ...
};

// Tool 3: Submit Expense Request
const submit_expense_request: Tool = {
  name: "submit_expense_request",
  description:
    "Creates an expense reimbursement request in the database with the validation status.",
  parameters: {
    type: "object",
    properties: {
      employee_id: { type: "string" },
      category: {
        type: "string",
        description:
          "Expense category: meals, travel, home_office, training, software, supplies"
      },
      amount: { type: "number" },
      currency: { type: "string" },
      description: { type: "string" },
      status: {
        type: "string",
        enum: ["pending", "auto_approved", "denied"],
        description: "Status based on validation result"
      },
      auto_approved: { type: "boolean" },
      escalation_reason: {
        type: "string",
        description: "Reason for escalation or denial"
      },
      employee_level: {
        type: "string",
        description: "Employee level snapshot"
      },
      ai_validation_status: {
        type: "string",
        description: "AI validation status"
      }
    },
    required: ["employee_id", "category", "amount", "description", "status"]
  },
  execute: async (params, context: ToolContext) => {
    const id = crypto.randomUUID();

    console.log(`[TOOL] submit_expense_request: Creating expense ${id}`);

    // Get employee and manager info (same pattern as submit_pto_request)
    const employee = await context.env.APP_DB.prepare(
      "SELECT manager_id, employee_level FROM users WHERE id = ?"
    )
      .bind(params.employee_id)
      .first();

    if (!employee) {
      throw new Error("Employee not found");
    }

    // Insert expense request
    await context.env.APP_DB.prepare(
      `
      INSERT INTO expense_requests (
        id, employee_id, manager_id, category, amount, currency,
        description, status, auto_approved, escalation_reason,
        employee_level, ai_validation_status, submission_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        id,
        params.employee_id,
        employee.manager_id,
        params.category,
        params.amount,
        params.currency || "USD",
        params.description,
        params.status,
        params.auto_approved ? 1 : 0,
        params.escalation_reason || null,
        params.employee_level || employee.employee_level,
        params.ai_validation_status || "validated",
        "chat_ai"
      )
      .run();

    // Log audit event (same pattern as PTO)
    await log_audit_event.execute(
      {
        entity_type: "expense_request",
        entity_id: id,
        action: "created",
        user_id: params.employee_id,
        details: {
          category: params.category,
          amount: params.amount,
          status: params.status,
          auto_approved: params.auto_approved
        }
      },
      context
    );

    console.log(`[TOOL] Expense created: ${id}, status: ${params.status}`);

    return {
      request_id: id,
      status: params.status,
      message:
        params.status === "auto_approved"
          ? `Expense approved automatically!`
          : params.status === "pending"
            ? `Expense submitted for manager review.`
            : `Expense request denied.`
    };
  }
};

// Tool 4: Approve Expense Request (Manager Only)
const approve_expense_request: Tool = {
  name: "approve_expense_request",
  description:
    "Approves a pending expense request. Only managers can approve expenses.",
  parameters: {
    type: "object",
    properties: {
      expense_id: {
        type: "string",
        description: "ID of the expense request to approve"
      },
      approver_id: {
        type: "string",
        description: "ID of the manager approving the request"
      }
    },
    required: ["expense_id", "approver_id"]
  },
  execute: async (params, context: ToolContext) => {
    const now = Math.floor(Date.now() / 1000);

    console.log(
      `[TOOL] approve_expense_request: ${params.expense_id} by ${params.approver_id}`
    );

    await context.env.APP_DB.prepare(
      `
      UPDATE expense_requests
      SET status = 'approved', approved_at = ?
      WHERE id = ? AND status = 'pending'
    `
    )
      .bind(now, params.expense_id)
      .run();

    // Log audit event
    await log_audit_event.execute(
      {
        entity_type: "expense_request",
        entity_id: params.expense_id,
        action: "approved",
        user_id: params.approver_id,
        details: { approved_at: now }
      },
      context
    );

    return { success: true, message: "Expense approved!" };
  }
};

// Tool 5: Deny Expense Request (Manager Only)
const deny_expense_request: Tool = {
  name: "deny_expense_request",
  description:
    "Denies a pending expense request with a reason. Only managers can deny expenses.",
  parameters: {
    type: "object",
    properties: {
      expense_id: {
        type: "string",
        description: "ID of the expense request to deny"
      },
      approver_id: {
        type: "string",
        description: "ID of the manager denying the request"
      },
      reason: {
        type: "string",
        description: "Reason for denial"
      }
    },
    required: ["expense_id", "approver_id", "reason"]
  },
  execute: async (params, context: ToolContext) => {
    console.log(
      `[TOOL] deny_expense_request: ${params.expense_id} by ${params.approver_id}`
    );

    await context.env.APP_DB.prepare(
      `
      UPDATE expense_requests
      SET status = 'denied', escalation_reason = ?
      WHERE id = ? AND status = 'pending'
    `
    )
      .bind(params.reason, params.expense_id)
      .run();

    // Log audit event
    await log_audit_event.execute(
      {
        entity_type: "expense_request",
        entity_id: params.expense_id,
        action: "denied",
        user_id: params.approver_id,
        details: { reason: params.reason }
      },
      context
    );

    return { success: true, message: "Expense denied." };
  }
};
```

### 5.3 Update Tool Registry

**File:** `src/tools.ts` (at the bottom)

```typescript
export const tools: Record<string, Tool> = {
  // Existing core tools
  get_current_user,
  search_employee_handbook,
  log_audit_event,

  // PTO tools
  get_pto_balance,
  check_blackout_periods,
  get_pto_history,
  calculate_business_days,
  validate_pto_policy,
  submit_pto_request,

  // NEW: Expense tools
  get_expense_history,
  validate_expense_with_workflow, // ← Invokes validation workflow
  submit_expense_request, // ← Store in database
  approve_expense_request, // ← Manager action
  deny_expense_request // ← Manager action
};

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
```

### 5.4 Update System Prompt

**File:** `src/prompts.ts`

Add expense workflow instructions to the system prompt:

```typescript
export function getSystemPrompt(): string {
  return `You are ApprovalFlow AI, an intelligent agent that helps
  employees with PTO requests and expense reimbursements.

## Your Role

You are a helpful assistant that:
- Answers questions about PTO policies and expense reimbursement
- Auto approves, denies, or escalates PTO requests based on company policies
- Auto approves, denies, or escalates EXPENSE REQUESTS based on policies
- Provides information about company policies from the employee handbook
- Helps users understand their PTO balances and expense spending

## Your Capabilities

You have access to the following tools:

${getToolDescriptions()}

## CRITICAL RULES

1. **AUTOMATIC CONTEXT GATHERING**: For any PTO or expense request,
   I automatically retrieve your user details using available tools

2. **NEVER make up or assume data**
   - DON'T invent amounts, dates, or details
   - If information is missing, ASK the user for it

3. **ONLY process requests when you have ALL required information**
   - For PTO: Need specific start and end dates
   - For expenses: Need amount, category, and description

## Expense Request Workflow

When a user requests expense reimbursement:

1. **Gather Information**:
   - Call \`get_current_user\` to get employee info automatically
   - Ask user for: amount, category, description
   - Ask if they have a receipt (required for expenses > $75)

2. **Validate Policy**:
   - Call \`validate_expense_with_workflow\` with all details
   - The workflow will execute these steps automatically:
     - Step 1: Get employee info and level
     - Step 2: Query handbook for auto-approval limits
     - Step 3: Check receipt requirements
     - Step 4: Check for non-reimbursable items
     - Step 5: Query expense history for daily limits
     - Step 6: Make final decision
   - Each step has automatic retries if it fails

3. **Take Action Based on Validation**:
   - If validation recommends AUTO_APPROVE:
     → Call \`submit_expense_request\` with status='auto_approved'
     → Inform user: "Your expense has been approved!"

   - If validation recommends ESCALATE_TO_MANAGER:
     → Call \`submit_expense_request\` with status='pending'
     → Inform user: "Your expense exceeds auto-approval limits and
                      will be reviewed by your manager."

   - If validation recommends DENY:
     → Call \`submit_expense_request\` with status='denied'
     → Explain violations to user clearly

4. **Always log audit events**:
   - The \`submit_expense_request\` tool handles this automatically

## How to Respond

**ALWAYS respond in plain, natural language.** Be concise and include only
what the user needs to know. Do not describe internal steps, tool calls,
or background checks to the user.

Example responses:
- ✅ "Your $80 meal expense has been approved!"
- ✅ "I need a bit more information. What category is this expense for?"
- ❌ "I will now call the validate_expense_policy tool with parameters..."
- ❌ "Let me check your employee_level in the database..."
`;
}
```

### 5.5 Tool Usage Flow (Actual Pattern)

```
User: "I need to expense a $150 dinner"
  ↓
Chat Agent (runReActAgent in src/react-agent.ts):
  1. Calls get_current_user() → Gets employee info automatically
  2. Agent asks: "What category is this expense for?"
  ↓
User: "Meals - client dinner"
  ↓
Chat Agent:
  3. Calls validate_expense_with_workflow({
       employee_id: "user123",
       amount: 150,
       currency: "USD",
       category: "meals",
       description: "client dinner",
       has_receipt: false
     })
  4. Workflow executes 10 named steps (see Section 3.2):
     - Each step is automatically retried on failure
     - Workflow queries handbook, checks history, validates policies
     - Returns { recommendation: "DENY", violations: [...] }
  5. Calls submit_expense_request with status='denied'
  6. Calls log_audit_event
  ↓
Agent Response to User:
"I cannot process your $150 meal expense for the following reasons:
  • Exceeds auto-approval limit of $100 for junior employees
  • Receipt required for expenses over $75 per Section 6.1

Please upload your receipt. Once provided, I can escalate this
to your manager for approval since it exceeds your auto-approval limit."
```

---

## 6. Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)

- [ ] **Drop and recreate** expense_requests table with all new fields
- [ ] Create receipt_uploads table migration
- [ ] Run updated migrations (drop old data)
- [ ] Implement receipt processing endpoint (direct, in-memory)
- [ ] Basic file validation (size, type)
- [ ] Workers AI Vision integration for OCR
- [ ] Integration with existing `search_employee_handbook` tool

### Phase 2: Workflow & Validation (Week 2)

- [ ] Create `ExpenseValidationWorkflow` class in `src/expense-validation-workflow.ts`
- [ ] Implement workflow steps for validation logic
- [ ] Implement `get_expense_history` tool (DB query)
- [ ] Implement `validate_expense_with_workflow` tool (workflow invocation)
- [ ] Implement `submit_expense_request` tool
- [ ] Configure workflow binding in wrangler.jsonc
- [ ] Test workflow execution and step observability

### Phase 3: Agent Integration (Week 3)

- [ ] Integrate new tools into agent prompt
- [ ] Update `react-agent.ts` to handle expense workflows
- [ ] Test end-to-end expense submission via chat
- [ ] Add manager tools (approve/deny)

### Phase 4: UI Components (Week 4)

- [ ] Build `FileUploadInput` component
- [ ] Build `ReceiptPreview` component
- [ ] Build `ExpenseForm` component
- [ ] Build `ExpenseHistory` component
- [ ] Integrate file upload into chat interface

### Phase 5: Manager Dashboard (Week 5)

- [ ] Create manager dashboard view
- [ ] Display pending expense escalations
- [ ] Implement approval/denial UI
- [ ] Add email notifications

### Phase 6: Testing & Polish (Week 6)

- [ ] Integration tests for full workflow
- [ ] OCR accuracy testing with sample receipts
- [ ] UI/UX refinements
- [ ] Documentation & deployment

---

## 7. Security & Compliance

### 7.1 Data Security

- **File Encryption:** R2 objects encrypted at rest with server-side encryption
- **Access Control:** Restrict receipt access to employee and their manager
- **Virus Scanning:** Implement ClamAV scan via Cloudflare Workers before processing
- **PII Protection:** Redact sensitive data from extracted OCR results

### 7.2 Audit & Compliance

- All expense actions logged to `audit_log` table
- Receipt processing tracked in `receipt_processing_log`
- Immutable audit trail for compliance/disputes
- Data retention: Keep receipts for 7 years per IRS guidelines

### 7.3 Input Validation

- **Receipt is mandatory** - all expenses must have a receipt
- File size limits: 5MB max (for MVP direct processing)
- Allowed file types: JPEG, PNG, PDF only
- Filename sanitization to prevent injection
- Amount validation: Must be positive, max $10,000
- Receipt content must be readable by OCR (min confidence 0.5)

---

## 8. Error Handling & Edge Cases

### 8.1 Common Error Scenarios

| Scenario                                            | Handling                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| Receipt missing                                     | Deny immediately - receipt is mandatory                             |
| File upload fails                                   | Retry with exponential backoff; inform user, request re-upload      |
| OCR extraction fails                                | Display error; ask user to resubmit receipt (may be blurry/damaged) |
| Ambiguous amount (e.g., multiple totals)            | Escalate to manager; highlight ambiguity                            |
| Receipt doesn't match submitted amount              | Flag as warning; escalate to manager for verification               |
| Employee exceeds category annual limit              | Deny with reason; suggest splitting across fiscal year              |
| Receipt date is very old (> 90 days)                | Flag warning but escalate to manager for approval                   |
| Duplicate expense (same receipt hash, amount, date) | Check and deny; suggest reviewing recent submissions                |

### 8.2 Recovery Strategies

- Implement idempotency for receipt uploads (deduplicate by file hash)
- Store failed OCR results for manual retry
- Allow employee to edit and resubmit denied requests
- Implement rate limiting on submissions (1 per minute)

---

## 9. Future Enhancements

### 9.1 Post-MVP Features

- **Multi-Receipt Expenses:** Support bundling multiple receipts for single report
- **Bulk Submissions:** Manager batch approval/denial
- **Receipt Metadata:** Extract vendor tax ID, GST for international reimbursements
- **Analytics Dashboard:** Spending trends by category, employee, manager
- **Integration:** Connect to accounting software (QuickBooks, NetSuite)
- **Mobile App:** iOS/Android native apps for on-the-go submissions
- **Voice Submission:** "Submit expense of $45 for lunch today"

### 9.2 Advanced AI Features

- **Fraud Detection:** Flag suspicious patterns (e.g., same receipt submitted twice)
- **Policy Learning:** AI adapts policy recommendations based on company data
- **Multi-Language:** Support receipts in any language
- **Receipt Matching:** Correlate expenses with corporate credit card transactions

---

## 10. Testing & QA

### 10.1 Test Scenarios

| Test Case | Scenario                            | Expected Outcome                              |
| --------- | ----------------------------------- | --------------------------------------------- |
| T1        | Junior employee submits $75 meal    | Auto-approved                                 |
| T2        | Junior employee submits $200 travel | Escalated to manager                          |
| T3        | Receipt amount differs by $0.50     | Warning but allowed                           |
| T4        | Missing required receipt            | Expense rejected - receipt mandatory          |
| T5        | Manager approves escalated expense  | Employee notified                             |
| T6        | Manager denies with reason          | Employee receives reason                      |
| T7        | File upload fails (corrupted image) | Error message to user, asked to re-upload     |
| T8        | OCR extraction fails                | Error message, user asked to resubmit receipt |
| T9        | Receipt amount differs by $0.50     | Warning highlighted but still processes       |
| T10       | Concurrent submissions              | Both tracked separately                       |

## 10.2 Sample Test Data

```sql
-- Insert test employees
INSERT INTO users VALUES
  ('emp_1', 'alice', ..., 'junior'),
  ('emp_2', 'bob', ..., 'senior'),
  ('mgr_1', 'carol', ..., 'manager');

-- Insert test expenses
-- Policy validation will be done via handbook search, not database queries
INSERT INTO expense_requests VALUES
  ('exp_1', 'emp_1', 'meals', 75, 'USD', 'Client lunch', 'pending', ...);
```

**Note:** Policies are read from employee handbook dynamically. No policy seed data needed.

---

## 11. Configuration & Environment Variables

### 11.1 wrangler.jsonc Updates (MVP - No R2)

```jsonc
{
  // No changes needed - policies are read from handbook via AI search
  "env": {
    "production": {
      "vars": {
        "RECEIPT_MAX_SIZE": "5242880", // 5MB in bytes (max for direct processing)
        "OCR_CONFIDENCE_THRESHOLD": "0.75",
        "AUTO_APPROVAL_ENABLED": "true"
      }
    }
  }
}
```

**Note:** Expense policies are read dynamically from the employee handbook using the `search_employee_handbook` tool. No separate policy table or configuration needed.

### 11.2 Environment Variables

- `RECEIPT_MAX_SIZE`: Max file size (bytes)
- `OCR_CONFIDENCE_THRESHOLD`: Min confidence for auto-extraction
- `AUTO_APPROVAL_ENABLED`: Enable/disable auto-approval
- `MANAGER_EMAIL_TEMPLATE`: Email template for manager notifications

---

## 12. Documentation & Deployment

### 12.1 User Documentation

- **Employee Guide:** How to submit expenses, best receipt practices
- **Manager Guide:** Reviewing and approving expenses, policy overrides
- **Admin Guide:** Managing policies, audit logs, system configuration

### 12.2 Deployment Checklist

- [ ] **IMPORTANT: Drop existing expense_requests table** (data will be lost)
- [ ] Run updated 0004_create_expense_requests_table.sql with all new fields
- [ ] Run 0009_create_receipt_uploads_table.sql migration
- [ ] Verify all new columns exist in expense_requests table
- [ ] Deploy Worker code updates
- [ ] Test end-to-end workflow in staging
- [ ] Train managers on new dashboard
- [ ] Communicate changes to employees
- [ ] Monitor OCR accuracy in first week
- [ ] Be ready to rollback if issues arise

**Note:** No separate expense_policies table needed - policies are read from employee handbook. No R2 configuration needed for MVP (direct file processing).

---

## 13. Appendix: Example API Calls

### 13.1 Receipt-First Expense Submission Workflow

**User Initiates:**

```
User: "I need to be reimbursed for a meal I had yesterday."

Agent Response:
"Great! Let's start by uploading your receipt. Please share the receipt image or PDF.
(This helps us extract the exact amount, merchant, and date.)"
```

**User Uploads Receipt:**

```
User: [Uploads receipt.jpg of Michelin Restaurant invoice]

Agent: "Processing receipt..."
```

**AI Extracts & Confirms:**

```
Agent: "✓ Receipt parsed successfully!

**Merchant:** Michelin Restaurant
**Date:** November 15, 2025
**Items:**
  - Dinner meal: $120.00
  - Tax: $18.00
  - Tip: $12.00
**Total:** $150.00
**Currency:** USD

Is this information correct? (yes/no)"

User: "Yes, that's correct."
```

**Agent Collects Category & Description:**

```
Agent: "Perfect! What category best describes this expense?"
Options: Meals, Travel, Training, Software, Supplies, Home Office

User: "Meals"

Agent: "Can you provide a brief reason for this expense?"

User: "Client lunch with Product team to discuss Q4 roadmap"

Agent: "Great! Let me validate this against company policy..."
```

**Validation & Decision:**

```
Agent: "Checking against handbook policies...

✓ Receipt provided: YES
✓ Amount ($150): Within auto-approval limits for your level
✓ Category (Meals): Allowed
✓ No policy violations found

🎉 Your $150 meal expense has been AUTO-APPROVED!

Reimbursement will be processed within 5-7 business days.
View receipt: [link to receipt image]"
```

### 13.2 Escalation Example (Amount Exceeds Limit)

**User Initiates:**

```
User: "I need to expense a $500 software license for Adobe Creative Cloud (annual)"

Agent: "Let's start by uploading your receipt or invoice."

User: [Uploads invoice.pdf]

Agent: "✓ Receipt parsed successfully!

**Vendor:** Adobe Systems
**Description:** Creative Cloud Annual License
**Total:** $500.00

Is this correct?"

User: "Yes"

Agent: "What's this for?"

User: "Annual software subscription for design work"
```

**Validation Escalation:**

```
Agent: "Checking policy...

✓ Receipt: YES
⚠️ Amount ($500): Exceeds your auto-approval limit ($300 for junior employees)
ℹ️ Category: Software (allowed, requires manager review for amounts >$300)

Escalating to your manager for review...

Your manager Sarah will review this and get back to you within 24 hours.
View receipt: [link]"

[Email to Manager Sarah]:
"New Expense Escalation
Employee: Alice Chen
Amount: $500
Category: Software
Reason: Adobe Creative Cloud annual license
Receipt: [image preview]
AI Notes: Exceeds junior employee auto-approval limit.
Action Needed: Approve or Deny in Manager Dashboard"
```

### 13.3 Manager Approval Flow

**Manager Dashboard:**

```
Escalated Expenses (3 pending):

1. Alice Chen - $500 Software
   ├─ Receipt: [preview image]
   ├─ Extracted Data:
   │  └─ Vendor: Adobe Systems
   │  └─ Amount: $500.00
   │  └─ Date: Nov 14, 2025
   ├─ Employee Reason: "Adobe Creative Cloud annual license"
   ├─ AI Notes: "Exceeds auto-approval limit. No policy violations detected."
   └─ [Approve Button] [Deny Button]

(Manager clicks Approve)

System Notification to Alice:
"✅ Your $500 software expense has been APPROVED by Sarah Martinez!
Reimbursement will be processed within 5-7 business days."
```

### 13.4 Denial Example (Policy Violation)

**User Attempts Non-Reimbursable Item:**

```
User: "I need to expense my parking for a client visit"

Agent: "Let's upload the parking receipt."

User: [Uploads parking_receipt.pdf showing $45]

Agent: "✓ Receipt parsed!
**Location:** Downtown Parking Garage
**Amount:** $45.00
**Date:** Nov 15, 2025

Correct?"

User: "Yes"

Agent: "Checking handbook policies...

❌ Parking expenses are non-reimbursable per company policy
(Section 6.2 - Travel expenses do not include parking.
 If parking is required for business travel, it should be combined
 with hotel/accommodation expenses.)

Your expense cannot be approved.

If you believe this is a business-critical parking expense
(e.g., airport long-term parking for a business trip),
please provide additional context and escalate to your manager."
```

---

## 14. Success Metrics

- **Submission Time:** Reduce expense submission from 10 min (manual) to 2 min (AI-assisted receipt-first)
- **Auto-Approval Rate:** Target 75%+ expenses auto-approved (vs. 0% manual)
- **Manager Review Time:** Reduce escalation review from 1 day to <2 hours
- **OCR Accuracy:** >95% match between receipt and extracted data
- **User Satisfaction:** NPS >8 on ease of use and receipt-first workflow
- **Compliance:** 100% audit trail for all expenses, 100% receipt coverage
- **Error Rate:** <2% OCR confidence below threshold requiring user correction

---

## 13. References

- Features Map: `/docs/features_map.md`
- PTO Implementation: `/docs/pto_request_plan.md`
- Auth MVP Plan: `/docs/auth_mvp_plan.md`
- Employee Handbook: `/docs/employee_handbook.md` (Policy source - Single Source of Truth)
- Existing Migrations: `/migrations/`
- Current Tools: `/src/tools.ts`

**Key:** All expense policies are read from the employee handbook via the `search_employee_handbook` tool. The handbook is the single source of truth for policy information.

---

## 14. Architecture Decision: Cloudflare Workflows

**Decision:** Use **Cloudflare Workflows** for expense validation instead of a separate agent or monolithic tool.

**Rationale:**

1. **Perfect fit for sequential validation** - Expense validation is a clear multi-step process
2. **Built-in resilience** - Each step (handbook query, DB query) automatically retries on failure
3. **Observable execution** - Each validation check is a named, trackable step
4. **State persistence** - Workflow maintains state across steps
5. **Simpler architecture** - No need for agent-to-agent communication patterns
6. **Matches Cloudflare's recommended pattern** - Workflows designed exactly for this use case

**Workflow Steps:**

1. Get employee info (DB query)
2. Query auto-approval limits (handbook search)
3. Check amount vs limit (validation logic)
4. Query receipt requirements (handbook search)
5. Check receipt provided (validation logic)
6. Query non-reimbursable items (handbook search)
7. Check for prohibited patterns (validation logic)
8. Query spending history (DB query)
9. Check daily limits (validation logic)
10. Make final decision (return result)

Each step is independently retryable and observable in Cloudflare Dashboard.
