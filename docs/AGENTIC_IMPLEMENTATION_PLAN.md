# ApprovalFlow AI - Agentic Implementation Plan
## ReAct Framework Architecture

> **Based on HuggingFace Agent Course: Thought-Action-Observation Cycle**

---

## Executive Summary

This implementation plan follows the **ReAct (Reasoning + Acting)** framework to build a proper AI agent that exhibits genuine agentic behavior through:

1. **Thought**: Internal reasoning and planning using LLM
2. **Action**: Tool execution via structured function calls
3. **Observation**: Integration of tool feedback into reasoning
4. **Loop**: Iterative refinement until task completion

The agent demonstrates autonomy, multi-step problem solving, and dynamic adaptation—not just LLM wrapper functionality.

---

## Core Architecture: The ReAct Loop

```
┌─────────────────────────────────────────────────────────┐
│                    USER REQUEST                         │
│           "I need 5 days PTO next week"                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   THOUGHT (LLM Reasoning)  │
        │  "Let me break this down:  │
        │   1. Parse dates           │
        │   2. Check balance         │
        │   3. Validate blackouts    │
        │   4. Auto-approve or       │
        │      escalate"             │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   ACTION (Tool Call)       │
        │  Call: get_pto_balance     │
        │  Args: {user_id: "123"}    │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   OBSERVATION (Tool Result)│
        │  "Balance: 18 days"        │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   THOUGHT (Updated)        │
        │  "Good, sufficient balance.│
        │   Now check blackouts..."  │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   ACTION (Tool Call)       │
        │  Call: check_blackouts     │
        │  Args: {start: "2025-11-18"│
        │         end: "2025-11-22"} │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   OBSERVATION              │
        │  "No blackout conflicts"   │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   THOUGHT (Final)          │
        │  "5 days exceeds junior    │
        │   limit of 3. Escalate."   │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   ACTION (Final)           │
        │  Call: escalate_to_manager │
        │  Call: send_response       │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   FINAL ANSWER             │
        │  "Your 5-day PTO request   │
        │   has been escalated to    │
        │   your manager for review."│
        └────────────────────────────┘
```

**Data Sources Integration:**
- **Vectorize**: Semantic search of employee handbook for policy rules
- **D1 Database**: Relational data (users, balances, requests, calendar)
- **Workers AI**: LLM reasoning and response generation
- **Durable Objects**: State management and conversation persistence

---

## Agent Tools Definition

Following the **stop-and-parse** approach, the agent has access to these tools:

### 1. Information Retrieval Tools

#### `get_current_user`
```typescript
{
  name: "get_current_user",
  description: "Retrieves the authenticated user's profile including ID, name, role, employee level, and manager.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  },
  returns: {
    id: "string",
    username: "string",
    employee_level: "junior | senior",
    manager_id: "string",
    hire_date: "string"
  }
}
```

**Implementation:**
```typescript
async function get_current_user(): Promise<UserProfile> {
  const sessionToken = this.getSessionToken();
  const userId = await this.validateSession(sessionToken);
  
  const user = await this.env.APP_DB.prepare(`
    SELECT id, username, employee_level, manager_id, hire_date, department
    FROM users WHERE id = ?
  `).bind(userId).first();
  
  return user as UserProfile;
}
```

#### `search_employee_handbook`
```typescript
{
  name: "search_employee_handbook",
  description: "Searches the employee handbook using semantic search to find relevant policies and rules. Use this for any policy-related questions or validations.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language query about company policies (e.g., 'PTO approval limits', 'expense reimbursement rules', 'blackout periods')"
      },
      category: {
        type: "string",
        description: "Optional category filter: 'pto', 'expenses', 'benefits', 'general'",
        enum: ["pto", "expenses", "benefits", "general"]
      },
      top_k: {
        type: "number",
        description: "Number of top results to return (default: 5)",
        default: 5
      }
    },
    required: ["query"]
  },
  returns: {
    results: "array of {content, score, metadata: {section, category, last_updated}}",
    total_found: "number"
  }
}
```

**Implementation:**
```typescript
async function search_employee_handbook(query: string, category?: string, topK: number = 5) {
  // Generate embedding for the query
  const queryEmbedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: query
  });
  
  // Build Vectorize query with optional category filter
  const vectorQuery = {
    vector: queryEmbedding.data[0],
    topK,
    returnValues: true,
    returnMetadata: true
  };
  
  if (category) {
    vectorQuery.filter = { category };
  }
  
  // Search the handbook vector index
  const results = await this.env.HANDBOOK_VECTORS.query(vectorQuery);
  
  // Format results
  const formattedResults = results.matches.map(match => ({
    content: match.values, // The handbook text chunk
    score: match.score,
    metadata: match.metadata // {section, category, last_updated}
  }));
  
  return {
    results: formattedResults,
    total_found: results.matches.length
  };
}
```

#### `get_pto_balance`
```typescript
{
  name: "get_pto_balance",
  description: "Retrieves the employee's current PTO balance, accrued days, used days, and rollover.",
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
  returns: {
    current_balance: "number",
    total_accrued: "number",
    total_used: "number",
    rollover_from_previous_year: "number"
  }
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
  const holidays = await this.env.APP_DB.prepare(`
    SELECT start_date FROM company_calendar 
    WHERE event_type = 'holiday' 
    AND start_date BETWEEN ? AND ?
  `).bind(start, end).all();
  
  const holidaySet = new Set(holidays.results.map(h => h.start_date));
  
  let businessDays = 0;
  let weekendDays = 0;
  let current = new Date(startDate);
  
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
  const businessDays = await this.calculate_business_days(params.start_date, params.end_date);
  
  // Rule 1: Sufficient balance
  if (balance.current_balance < businessDays.business_days) {
    violations.push({
      policy: "insufficient_balance",
      message: `Insufficient PTO. You have ${balance.current_balance} days but need ${businessDays.business_days} days.`
    });
  }
  
  // Rule 2: No blackout conflicts
  const blackouts = await this.check_blackout_periods(params.start_date, params.end_date);
  if (blackouts.has_conflict) {
    violations.push({
      policy: "blackout_conflict",
      message: `Request overlaps with blackout period: ${blackouts.conflicting_periods[0].name}`
    });
  }
  
  // Rule 3: Auto-approval threshold
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

## Agent System Prompt (ReAct Framework)

```typescript
const AGENT_SYSTEM_PROMPT = `You are ApprovalFlow AI, an intelligent agent that helps employees with PTO requests and expense reimbursements.

## Your Capabilities

You have access to the following tools:
${JSON.stringify(TOOLS, null, 2)}

## How You Work (ReAct Framework)

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

Now, help the user with their request. Always think step-by-step and use tools!
`;
```

---

## Agent Implementation (Durable Object)

```typescript
// src/agents/approval-agent.ts
import { AIChatAgent } from "agents/ai-chat-agent";
import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

interface AgentState {
  currentThought?: string;
  actionHistory: Array<{
    thought: string;
    action: string;
    observation: any;
    timestamp: number;
  }>;
  maxIterations: number;
  currentIteration: number;
}

export class ApprovalAgent extends AIChatAgent<Env> {
  private agentState: AgentState = {
    actionHistory: [],
    maxIterations: 10,
    currentIteration: 0
  };
  
  async onChatMessage(onFinish, options) {
    const userMessage = this.messages[this.messages.length - 1];
    
    // Initialize ReAct loop
    let continueLoop = true;
    let finalAnswer = null;
    
    while (continueLoop && this.agentState.currentIteration < this.agentState.maxIterations) {
      // THOUGHT: LLM generates reasoning + next action
      const llmResponse = await this.generateThoughtAndAction(userMessage.content);
      
      // Parse the action
      const parsedAction = this.parseAction(llmResponse);
      
      if (parsedAction.action === "final_answer") {
        // Loop complete
        finalAnswer = parsedAction.action_input.response;
        continueLoop = false;
      } else {
        // ACTION: Execute the tool
        const observation = await this.executeTool(parsedAction.action, parsedAction.action_input);
        
        // Store in action history
        this.agentState.actionHistory.push({
          thought: llmResponse.thought,
          action: parsedAction.action,
          observation,
          timestamp: Date.now()
        });
        
        // Add observation to conversation context for next iteration
        this.addObservationToContext(observation);
        
        this.agentState.currentIteration++;
      }
    }
    
    // If max iterations reached without final answer
    if (!finalAnswer) {
      finalAnswer = "I apologize, but I've reached my processing limit. Please try rephrasing your request or contact support.";
    }
    
    // Stream the final answer
    return this.streamFinalAnswer(finalAnswer, onFinish);
  }
  
  private async generateThoughtAndAction(userInput: string) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    
    // Build context with action history
    const context = this.buildContextFromHistory();
    
    const messages = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      { role: 'user', content: userInput },
      ...context
    ];
    
    const result = await streamText({
      model,
      messages,
      temperature: 0.1, // Lower temperature for more deterministic reasoning
    });
    
    const fullResponse = await result.text();
    
    // Extract THOUGHT and ACTION from response
    return this.extractThoughtAndAction(fullResponse);
  }
  
  private extractThoughtAndAction(response: string) {
    // Parse the LLM response to extract thought and action
    const thoughtMatch = response.match(/THOUGHT:(.+?)(?=ACTION:|FINAL ANSWER:|$)/s);
    const actionMatch = response.match(/ACTION:\s*```json\s*(\{.+?\})\s*```/s);
    const finalMatch = response.match(/FINAL ANSWER:\s*```json\s*(\{.+?\})\s*```/s);
    
    return {
      thought: thoughtMatch ? thoughtMatch[1].trim() : '',
      action: actionMatch || finalMatch ? JSON.parse((actionMatch || finalMatch)[1]) : null
    };
  }
  
  private parseAction(llmResponse: any) {
    if (!llmResponse.action) {
      throw new Error("No action found in LLM response");
    }
    
    return llmResponse.action;
  }
  
  private async executeTool(toolName: string, params: any): Promise<any> {
    // Tool registry
    const tools = {
      get_current_user: () => this.getCurrentUser(),
      search_employee_handbook: (p) => this.searchEmployeeHandbook(p.query, p.category, p.top_k),
      get_pto_balance: (p) => this.getPTOBalance(p.employee_id),
      check_blackout_periods: (p) => this.checkBlackoutPeriods(p.start_date, p.end_date),
      calculate_business_days: (p) => this.calculateBusinessDays(p.start_date, p.end_date),
      validate_pto_policy: (p) => this.validatePTOPolicy(p),
      validate_expense_policy: (p) => this.validateExpensePolicy(p),
      submit_pto_request: (p) => this.submitPTORequest(p),
      escalate_to_manager: (p) => this.escalateToManager(p),
      update_pto_balance: (p) => this.updatePTOBalance(p),
      log_audit_event: (p) => this.logAuditEvent(p),
      send_notification: (p) => this.sendNotification(p),
      get_pto_history: (p) => this.getPTOHistory(p),
      calculate_pto_accrual: (p) => this.calculatePTOAccrual(p),
      submit_expense_request: (p) => this.submitExpenseRequest(p),
    };
    
    const toolFunc = tools[toolName];
    if (!toolFunc) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    
    try {
      const result = await toolFunc(params);
      
      // Log successful tool execution
      await this.logAuditEvent({
        entity_type: 'tool_execution',
        entity_id: crypto.randomUUID(),
        action: 'executed',
        actor_type: 'ai_agent',
        details: JSON.stringify({ tool: toolName, params, result })
      });
      
      return result;
    } catch (error) {
      // Log error
      console.error(`Tool execution error: ${toolName}`, error);
      return { error: error.message, tool: toolName };
    }
  }
  
  // Tool implementations (delegate to policy engine and database)
  
  private async getCurrentUser(): Promise<UserProfile> {
    const sessionToken = await this.getSessionFromContext();
    const userId = await this.validateSession(sessionToken);
    
    const user = await this.env.APP_DB.prepare(`
      SELECT id, username, employee_level, manager_id, hire_date, department, role
      FROM users WHERE id = ?
    `).bind(userId).first();
    
    return user as UserProfile;
  }
  
  private async searchEmployeeHandbook(query: string, category?: string, topK: number = 5) {
    // Generate embedding for the query using Workers AI
    const embeddingResponse = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: query
    });
    
    // Build Vectorize query
    const vectorQuery = {
      vector: embeddingResponse.data[0],
      topK,
      returnValues: true,
      returnMetadata: true
    };
    
    if (category) {
      vectorQuery.filter = { category };
    }
    
    // Search the handbook vector index
    const results = await this.env.HANDBOOK_VECTORS.query(vectorQuery);
    
    // Format results
    const formattedResults = results.matches.map(match => ({
      content: match.values, // The handbook text chunk
      score: match.score,
      metadata: match.metadata // {section, category, last_updated}
    }));
    
    return {
      results: formattedResults,
      total_found: results.matches.length
    };
  }
  
  private async getPTOBalance(employeeId?: string): Promise<PTOBalance> {
    const user = employeeId ? { id: employeeId } : await this.getCurrentUser();
    
    const balance = await this.env.APP_DB.prepare(`
      SELECT * FROM pto_balances WHERE employee_id = ?
    `).bind(user.id).first();
    
    return balance as PTOBalance;
  }
  
  private async checkBlackoutPeriods(startDate: string, endDate: string) {
    const blackouts = await this.env.APP_DB.prepare(`
      SELECT * FROM company_calendar 
      WHERE event_type = 'blackout' 
      AND (
        (start_date BETWEEN ? AND ?) OR 
        (end_date BETWEEN ? AND ?) OR
        (? BETWEEN start_date AND end_date) OR
        (? BETWEEN start_date AND end_date)
      )
    `).bind(startDate, endDate, startDate, endDate, startDate, endDate).all();
    
    return {
      has_conflict: blackouts.results.length > 0,
      conflicting_periods: blackouts.results
    };
  }
  
  private async validatePTOPolicy(params: PTOValidationParams) {
    // Implementation from earlier policy engine
    // (See Policy Validation Tools section)
    return await this.policyEngine.validatePTO(params);
  }
  
  private async submitPTORequest(params: any) {
    const requestId = crypto.randomUUID();
    
    await this.env.APP_DB.prepare(`
      INSERT INTO pto_requests (
        id, employee_id, manager_id, start_date, end_date,
        total_days, reason, status, approval_type, ai_validation_notes,
        balance_before, balance_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      requestId,
      params.employee_id,
      params.manager_id || null,
      params.start_date,
      params.end_date,
      params.total_days,
      params.reason || '',
      params.status,
      params.approval_type,
      params.validation_notes || '',
      params.balance_before || null,
      params.balance_after || null,
      Date.now()
    ).run();
    
    // If auto-approved, update balance immediately
    if (params.status === 'auto_approved') {
      await this.updatePTOBalance({
        employee_id: params.employee_id,
        days_to_deduct: params.total_days,
        request_id: requestId
      });
    }
    
    return {
      request_id: requestId,
      status: params.status,
      message: "Request submitted successfully"
    };
  }
  
  // ... Additional tool implementations
}
```

---

## Key Agentic Behaviors Demonstrated

### 1. **Multi-Step Planning**
The agent breaks down complex requests into sequential steps:
```
User: "Book me 5 days off next week"
  ↓
Agent Plans:
  Step 1: Parse "next week" into specific dates
  Step 2: Get user's employee level
  Step 3: Calculate business days
  Step 4: Check PTO balance
  Step 5: Validate blackout periods
  Step 6: Check auto-approval threshold
  Step 7: Submit or escalate
  Step 8: Respond to user
```

### 2. **Dynamic Adaptation**
The agent adapts based on tool observations:
```
THOUGHT: "Check balance"
ACTION: get_pto_balance()
OBSERVATION: { balance: 2 days }
THOUGHT: "Insufficient! User requested 5 days. I should deny and explain."
ACTION: final_answer("You only have 2 days available...")
```

### 3. **Tool Chaining**
The agent chains multiple tools to solve complex problems:
```
get_current_user() 
  → calculate_business_days() 
    → get_pto_balance() 
      → check_blackout_periods() 
        → validate_pto_policy() 
          → submit_pto_request() 
            → log_audit_event()
```

### 4. **Self-Reflection**
The agent reflects on past actions to refine its approach:
```
THOUGHT: "My validation returned errors. I should not submit the request."
ACTION: final_answer(explanation_of_violation)

vs.

THOUGHT: "Validation passed. Now I can submit."
ACTION: submit_pto_request()
```

### 5. **Error Recovery**
The agent handles tool failures gracefully:
```
ACTION: check_blackout_periods()
OBSERVATION: { error: "Database timeout" }
THOUGHT: "Tool failed. I'll retry or ask user to try later."
ACTION: final_answer("I'm experiencing technical issues...")
```

---

## Success Metrics for Agentic Behavior

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Tool Usage Rate** | >80% | Percentage of requests using ≥2 tools |
| **Multi-Step Planning** | >60% | Requests requiring 3+ sequential tool calls |
| **Adaptive Decisions** | >90% | Correct routing (approve/deny/escalate) |
| **Handbook Search Accuracy** | >95% | Correct policy retrieval from vector search |
| **Error Recovery** | >95% | Graceful handling of tool failures |
| **Audit Compliance** | 100% | All actions logged to audit_log |
| **Response Accuracy** | >95% | Correct policy interpretation |

---

## Implementation Phases

### Phase 1: Tool Infrastructure (Week 1)
- [ ] Implement all 15+ agent tools
- [ ] Build policy validation engine
- [ ] Create tool registry and executor
- [ ] Test each tool independently

### Phase 2: ReAct Loop (Week 2)
- [ ] Implement Thought-Action-Observation cycle
- [ ] Build LLM prompt with tool descriptions
- [ ] Add action parsing (JSON extraction)
- [ ] Implement iteration limits and safety

### Phase 3: Agent Intelligence (Week 3)
- [ ] Add multi-step planning
- [ ] Implement dynamic adaptation logic
- [ ] Build error recovery mechanisms
- [ ] Add conversation history integration

### Phase 4: Testing & Refinement (Week 4)
- [ ] Test complex multi-tool scenarios
- [ ] Evaluate agentic behavior metrics
- [ ] Optimize LLM prompts for reasoning
- [ ] Add comprehensive logging

---

## Technical Implementation Details

### Prompt Engineering for ReAct

**Key Techniques:**
1. **Explicit Structure**: Define THOUGHT/ACTION/OBSERVATION markers
2. **Few-Shot Examples**: Include 2-3 examples in system prompt
3. **Tool Descriptions**: Detailed parameter specs with types
4. **Step-by-Step Instruction**: "Let's think step by step" trigger
5. **JSON Formatting**: Clear format requirements for actions

### Safety Mechanisms

1. **Iteration Limits**: Max 10 loops to prevent infinite reasoning
2. **Timeout Protection**: 30-second max per tool call
3. **Tool Whitelisting**: Only registered tools can be called
4. **Parameter Validation**: Schema validation before execution
5. **Audit Logging**: Every tool call logged for review

### Performance Optimizations

1. **Parallel Tool Calls**: When independent (future enhancement)
2. **Caching**: Cache policy rules and user data
3. **Streaming**: Stream final answer for perceived speed
4. **Database Indexing**: Optimize queries with proper indexes

---

## Vectorize Configuration for Employee Handbook

### Setup Steps

1. **Create Vectorize Index**:
   ```bash
   npx wrangler vectorize create handbook-vectors --dimensions=768 --metric=cosine
   ```

2. **Configure in wrangler.jsonc**:
   ```jsonc
   {
     "vectorize": [
       {
         "binding": "HANDBOOK_VECTORS",
         "index_name": "handbook-vectors"
       }
     ]
   }
   ```

3. **Populate Handbook Data**:
   - Chunk the employee handbook into sections
   - Generate embeddings using `@cf/baai/bge-base-en-v1.5`
   - Insert vectors with metadata (section, category, last_updated)

### Handbook Data Structure

```typescript
interface HandbookEntry {
  id: string;
  content: string; // Text chunk from handbook
  vector: number[]; // 768-dimensional embedding
  metadata: {
    section: string; // e.g., "Time Off Policy", "Expense Reimbursement"
    category: string; // "pto", "expenses", "benefits", "general"
    last_updated: string; // ISO date
    page_number?: number;
  };
}
```

### Example Handbook Ingestion

```typescript
// In a migration script or setup worker
async function populateHandbookVectors(env: Env) {
  const handbookChunks = [
    {
      content: "Junior employees accrue 1.5 days of PTO per month and can have requests up to 3 business days auto-approved.",
      metadata: { section: "Time Off Policy", category: "pto", last_updated: "2025-01-15" }
    },
    {
      content: "Expense reimbursements over $75 require receipts. Junior employees can have expenses up to $100 auto-approved.",
      metadata: { section: "Expense Policy", category: "expenses", last_updated: "2025-01-15" }
    }
    // ... more chunks
  ];
  
  for (const chunk of handbookChunks) {
    // Generate embedding
    const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: chunk.content
    });
    
    // Insert into Vectorize
    await env.HANDBOOK_VECTORS.insert([
      {
        id: crypto.randomUUID(),
        values: embedding.data[0],
        metadata: chunk.metadata
      }
    ]);
  }
}
```

### Integration Benefits

- **Dynamic Policies**: Agent always uses current handbook rules, not hardcoded values
- **Explainability**: Agent can cite specific handbook sections in responses
- **Maintainability**: Update policies by modifying handbook data, not code
- **Accuracy**: Reduces hallucinations by grounding responses in real documents

---

## Comparison: Agentic vs Non-Agentic

| Aspect | Non-Agentic (LLM Wrapper) | Agentic (ReAct Framework) |
|--------|---------------------------|---------------------------|
| **Intelligence** | Direct LLM → response | Multi-step reasoning loop |
| **Tools** | No external data access | 15+ tools for real data |
| **Adaptability** | Static responses | Dynamic based on observations |
| **Planning** | Single-turn | Multi-turn with planning |
| **Error Handling** | Fails silently | Retries and explains |
| **Auditability** | None | Full action log |
| **Accuracy** | Hallucinates policies | Queries real policy data |

---

## Next Steps

1. **Set up Vectorize for Employee Handbook**:
   - Create vector index for handbook
   - Chunk and embed handbook content
   - Test semantic search functionality

2. **Review this plan** with the team
3. **Implement tool infrastructure** first (foundational)
4. **Build ReAct loop** in Durable Object
5. **Test with sample scenarios** (PTO requests)
6. **Iterate on prompt engineering** for better reasoning
7. **Add expense request support** (second use case)
8. **Deploy and monitor** agentic behavior metrics

---

## References

- [HuggingFace Agents Course - Thought-Action-Observation](https://huggingface.co/learn/agents-course/en/unit1/agent-steps-and-structure)
- [HuggingFace - ReAct Framework](https://huggingface.co/learn/agents-course/en/unit1/thoughts)
- [HuggingFace - Agent Actions](https://huggingface.co/learn/agents-course/en/unit1/actions)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
