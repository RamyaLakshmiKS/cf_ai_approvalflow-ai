# ApprovalFlow AI - Agentic Implementation Plan

## Cloudflare Agents SDK Architecture

> **Built on Cloudflare Agents SDK with Durable Objects, State Management, and SQL**

---

## Executive Summary

This implementation plan uses the **Cloudflare Agents SDK** to build a stateful AI agent that exhibits genuine agentic behavior through:

1. **State Management**: Automatic persistence and synchronization across sessions
2. **SQL Database**: Zero-latency embedded SQLite for data operations
3. **Scheduling**: Native task scheduling with cron and one-time triggers
4. **AI Integration**: Seamless Workers AI, OpenAI, and Anthropic support
5. **WebSocket & HTTP**: Real-time bidirectional communication

The agent demonstrates autonomy, multi-step problem solving, state persistence, and dynamic adaptation using Cloudflare's native infrastructure.

---

## Core Architecture: Cloudflare Agents SDK

```
┌─────────────────────────────────────────────────────────┐
│                    USER REQUEST                         │
│           "I need 5 days PTO next week"                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   Agent.onChatMessage()    │
        │   (AIChatAgent instance)   │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   AI Model Integration     │
        │   (Workers AI / OpenAI)    │
        │   - Multi-step reasoning   │
        │   - Tool calling           │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   Tool Execution           │
        │   - getCurrentUser()       │
        │   - searchHandbook()       │
        │   - validatePolicy()       │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   Agent SQL Database       │
        │   this.sql`SELECT...`      │
        │   (Embedded SQLite)        │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   State Management         │
        │   this.setState({...})     │
        │   (Auto-synced to clients) │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   Task Scheduling          │
        │   this.schedule(when, fn)  │
        │   (Cron or delayed tasks)  │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   Response Streaming       │
        │   (Server-Sent Events)     │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   Client (useAgent hook)   │
        │   - Auto state sync        │
        │   - WebSocket connection   │
        └────────────────────────────┘
```

**Cloudflare Services Integration:**

- **Agents SDK**: Base Agent and AIChatAgent classes with state, SQL, and scheduling
- **Employee Handbook**: Static markdown file loaded into LLM context for policy queries
- **D1 Database**: Optional external relational data (can use Agent SQL instead)
- **Workers AI / OpenAI**: LLM reasoning, response generation, and handbook analysis
- **Durable Objects**: Underlying infrastructure (Agent extends DO)

---

## Agent State & Data Model

The agent uses TypeScript type-safe state management:

```typescript
interface ApprovalAgentState {
  // User context
  userId?: string;
  username?: string;
  employeeLevel?: "junior" | "senior";
  managerId?: string;
  
  // Active request tracking
  activeRequest?: {
    type: "pto" | "expense";
    status: "gathering_info" | "validating" | "submitting" | "complete";
    startDate?: string;
    endDate?: string;
    amount?: number;
    category?: string;
  };
  
  // Conversation metadata
  conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
  }>;
  
  // Cached policy data
  policiesLoaded: boolean;
  lastPolicyUpdate?: number;
}
```

The agent persists this state automatically via `this.setState()` and can query it anytime with `this.state`.

### 1. Information Retrieval Methods

These methods can be exposed as tools to the AI model via AI SDK's tool calling:

#### `getCurrentUser()`

```typescript
// Exposed as a tool to AI models
const getCurrentUserTool = {
  description: "Retrieves the authenticated user's profile including ID, name, role, employee level, and manager.",
  parameters: z.object({}),
  execute: async () => {
    return await this.getCurrentUser();
  }
};

// Implementation in Agent class
private async getCurrentUser(): Promise<UserProfile> {
  // Query from Agent's embedded SQL database
  const result = await this.sql<UserProfile>`
    SELECT id, username, employee_level, manager_id, hire_date, department
    FROM users 
    WHERE id = ${this.state.userId}
  `;
  
  return result[0];
}
```

#### `searchEmployeeHandbook()`

```typescript
// Exposed as a tool to AI models
const searchHandbookTool = {
  description: "Searches the employee handbook to find relevant policies and rules. Use this for any policy-related questions or validations.",
  parameters: z.object({
    query: z.string().describe("Natural language query about company policies"),
    category: z.enum(["pto", "expenses", "benefits", "general"]).optional()
  }),
  execute: async ({ query, category }) => {
    return await this.searchEmployeeHandbook(query, category);
  }
};

// Implementation in Agent class
private handbookContent: string; // Loaded on agent initialization

private async searchEmployeeHandbook(
  query: string,
  category?: string
) {
  // Load handbook content (cached in agent state)
  if (!this.handbookContent) {
    // In production, load from R2, KV, or bundle with worker
    // For now, we'll assume it's loaded during agent initialization
    this.handbookContent = await this.loadHandbookContent();
  }

  // Use LLM to extract relevant sections from handbook
  const openai = createOpenAI({
    apiKey: this.env.OPENAI_API_KEY,
  });

  const prompt = `You are a policy expert. Given the following employee handbook and a user query, extract and return ONLY the relevant policy sections that answer the query.

# Employee Handbook
${this.handbookContent}

# User Query
${query}${category ? `\nCategory: ${category}` : ''}

# Instructions
Extract and return the exact relevant sections from the handbook that answer this query. Include section titles and full policy text. If multiple sections are relevant, include all of them.`;

  const result = await generateText({
    model: openai("gpt-4-turbo"),
    prompt,
    temperature: 0.1 // Low temperature for factual extraction
  });

  return {
    relevant_sections: result.text,
    query,
    category
  };
}

private async loadHandbookContent(): Promise<string> {
  // Option 1: Load from R2 bucket
  // const object = await this.env.HANDBOOK_BUCKET.get('employee_handbook.md');
  // return await object.text();
  
  // Option 2: Load from KV
  // return await this.env.HANDBOOK_KV.get('employee_handbook', 'text');
  
  // Option 3: Bundle with worker (for small handbooks)
  // import handbookContent from './employee_handbook.md';
  // return handbookContent;
  
  // For now, return placeholder
  return "Employee handbook content will be loaded here";
}
```

#### `getPTOBalance()`

```typescript
const getPTOBalanceTool = {
  description: "Retrieves the employee's current PTO balance, accrued days, used days, and rollover.",
  parameters: z.object({
    employeeId: z.string().optional().describe("Employee ID, defaults to current user")
  }),
  execute: async ({ employeeId }) => {
    return await this.getPTOBalance(employeeId);
  }
};

private async getPTOBalance(employeeId?: string): Promise<PTOBalance> {
  const userId = employeeId || this.state.userId;
  
  const result = await this.sql<PTOBalance>`
    SELECT 
      current_balance,
      total_accrued,
      total_used,
      rollover_from_previous_year
    FROM pto_balances 
    WHERE employee_id = ${userId}
  `;
  
  return result[0];
}
```

#### `check_blackout_periods`

```typescript
{
  name: "check_blackout_periods",
  description: "Checks if the requested dates overlap with company blackout periods (fiscal quarter ends, holidays).",
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
  returns: {
    has_conflict: "boolean",
    conflicting_periods: "array of {name, start_date, end_date, description}"
  }
}
```

#### `get_pto_history`

```typescript
{
  name: "get_pto_history",
  description: "Retrieves past PTO requests for the employee, including approved, denied, and pending requests.",
  parameters: {
    type: "object",
    properties: {
      employee_id: { type: "string" },
      limit: { type: "number", default: 10 },
      status_filter: { type: "string", enum: ["approved", "denied", "pending", "all"] }
    },
    required: []
  }
}
```

### 2. Calculation Tools

#### `calculate_business_days`

```typescript
{
  name: "calculate_business_days",
  description: "Calculates the number of business days (excluding weekends and holidays) between two dates.",
  parameters: {
    type: "object",
    properties: {
      start_date: { type: "string" },
      end_date: { type: "string" }
    },
    required: ["start_date", "end_date"]
  },
  returns: {
    business_days: "number",
    weekend_days: "number",
    holidays: "array of dates"
  }
}
```

**Implementation:**

```typescript
async function calculate_business_days(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Get company holidays in range
  const holidays = await this.env.APP_DB.prepare(
    `
    SELECT start_date FROM company_calendar 
    WHERE event_type = 'holiday' 
    AND start_date BETWEEN ? AND ?
  `
  )
    .bind(start, end)
    .all();

  const holidaySet = new Set(holidays.results.map((h) => h.start_date));

  let businessDays = 0;
  let weekendDays = 0;
  let current = new Date(startDate);

  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().split("T")[0];

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      weekendDays++;
    } else if (!holidaySet.has(dateStr)) {
      businessDays++;
    }

    current.setDate(current.getDate() + 1);
  }

  return {
    business_days: businessDays,
    weekend_days: weekendDays,
    holidays: Array.from(holidaySet)
  };
}
```

#### `calculate_pto_accrual`

```typescript
{
  name: "calculate_pto_accrual",
  description: "Calculates the PTO accrued for an employee based on their hire date and employee level.",
  parameters: {
    type: "object",
    properties: {
      employee_id: { type: "string" },
      as_of_date: { type: "string", description: "Calculate accrual up to this date (defaults to today)" }
    },
    required: ["employee_id"]
  }
}
```

### 3. Policy Validation Tools

#### `validate_pto_policy`

```typescript
{
  name: "validate_pto_policy",
  description: "Validates a PTO request against all company policies: balance, blackouts, auto-approval limits.",
  parameters: {
    type: "object",
    properties: {
      employee_id: { type: "string" },
      start_date: { type: "string" },
      end_date: { type: "string" },
      reason: { type: "string" }
    },
    required: ["employee_id", "start_date", "end_date"]
  },
  returns: {
    is_valid: "boolean",
    can_auto_approve: "boolean",
    requires_escalation: "boolean",
    violations: "array of {policy, message}",
    recommendation: "string"
  }
}
```

**Implementation (Core Policy Engine):**

```typescript
async function validate_pto_policy(params: PTOValidationParams) {
  const violations = [];

  // Get employee info
  const employee = await this.get_employee(params.employee_id);
  const balance = await this.get_pto_balance(params.employee_id);
  const businessDays = await this.calculate_business_days(
    params.start_date,
    params.end_date
  );

  // Rule 1: Sufficient balance
  if (balance.current_balance < businessDays.business_days) {
    violations.push({
      policy: "insufficient_balance",
      message: `Insufficient PTO. You have ${balance.current_balance} days but need ${businessDays.business_days} days.`
    });
  }

  // Rule 2: No blackout conflicts
  const blackouts = await this.check_blackout_periods(
    params.start_date,
    params.end_date
  );
  if (blackouts.has_conflict) {
    violations.push({
      policy: "blackout_conflict",
      message: `Request overlaps with blackout period: ${blackouts.conflicting_periods[0].name}`
    });
  }

  // Rule 3: Auto-approval threshold
  const autoApprovalLimit = employee.employee_level === "senior" ? 10 : 3;
  const canAutoApprove =
    businessDays.business_days <= autoApprovalLimit && violations.length === 0;
  const requiresEscalation =
    businessDays.business_days > autoApprovalLimit && violations.length === 0;

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
```

#### `validate_expense_policy`

```typescript
{
  name: "validate_expense_policy",
  description: "Validates an expense request against company policies: amount limits, receipt requirements, category rules.",
  parameters: {
    type: "object",
    properties: {
      employee_id: { type: "string" },
      amount: { type: "number" },
      category: { type: "string", enum: ["travel", "meals", "home_office", "training"] },
      has_receipt: { type: "boolean" },
      description: { type: "string" }
    },
    required: ["employee_id", "amount", "category"]
  }
}
```

### 4. Action Execution Tools

#### `submit_pto_request`

```typescript
{
  name: "submit_pto_request",
  description: "Submits a PTO request to the database after validation. Sets status based on auto-approval or escalation.",
  parameters: {
    type: "object",
    properties: {
      employee_id: { type: "string" },
      start_date: { type: "string" },
      end_date: { type: "string" },
      total_days: { type: "number" },
      reason: { type: "string" },
      status: { type: "string", enum: ["auto_approved", "pending", "denied"] },
      approval_type: { type: "string", enum: ["auto", "manual"] },
      validation_notes: { type: "string" }
    },
    required: ["employee_id", "start_date", "end_date", "total_days", "status"]
  },
  returns: {
    request_id: "string",
    status: "string",
    message: "string"
  }
}
```

#### `escalate_to_manager`

```typescript
{
  name: "escalate_to_manager",
  description: "Escalates a request to the employee's manager and sends a notification.",
  parameters: {
    type: "object",
    properties: {
      request_id: { type: "string" },
      request_type: { type: "string", enum: ["pto", "expense"] },
      employee_id: { type: "string" },
      reason: { type: "string" }
    },
    required: ["request_id", "request_type", "employee_id"]
  }
}
```

#### `update_pto_balance`

```typescript
{
  name: "update_pto_balance",
  description: "Updates the employee's PTO balance after approval (deducts used days).",
  parameters: {
    type: "object",
    properties: {
      employee_id: { type: "string" },
      days_to_deduct: { type: "number" },
      request_id: { type: "string" }
    },
    required: ["employee_id", "days_to_deduct"]
  }
}
```

#### `log_audit_event`

```typescript
{
  name: "log_audit_event",
  description: "Logs an action to the audit trail for compliance and tracking.",
  parameters: {
    type: "object",
    properties: {
      entity_type: { type: "string" },
      entity_id: { type: "string" },
      action: { type: "string" },
      actor_id: { type: "string" },
      actor_type: { type: "string", enum: ["user", "ai_agent", "system"] },
      details: { type: "object" }
    },
    required: ["entity_type", "entity_id", "action"]
  }
}
```

### 5. Communication Tools

#### `send_notification`

```typescript
{
  name: "send_notification",
  description: "Sends a notification to a user (manager or employee) about request status.",
  parameters: {
    type: "object",
    properties: {
      recipient_id: { type: "string" },
      subject: { type: "string" },
      message: { type: "string" },
      notification_type: { type: "string", enum: ["approval_needed", "request_approved", "request_denied"] }
    },
    required: ["recipient_id", "message"]
  }
}
```

---

## Main Agent Implementation (Cloudflare Agents SDK)

```typescript
// src/agents/approval-agent.ts
import { Agent } from "agents";
import { z } from "zod";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

interface Env {
  // Cloudflare bindings
  AI: Ai;
  HANDBOOK_BUCKET?: R2Bucket; // Optional: for R2 storage
  HANDBOOK_KV?: KVNamespace; // Optional: for KV storage
  // Agent binding (auto-provided by Agents SDK)
  APPROVAL_AGENT: AgentNamespace<ApprovalAgent>;
  // Secrets
  OPENAI_API_KEY: string;
}

interface ApprovalAgentState {
  userId?: string;
  username?: string;
  employeeLevel?: "junior" | "senior";
  managerId?: string;
  
  activeRequest?: {
    type: "pto" | "expense";
    status: "gathering_info" | "validating" | "submitting" | "complete";
    startDate?: string;
    endDate?: string;
    amount?: number;
    category?: string;
  };
  
  requestHistory: Array<{
    id: string;
    type: string;
    status: string;
    timestamp: number;
  }>;
}

export class ApprovalAgent extends Agent<Env, ApprovalAgentState> {
  // Initialize agent state
  initialState: ApprovalAgentState = {
    requestHistory: []
  };
  
  // Handle HTTP requests
  async onRequest(request: Request) {
    const url = new URL(request.url);
    
    // Example: GET /pto/balance
    if (url.pathname === "/pto/balance") {
      const balance = await this.getPTOBalance();
      return Response.json(balance);
    }
    
    return new Response("Not found", { status: 404 });
  }
  
  // Handle WebSocket connections
  async onConnect(connection: Connection) {
    // Initialize user session from connection
    const userId = this.getUserIdFromConnection(connection);
    
    // Load user profile and update state
    const user = await this.getCurrentUser(userId);
    
    this.setState({
      ...this.state,
      userId: user.id,
      username: user.username,
      employeeLevel: user.employee_level,
      managerId: user.manager_id
    });
    
    connection.accept();
    
    // Send welcome message
    connection.send(JSON.stringify({
      type: "welcome",
      message: `Hello ${user.username}! I'm here to help with PTO requests and expenses.`
    }));
  }
  
  // Handle incoming messages (main chat interface)
  async onMessage(connection: Connection, message: string | ArrayBuffer) {
    const userMessage = typeof message === "string" ? message : new TextDecoder().decode(message);
    
    try {
      // Parse user intent and generate AI response with tool calling
      const response = await this.processUserMessage(userMessage);
      
      // Send response back to client
      connection.send(JSON.stringify({
        type: "message",
        content: response
      }));
      
    } catch (error) {
      console.error("Error processing message:", error);
      connection.send(JSON.stringify({
        type: "error",
        message: "Sorry, I encountered an error processing your request."
      }));
    }
  }
  
  // Core AI processing with tool calling
  private async processUserMessage(userMessage: string): Promise<string> {
    const openai = createOpenAI({
      apiKey: this.env.OPENAI_API_KEY,
    });
    
    // Define tools for AI model
    const tools = {
      getCurrentUser: {
        description: "Get current user's profile and permissions",
        parameters: z.object({}),
        execute: async () => await this.getCurrentUser()
      },
      
      searchHandbook: {
        description: "Search employee handbook for policies",
        parameters: z.object({
          query: z.string(),
          category: z.enum(["pto", "expenses", "benefits", "general"]).optional()
        }),
        execute: async ({ query, category }) => 
          await this.searchEmployeeHandbook(query, category)
      },
      
      getPTOBalance: {
        description: "Get PTO balance for user",
        parameters: z.object({
          employeeId: z.string().optional()
        }),
        execute: async ({ employeeId }) => await this.getPTOBalance(employeeId)
      },
      
      calculateBusinessDays: {
        description: "Calculate business days between dates",
        parameters: z.object({
          startDate: z.string(),
          endDate: z.string()
        }),
        execute: async ({ startDate, endDate }) => 
          await this.calculateBusinessDays(startDate, endDate)
      },
      
      validatePTOPolicy: {
        description: "Validate PTO request against policies",
        parameters: z.object({
          startDate: z.string(),
          endDate: z.string(),
          reason: z.string().optional()
        }),
        execute: async (params) => await this.validatePTOPolicy(params)
      },
      
      submitPTORequest: {
        description: "Submit PTO request to database",
        parameters: z.object({
          startDate: z.string(),
          endDate: z.string(),
          totalDays: z.number(),
          reason: z.string(),
          status: z.enum(["auto_approved", "pending", "denied"])
        }),
        execute: async (params) => await this.submitPTORequest(params)
      },
      
      scheduleFollowUp: {
        description: "Schedule a follow-up task",
        parameters: z.object({
          when: z.string().describe("Delay like '1 hour' or cron '0 9 * * *'"),
          taskName: z.string(),
          data: z.record(z.any())
        }),
        execute: async ({ when, taskName, data }) => {
          await this.schedule(when, taskName, data);
          return { scheduled: true, task: taskName };
        }
      }
    };
    
    // Generate response with tool calling
    const result = await generateText({
      model: openai("gpt-4-turbo"),
      system: this.getSystemPrompt(),
      messages: [
        { role: "user", content: userMessage }
      ],
      tools,
      maxToolRoundtrips: 5, // Allow multi-step tool usage
    });
    
    // Update state with conversation history
    this.setState({
      ...this.state,
      requestHistory: [
        ...this.state.requestHistory,
        {
          id: crypto.randomUUID(),
          type: "chat",
          status: "complete",
          timestamp: Date.now()
        }
      ]
    });
    
    return result.text;
  }
  
  // System prompt for AI model
  private getSystemPrompt(): string {
    return `You are ApprovalFlow AI, an intelligent agent helping employees with PTO requests and expense reimbursements.

Current User Context:
- Name: ${this.state.username}
- Level: ${this.state.employeeLevel}
- Manager ID: ${this.state.managerId}

Your Capabilities:
1. **Query employee handbook** using LLM-based retrieval for current policies (ALWAYS do this before making policy decisions)
2. **Check PTO balances** and validate requests
3. **Calculate business days** excluding weekends/holidays
4. **Validate policies** against handbook rules
5. **Submit requests** with auto-approval or escalation
6. **Schedule follow-ups** for pending requests

Important Guidelines:
- Always query the handbook first for policy information (don't guess or hallucinate policies)
- The handbook is provided as context - extract exact policy text, don't paraphrase
- Be friendly, clear, and concise
- For PTO requests:
  * Junior employees: auto-approve up to 3 days
  * Senior employees: auto-approve up to 10 days
  * Above limits: escalate to manager
- Explain policy violations clearly by citing specific handbook sections
- Always confirm actions before executing

Think step-by-step and use tools to gather accurate information.`;
  }
  
  // Tool Implementation: Get Current User
  private async getCurrentUser(userId?: string): Promise<any> {
    const uid = userId || this.state.userId;
    
    const result = await this.sql<any>`
      SELECT id, username, employee_level, manager_id, hire_date, department
      FROM users 
      WHERE id = ${uid}
    `;
    
    return result[0];
  }
  
  // Tool Implementation: Search Handbook
  private async searchEmployeeHandbook(query: string, category?: string) {
    // Load handbook if not cached
    if (!this.handbookContent) {
      this.handbookContent = await this.loadHandbookContent();
    }

    // Use LLM to extract relevant sections
    const openai = createOpenAI({
      apiKey: this.env.OPENAI_API_KEY,
    });

    const result = await generateText({
      model: openai("gpt-4-turbo"),
      prompt: `Extract relevant policy sections from this handbook:\n\n${this.handbookContent}\n\nQuery: ${query}\nCategory: ${category || 'any'}`,
      temperature: 0.1
    });

    return {
      relevant_sections: result.text,
      query,
      category
    };
  }
  
  // Tool Implementation: Get PTO Balance
  private async getPTOBalance(employeeId?: string) {
    const uid = employeeId || this.state.userId;
    
    const result = await this.sql<any>`
      SELECT current_balance, total_accrued, total_used, rollover_from_previous_year
      FROM pto_balances 
      WHERE employee_id = ${uid}
    `;
    
    return result[0];
  }
  
  // Tool Implementation: Calculate Business Days
  private async calculateBusinessDays(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Get holidays from agent SQL
    const holidays = await this.sql<{ start_date: string }>`
      SELECT start_date 
      FROM company_calendar 
      WHERE event_type = 'holiday' 
        AND start_date BETWEEN ${startDate} AND ${endDate}
    `;
    
    const holidaySet = new Set(holidays.map(h => h.start_date));
    
    let businessDays = 0;
    let weekendDays = 0;
    const current = new Date(start);
    
    while (current <= end) {
      const day = current.getDay();
      const dateStr = current.toISOString().split("T")[0];
      
      if (day === 0 || day === 6) {
        weekendDays++;
      } else if (!holidaySet.has(dateStr)) {
        businessDays++;
      }
      
      current.setDate(current.getDate() + 1);
    }
    
    return { businessDays, weekendDays, holidays: Array.from(holidaySet) };
  }
  
  // Tool Implementation: Validate PTO Policy
  private async validatePTOPolicy(params: {
    startDate: string;
    endDate: string;
    reason?: string;
  }) {
    const violations = [];
    
    // Get balance
    const balance = await this.getPTOBalance();
    const { businessDays } = await this.calculateBusinessDays(params.startDate, params.endDate);
    
    // Check balance
    if (balance.current_balance < businessDays) {
      violations.push({
        policy: "insufficient_balance",
        message: `Insufficient PTO. You have ${balance.current_balance} days but need ${businessDays} days.`
      });
    }
    
    // Check blackouts
    const blackouts = await this.sql<any>`
      SELECT * FROM company_calendar 
      WHERE event_type = 'blackout'
        AND ((start_date BETWEEN ${params.startDate} AND ${params.endDate})
          OR (end_date BETWEEN ${params.startDate} AND ${params.endDate}))
    `;
    
    if (blackouts.length > 0) {
      violations.push({
        policy: "blackout_conflict",
        message: `Request overlaps with blackout period: ${blackouts[0].name}`
      });
    }
    
    // Determine auto-approval
    const limit = this.state.employeeLevel === "senior" ? 10 : 3;
    const canAutoApprove = businessDays <= limit && violations.length === 0;
    const requiresEscalation = businessDays > limit && violations.length === 0;
    
    return {
      isValid: violations.length === 0,
      canAutoApprove,
      requiresEscalation,
      violations,
      recommendation: canAutoApprove ? "AUTO_APPROVE" : 
                     requiresEscalation ? "ESCALATE" : "DENY"
    };
  }
  
  // Tool Implementation: Submit PTO Request
  private async submitPTORequest(params: {
    startDate: string;
    endDate: string;
    totalDays: number;
    reason: string;
    status: string;
  }) {
    const requestId = crypto.randomUUID();
    
    await this.sql`
      INSERT INTO pto_requests (
        id, employee_id, manager_id, start_date, end_date,
        total_days, reason, status, approval_type, created_at
      ) VALUES (
        ${requestId}, ${this.state.userId}, ${this.state.managerId},
        ${params.startDate}, ${params.endDate}, ${params.totalDays},
        ${params.reason}, ${params.status}, 'auto', ${Date.now()}
      )
    `;
    
    // If auto-approved, update balance
    if (params.status === "auto_approved") {
      await this.sql`
        UPDATE pto_balances 
        SET current_balance = current_balance - ${params.totalDays}
        WHERE employee_id = ${this.state.userId}
      `;
    }
    
    // Update state
    this.setState({
      ...this.state,
      activeRequest: {
        type: "pto",
        status: "complete",
        startDate: params.startDate,
        endDate: params.endDate
      }
    });
    
    return {
      requestId,
      status: params.status,
      message: "Request submitted successfully"
    };
  }
  
  // Handle state updates (called automatically when setState is used)
  onStateUpdate(state: ApprovalAgentState, source: string) {
    console.log("State updated:", { state, source });
  }
  
  // Scheduled task handler (called by this.schedule)
  async checkPendingRequests(data: any) {
    const pending = await this.sql<any>`
      SELECT * FROM pto_requests 
      WHERE status = 'pending' 
        AND employee_id = ${this.state.userId}
    `;
    
    // Send reminder if any pending
    if (pending.length > 0) {
      console.log(`User has ${pending.length} pending requests`);
    }
  }
  
  // Helper to extract user ID from connection metadata
  private getUserIdFromConnection(connection: Connection): string {
    // In real implementation, extract from connection state or auth token
    return connection.id;
  }
}

// Export worker handler with routing
export default {
  async fetch(request: Request, env: Env) {
    // Use routeAgentRequest for automatic routing to /agents/:agent/:name
    const agentResponse = await routeAgentRequest(request, env);
    
    if (agentResponse) {
      return agentResponse;
    }
    
    // Fallback for other routes
    return Response.json({ message: "ApprovalFlow AI Agent" });
  }
} satisfies ExportedHandler<Env>;
```

---

## Configuration (wrangler.jsonc)

```jsonc
{
  "name": "approvalflow-ai",
  "main": "src/index.ts",
  "compatibility_date": "2025-02-11",
  "compatibility_flags": ["nodejs_compat"],
  
  "durable_objects": {
    "bindings": [
      {
        "name": "APPROVAL_AGENT",
        "class_name": "ApprovalAgent"
      }
    ]
  },
  
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["ApprovalAgent"]
    }
  ],
  
  "r2_buckets": [
    {
      "binding": "HANDBOOK_BUCKET",
      "bucket_name": "employee-handbook",
      "preview_bucket_name": "employee-handbook-preview"
    }
  ],
  
  "ai": {
    "binding": "AI"
  },
  
  "vars": {
    "HANDBOOK_PATH": "docs/employee_handbook.md"
  },
  
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

---

## Client Integration (React)

Using the `useAgent` hook from `agents/react`:

```typescript
// src/components/ApprovalChat.tsx
import { useAgent } from "agents/react";
import { useState } from "react";

export function ApprovalChat() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  
  // Connect to agent with automatic state sync
  const agent = useAgent({
    agent: "approval-agent",
    name: "user-123", // Unique per user
    
    onMessage: (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "message") {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: data.content
        }]);
      }
    },
    
    onStateUpdate: (newState) => {
      console.log("Agent state updated:", newState);
      // Update UI based on agent state
    },
    
    onOpen: () => console.log("Connected to agent"),
    onClose: () => console.log("Disconnected from agent")
  });
  
  const sendMessage = () => {
    if (!message.trim()) return;
    
    // Add to local messages
    setMessages(prev => [...prev, {
      role: "user",
      content: message
    }]);
    
    // Send to agent
    agent.send(message);
    setMessage("");
  };
  
  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>
      
      <div className="input-area">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask about PTO or expenses..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
      
      {/* Display agent state */}
      {agent.state?.activeRequest && (
        <div className="active-request">
          Processing {agent.state.activeRequest.type} request...
        </div>
      )}
    </div>
  );
}
```

---

## Key Agentic Behaviors Demonstrated

### 1. **Stateful Persistence**

Agent state survives restarts and syncs across all client connections:

```typescript
// State is automatically persisted
this.setState({
  activeRequest: {
    type: "pto",
    status: "validating",
    startDate: "2025-12-20"
  }
});

// Available immediately on reconnect
console.log(this.state.activeRequest); // Persisted!
```

### 2. **Multi-Step Tool Orchestration**

AI model autonomously chains multiple tools:

```
User: "Book me 5 days off next week"
  ↓
AI calls: getCurrentUser() → returns junior employee
  ↓
AI calls: searchHandbook("PTO approval limits") → returns "3 days for junior"
  ↓
AI calls: calculateBusinessDays() → returns 5 days
  ↓
AI calls: validatePTOPolicy() → returns "ESCALATE"
  ↓
AI response: "Your 5-day request exceeds the 3-day auto-approval limit and will be sent to your manager."
```

### 3. **Task Scheduling**

Native support for delayed and recurring tasks:

```typescript
// Schedule follow-up in 1 hour
await this.schedule("1 hour", "checkPendingRequests", { userId: "123" });

// Schedule daily reminder at 9am
await this.schedule("0 9 * * *", "sendDailyReminder", {});

// Handler is called automatically
async checkPendingRequests(data: any) {
  const pending = await this.sql`SELECT * FROM pto_requests WHERE status = 'pending'`;
  // Send notifications...
}
```

### 4. **Zero-Latency SQL**

Embedded SQLite database with type-safe queries:

```typescript
// Type-safe query
const users = await this.sql<User>`
  SELECT * FROM users WHERE employee_level = ${'junior'}
`;

// Transactions are automatic
await this.sql`
  UPDATE pto_balances SET current_balance = current_balance - ${days}
  WHERE employee_id = ${userId}
`;
```

### 5. **Real-Time State Sync**

State changes automatically broadcast to all clients:

```typescript
// In agent
this.setState({ requestCount: this.state.requestCount + 1 });

// In React client (useAgent hook)
onStateUpdate: (newState) => {
  console.log("New request count:", newState.requestCount);
  // UI updates automatically
}
```

---

## Success Metrics for Agentic Behavior

| Metric                       | Target | Measurement                                 |
| ---------------------------- | ------ | ------------------------------------------- |
| **Tool Usage Rate**          | >80%   | Percentage of requests using ≥2 tools       |
| **Multi-Step Planning**      | >60%   | Requests requiring 3+ sequential tool calls |
| **Adaptive Decisions**       | >90%   | Correct routing (approve/deny/escalate)     |
| **Handbook Search Accuracy** | >95%   | Correct policy retrieval from vector search |
| **State Persistence**        | 100%   | Zero data loss across agent restarts        |
| **Response Latency**         | <2s    | P95 latency for simple requests             |
| **Response Accuracy**        | >95%   | Correct policy interpretation               |

---

## Implementation Phases

### Phase 1: Agent Infrastructure (Week 1)

- [ ] Set up Cloudflare Agents SDK project structure
- [ ] Configure Durable Objects bindings for Agent
- [ ] Load employee handbook into R2 bucket or bundle with worker
- [ ] Implement Agent class with basic lifecycle methods
- [ ] Add embedded SQL schema migrations
- [ ] Create Wrangler configuration with proper bindings
- [ ] Test handbook loading and LLM-based retrieval

### Phase 2: Tool Implementation (Week 2)

- [ ] Implement core tool methods (getCurrentUser, getPTOBalance, etc.)
- [ ] Build LLM-based handbook query method
- [ ] Build policy validation engine
- [ ] Implement business days calculation with holidays
- [ ] Add audit logging to agent SQL
- [ ] Test each tool independently with sample data

### Phase 3: AI Integration (Week 3)

- [ ] Integrate AI SDK with tool calling
- [ ] Configure Workers AI or OpenAI for LLM reasoning
- [ ] Build system prompts for PTO use case
- [ ] Implement streaming responses
- [ ] Add error handling and retry logic
- [ ] Test multi-step tool orchestration

### Phase 4: Client & Scheduling (Week 4)

- [ ] Build React client with useAgent hook
- [ ] Implement WebSocket connection handling
- [ ] Add state synchronization to UI
- [ ] Implement task scheduling (reminders, follow-ups)
- [ ] Add comprehensive logging and observability
- [ ] Deploy and test end-to-end workflows

---

## Technical Implementation Details

### State Management Pattern

```typescript
// State is automatically persisted and synced
interface AgentState {
  // User context
  userId: string;
  
  // Active requests
  activeRequest?: PendingRequest;
  
  // History
  requestHistory: Request[];
}

// Update state (triggers onStateUpdate on all clients)
this.setState({
  ...this.state,
  activeRequest: { type: "pto", status: "pending" }
});

// State survives agent restarts
// State syncs to all connected clients automatically
```

### SQL Database Pattern

```typescript
// Create tables in agent initialization
async onStart() {
  await this.sql`
    CREATE TABLE IF NOT EXISTS pto_requests (
      id TEXT PRIMARY KEY,
      employee_id TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT,
      created_at INTEGER
    )
  `;
}

// Type-safe queries with generics
const requests = await this.sql<PTORequest>`
  SELECT * FROM pto_requests 
  WHERE employee_id = ${userId}
  ORDER BY created_at DESC
`;
```

### Scheduling Pattern

```typescript
// One-time delay
await this.schedule("1 hour", "followUp", { requestId: "123" });

// Recurring cron
await this.schedule("0 9 * * *", "dailyDigest", {});

// Handler
async followUp(data: { requestId: string }) {
  const request = await this.sql`SELECT * FROM pto_requests WHERE id = ${data.requestId}`;
  // Process...
}

// Cancel scheduled task
const { id } = await this.schedule("1 day", "reminder", {});
await this.cancelSchedule(id);
```

### Tool Calling with AI SDK

```typescript
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const tools = {
  searchHandbook: {
    description: "Search employee handbook",
    parameters: z.object({
      query: z.string()
    }),
    execute: async ({ query }) => await this.searchEmployeeHandbook(query)
  }
};

const result = await generateText({
  model: openai("gpt-4-turbo"),
  system: "You are ApprovalFlow AI...",
  messages: [{ role: "user", content: userMessage }],
  tools,
  maxToolRoundtrips: 5 // Allow multi-step reasoning
});
```

---

## Employee Handbook Loading & LLM-Based Retrieval

### Approach

Instead of using vector embeddings and semantic search, we use the LLM directly to extract relevant policy information from the handbook. This approach:

- **Simpler**: No vector database setup or embedding generation
- **Faster to implement**: Just load markdown file and pass to LLM
- **Accurate**: Modern LLMs excel at information extraction from documents
- **Cost-effective**: No separate embedding costs

### Setup Options

#### Option 1: Bundle with Worker (Recommended for small handbooks)

```typescript
// src/employee_handbook.ts
export const EMPLOYEE_HANDBOOK = `
# Cloudflare Employee Handbook
...
`;

// In agent class
import { EMPLOYEE_HANDBOOK } from './employee_handbook';

private handbookContent = EMPLOYEE_HANDBOOK;
```

#### Option 2: Store in R2 Bucket (Recommended for larger handbooks)

```bash
# Upload handbook to R2
wrangler r2 object put employee-handbook/handbook.md --file=docs/employee_handbook.md
```

```typescript
// In agent class
private async loadHandbookContent(): Promise<string> {
  const object = await this.env.HANDBOOK_BUCKET.get('handbook.md');
  if (!object) throw new Error('Handbook not found');
  return await object.text();
}
```

#### Option 3: Store in Workers KV (Alternative)

```bash
# Upload to KV
wrangler kv:key put --binding=HANDBOOK_KV "employee_handbook" --path=docs/employee_handbook.md
```

```typescript
private async loadHandbookContent(): Promise<string> {
  const content = await this.env.HANDBOOK_KV.get('employee_handbook', 'text');
  if (!content) throw new Error('Handbook not found');
  return content;
}
```

### LLM-Based Policy Extraction

```typescript
private async searchEmployeeHandbook(query: string, category?: string) {
  // Cache handbook in agent state for performance
  if (!this.handbookContent) {
    this.handbookContent = await this.loadHandbookContent();
  }

  const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });

  const result = await generateText({
    model: openai("gpt-4-turbo"),
    prompt: `You are a policy expert. Extract relevant sections from this handbook:

${this.handbookContent}

Query: ${query}
Category: ${category || 'any'}

Return ONLY the exact policy text that answers the query. Include section titles.`,
    temperature: 0.1 // Low temperature for factual extraction
  });

  return {
    relevant_sections: result.text,
    query,
    category
  };
}
```

### Performance Optimization

1. **Cache handbook in agent state**: Load once per agent instance
2. **Use streaming for long handbooks**: Stream LLM response for better UX
3. **Implement handbook versioning**: Store version in agent state to detect updates

```typescript
interface AgentState {
  // ... other state
  handbookVersion?: string;
  handbookLastLoaded?: number;
}

// Reload if handbook updated
if (this.shouldReloadHandbook()) {
  this.handbookContent = await this.loadHandbookContent();
  this.setState({
    ...this.state,
    handbookVersion: '2025-01-15',
    handbookLastLoaded: Date.now()
  });
}
```

### Configuration

```jsonc
// wrangler.jsonc
{
  "r2_buckets": [
    {
      "binding": "HANDBOOK_BUCKET",
      "bucket_name": "employee-handbook"
    }
  ],
  // OR for KV
  "kv_namespaces": [
    {
      "binding": "HANDBOOK_KV",
      "id": "your-kv-namespace-id"
    }
  ]
}
```

---

## Advantages of Cloudflare Agents SDK

| Feature                  | Custom ReAct Implementation | Cloudflare Agents SDK       |
| ------------------------ | --------------------------- | --------------------------- |
| **State Management**     | Manual with Durable Storage | Automatic with `setState()` |
| **SQL Database**         | Requires D1 binding         | Embedded SQLite built-in    |
| **Scheduling**           | Manual with Alarms API      | Native `schedule()` method  |
| **Client Sync**          | Custom WebSocket logic      | Auto-sync with `useAgent`   |
| **Type Safety**          | Manual typing               | Full TypeScript support     |
| **Tool Calling**         | Custom prompt engineering   | AI SDK integration          |
| **Session Management**   | Manual connection tracking  | Built-in connection API     |
| **Development Velocity** | Slower, more boilerplate    | Faster, less code           |

---

## Migration from Custom ReAct to Agents SDK

For existing custom implementations:

1. **Replace base class**: Change from `DurableObject` to `Agent<Env, State>`
2. **Replace storage**: Migrate from `this.ctx.storage` to `this.setState()` and `this.sql`
3. **Replace WebSocket handlers**: Use `onConnect`, `onMessage`, `onClose` lifecycle methods
4. **Replace tool execution**: Use AI SDK tool calling instead of custom parsing
5. **Add scheduling**: Replace manual alarms with `this.schedule()`
6. **Update client**: Use `useAgent` hook instead of custom WebSocket client

---

## Next Steps

1. **Initialize project structure** with Agents SDK
2. **Load employee handbook** into R2, KV, or bundle with worker
3. **Implement Agent class** with core lifecycle methods
4. **Add embedded SQL schema** for users, balances, requests
5. **Build tool methods** for PTO operations
6. **Integrate AI SDK** with tool calling
7. **Create React client** with useAgent hook
8. **Test end-to-end** PTO request workflow
9. **Add scheduling** for reminders and follow-ups
10. **Deploy and monitor** with observability

---

## References

- [Cloudflare Agents SDK Documentation](https://developers.cloudflare.com/agents/)
- [Agents SDK GitHub](https://github.com/cloudflare/agents-sdk)
- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare R2 Storage](https://developers.cloudflare.com/r2/)
- [Cloudflare Workers KV](https://developers.cloudflare.com/kv/)
