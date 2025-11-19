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
- **Vectorize**: Semantic search of employee handbook for policy rules
- **D1 Database**: Optional external relational data (can use Agent SQL instead)
- **Workers AI**: LLM reasoning and response generation
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
  description: "Searches the employee handbook using semantic search to find relevant policies and rules. Use this for any policy-related questions or validations.",
  parameters: z.object({
    query: z.string().describe("Natural language query about company policies"),
    category: z.enum(["pto", "expenses", "benefits", "general"]).optional(),
    topK: z.number().default(5)
  }),
  execute: async ({ query, category, topK }) => {
    return await this.searchEmployeeHandbook(query, category, topK);
  }
};

// Implementation in Agent class
private async searchEmployeeHandbook(
  query: string,
  category?: string,
  topK: number = 5
) {
  // Generate embedding using Workers AI binding
  const queryEmbedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query]
  });

  // Build Vectorize query
  const vectorQuery: any = {
    vector: queryEmbedding.data[0],
    topK,
    returnValues: true,
    returnMetadata: "all"
  };

  if (category) {
    vectorQuery.filter = { category };
  }

  // Search the handbook vector index
  const results = await this.env.HANDBOOK_VECTORS.query(vectorQuery.vector, vectorQuery);

  return {
    results: results.matches.map(match => ({
      content: match.values,
      score: match.score,
      metadata: match.metadata
    })),
    total_found: results.matches.length
  };
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
  HANDBOOK_VECTORS: VectorizeIndex;
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
1. **Search employee handbook** for current policies (ALWAYS do this before making policy decisions)
2. **Check PTO balances** and validate requests
3. **Calculate business days** excluding weekends/holidays
4. **Validate policies** against handbook rules
5. **Submit requests** with auto-approval or escalation
6. **Schedule follow-ups** for pending requests

Important Guidelines:
- Always search the handbook first for policy information (don't guess)
- Be friendly, clear, and concise
- For PTO requests:
  * Junior employees: auto-approve up to 3 days
  * Senior employees: auto-approve up to 10 days
  * Above limits: escalate to manager
- Explain policy violations clearly
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
    // Generate embedding
    const embedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [query]
    });
    
    // Query Vectorize
    const vectorQuery: any = {
      vector: embedding.data[0],
      topK: 5,
      returnValues: true,
      returnMetadata: "all"
    };
    
    if (category) {
      vectorQuery.filter = { category };
    }
    
    const results = await this.env.HANDBOOK_VECTORS.query(
      vectorQuery.vector, 
      vectorQuery
    );
    
    return {
      results: results.matches.map(m => ({
        content: m.values,
        score: m.score,
        metadata: m.metadata
      }))
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
  
  "vectorize": [
    {
      "binding": "HANDBOOK_VECTORS",
      "index_name": "handbook_vectors"
    }
  ],
  
  "ai": {
    "binding": "AI"
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
- [ ] Set up Vectorize index for employee handbook
- [ ] Implement Agent class with basic lifecycle methods
- [ ] Add embedded SQL schema migrations
- [ ] Create Wrangler configuration with proper bindings
- [ ] Validate Wrangler version (>=3.71.0)

### Phase 2: Tool Implementation (Week 2)

- [ ] Implement core tool methods (getCurrentUser, getPTOBalance, etc.)
- [ ] Add Vectorize integration for handbook search
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

## Vectorize Configuration for Employee Handbook

### Setup Steps

1. **Create Vectorize Index**:

   ```bash
   npx wrangler vectorize create handbook_vectors --dimensions=768 --metric=cosine
   ```

2. **Configure in wrangler.jsonc**:

   ```jsonc
   {
     "vectorize": [
       {
         "binding": "HANDBOOK_VECTORS",
         "index_name": "handbook_vectors"
       }
     ]
   }
   ```

3. **Populate Handbook Data**:
   - Chunk the employee handbook into sections
   - Generate embeddings using `@cf/baai/bge-base-en-v1.5`
   - Insert vectors with metadata (section, category, last_updated)

### Caveats & Best Practices

- **Wrangler version**: Requires Wrangler 3.71.0+ for Vectorize V2
- **Model dimensions**: Use 768 dimensions for `@cf/baai/bge-base-en-v1.5`
- **Use `upsert`**: For idempotent re-ingestions
- **Batch processing**: Process in batches of 100 vectors to avoid timeouts
- **Metadata filtering**: Store and filter by `category`, `section`, `last_updated`
- **Error handling**: Wrap operations in try/catch with retry logic
- **Testing**: Add validation queries after ingestion

### Example Ingestion

```typescript
async function populateHandbookVectors(env: Env, chunks: HandbookChunk[]) {
  const BATCH_SIZE = 100;
  const model = "@cf/baai/bge-base-en-v1.5";

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    
    try {
      // Generate embeddings
      const texts = batch.map(c => c.content);
      const embeddingResp = await env.AI.run(model, { text: texts });
      
      // Prepare vectors
      const vectors = embeddingResp.data[0].map((vector, idx) => ({
        id: batch[idx].id,
        values: vector,
        metadata: batch[idx].metadata
      }));
      
      // Upsert to Vectorize
      await env.HANDBOOK_VECTORS.upsert(vectors);
      console.log(`Inserted batch ${i / BATCH_SIZE + 1}`);
      
    } catch (err) {
      console.error(`Failed to insert batch:`, err);
      // Implement retry logic here
    }
  }
}
```

### Handbook Data Structure

```typescript
interface HandbookChunk {
  id: string;
  content: string; // Text chunk
  metadata: {
    section: string; // "Time Off Policy", "Expense Reimbursement"
    category: "pto" | "expenses" | "benefits" | "general";
    last_updated: string; // ISO date
    page_number?: number;
  };
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
2. **Set up Vectorize** for employee handbook
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
- [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/)

You operate in a Thought-Action-Observation loop:

1. **THOUGHT**: Analyze the user's request and plan your approach step-by-step.
   - Break down complex tasks into smaller steps
   - Identify what information you need
   - Decide which tools to use

2. **ACTION**: Execute one tool at a time using this format:
   \`\`\`json
   {
     "action": "tool_name",
     "action_input": {
       "param1": "value1",
       "param2": "value2"
     }
   }
   \`\`\`

3. **OBSERVATION**: After each tool call, you'll receive results. Use them to update your thinking.

4. **LOOP**: Continue the cycle until you have all the information needed to provide a final answer.

5. **FINAL ANSWER**: When ready, provide your response using:
   \`\`\`json
   {
     "action": "final_answer",
     "action_input": {
       "response": "Your friendly, helpful response to the user"
     }
   }
   \`\`\`

## Policy Information

**IMPORTANT**: Do not use hardcoded policies. Always search the employee handbook using the `search_employee_handbook` tool to get current, accurate policy information. The handbook contains the authoritative rules for PTO, expenses, benefits, and all company policies.

## Your Behavior

- Always think step-by-step before acting
- Use tools to gather accurate, real-time data (don't guess)
- For any policy questions or validations, first search the employee handbook
- Validate against policies using the validation tools
- Be friendly, professional, and concise
- If a request violates policy, explain why clearly
- If escalating, explain the reason to both employee and manager
- Always log audit events for compliance

## Example Interaction

User: "I need PTO for December 20-22"

THOUGHT: The user wants PTO. I need to:
1. Get current user info
2. Calculate business days for Dec 20-22
3. Check their PTO balance
4. Search handbook for PTO approval policies
5. Validate against blackouts
6. Determine if auto-approve or escalate
7. Submit the request
8. Respond to user

ACTION:
\`\`\`json
{
  "action": "get_current_user",
  "action_input": {}
}
\`\`\`

OBSERVATION: {"id": "user123", "username": "alice", "employee_level": "junior", "manager_id": "mgr456"}

THOUGHT: Alice is a junior employee. Now I'll calculate the business days and search for PTO policies.

ACTION:
\`\`\`json
{
  "action": "calculate_business_days",
  "action_input": {
    "start_date": "2025-12-20",
    "end_date": "2025-12-22"
  }
}
\`\`\`

OBSERVATION: {"business_days": 3, "weekend_days": 0, "holidays": []}

THOUGHT: 3 business days. Let me search the handbook for PTO approval limits for junior employees.

ACTION:
\`\`\`json
{
  "action": "search_employee_handbook",
  "action_input": {
    "query": "PTO approval limits for junior employees",
    "category": "pto"
  }
}
\`\`\`

OBSERVATION: {"results": [{"content": "Junior employees can have PTO requests up to 3 business days auto-approved by the system.", "score": 0.95, "metadata": {"section": "Time Off Policy", "category": "pto", "last_updated": "2025-01-15"}}], "total_found": 1}

THOUGHT: Perfect! Junior employees can auto-approve up to 3 days. Let me check her balance and validate.

ACTION:
\`\`\`json
{
  "action": "validate_pto_policy",
  "action_input": {
    "employee_id": "user123",
    "start_date": "2025-12-20",
    "end_date": "2025-12-22",
    "reason": "Personal time"
  }
}
\`\`\`

OBSERVATION: {"is_valid": true, "can_auto_approve": true, "requires_escalation": false, "violations": [], "recommendation": "AUTO_APPROVE"}

THOUGHT: Great! This can be auto-approved (3 days ≤ 3-day junior limit). Let me submit it.

ACTION:
\`\`\`json
{
  "action": "submit_pto_request",
  "action_input": {
    "employee_id": "user123",
    "start_date": "2025-12-20",
    "end_date": "2025-12-22",
    "total_days": 3,
    "reason": "Personal time",
    "status": "auto_approved",
    "approval_type": "auto",
    "validation_notes": "Auto-approved within junior employee limit per handbook"
  }
}
\`\`\`

OBSERVATION: {"request_id": "req789", "status": "auto_approved", "message": "Request submitted successfully"}

THOUGHT: Perfect! Now I'll provide a friendly response.

FINAL ANSWER:
\`\`\`json
{
  "action": "final_answer",
  "action_input": {
    "response": "Great news! Your PTO request for December 20-22 (3 business days) has been automatically approved. ✅ Enjoy your time off!"
  }
}
\`\`\`

---

## Comparison: Custom ReAct vs Cloudflare Agents SDK

| Aspect             | Custom ReAct Implementation | Cloudflare Agents SDK         |
| ------------------ | --------------------------- | ----------------------------- |
| **Architecture**   | Manual THOUGHT-ACTION loop  | AI SDK with native tool calls |
| **State**          | Custom Durable Storage      | Auto-persisted setState()     |
| **Database**       | D1 binding required         | Embedded SQLite built-in      |
| **Scheduling**     | Manual Alarms API           | Native schedule() method      |
| **Client Sync**    | Custom WebSocket code       | useAgent hook auto-sync       |
| **Type Safety**    | Manual interfaces           | Full TypeScript support       |
| **Code Volume**    | ~500+ lines                 | ~200 lines                    |
| **Learning Curve** | High (custom framework)     | Low (standard patterns)       |
| **Maintenance**    | High                        | Low                           |
| **Tool Calling**   | JSON parsing & validation   | AI SDK handles automatically  |

---

## References

- [Cloudflare Agents SDK Documentation](https://developers.cloudflare.com/agents/)
- [Agents SDK GitHub](https://github.com/cloudflare/agents-sdk)
- [AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/)

