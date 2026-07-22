# ApprovalFlow AI — Architecture & Implementation

This document provides a comprehensive overview of the ApprovalFlow AI system architecture, runtime flows, and key implementation details. The application is an AI-powered approval workflow system built on Cloudflare Workers that handles employee PTO (Paid Time Off) requests and expense reimbursements through a conversational chat interface.

## Table of Contents

- [System Overview](#system-overview)
- [Core Components](#core-components)
- [Architecture Diagrams](#architecture-diagrams)
- [Key Implementation Details](#key-implementation-details)
- [Data Flows](#data-flows)
- [File Structure](#file-structure)

---

## System Overview

### Technology Stack

- **Runtime:** Cloudflare Workers (Durable Objects for state)
- **AI Provider:** Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **Database:** Cloudflare D1 (SQLite-based relational database)
- **Frontend:** React with Vite, Tailwind CSS
- **Agent Framework:** Cloudflare Agents SDK
- **Router:** Hono (lightweight HTTP framework)
- **Authentication:** Session-based with PBKDF2(SHA-256) password hashing

### Key Features

- **Conversational AI Agent:** Natural language processing for PTO and expense requests
- **ReAct Framework:** Manual implementation of Reasoning + Acting loop with 15 specialized tools
- **Streaming Responses:** Real-time streaming of AI responses via WebSocket
- **Tool Execution Visualization:** UI cards showing tool invocations and results
- **Expense Management:** Receipt upload with real OCR (Workers AI vision model), multi-step submission workflow
- **Voice Input:** Audio transcription via Workers AI (Whisper, with Deepgram nova-3 fallback)
- **Audit Logging:** Comprehensive tracking of all actions for compliance
- **Policy Enforcement:** Automated validation against company policies and blackout periods
- **Session-based Authentication:** Secure HTTP-only cookies with D1-backed session storage
- **AI Gateway:** Per-request token/latency logging and response caching for all Workers AI calls
- **Observability:** Workers OTel tracing, Agents SDK diagnostics, and a Tail Worker for log forwarding
- **LLM Evaluation Suite:** Golden-query regression tests against real Workers AI inference

---

## Core Components

### 1. Frontend (React UI)

**Main Files:**

- [src/app.tsx](../src/app.tsx) (649 lines) - Main chat interface component
- [src/client.tsx](../src/client.tsx) (15 lines) - React DOM entry point
- [src/components/](../src/components/) - UI component library

**Key Features:**

- Uses `useAgent()` hook from `agents/react` to establish WebSocket connection to Chat Durable Object
- Uses `useAgentChat()` for message management and streaming
- Displays tool invocations via `ToolInvocationCard` components (expandable cards)
- Theme switching (light/dark mode) with localStorage persistence
- Expense submission dialog with multi-step workflow (upload → review → submit)
- Debug mode toggle to show raw message data
- Auto-resizing textarea for message input
- Memoized markdown rendering for AI responses

**Component Structure:**

```
src/components/
├── auth/                    - Login.tsx
├── avatar/                  - Avatar.tsx
├── expense/                 - ExpenseSubmissionDialog.tsx
├── tool-invocation-card/    - ToolInvocationCard.tsx
├── memoized-markdown.tsx    - Markdown rendering
└── [various UI primitives]  - Button, Card, Input, Modal, etc.
```

### 2. Server & Routing

**Main File:** [src/server.ts](../src/server.ts) (1,224 lines)

**Responsibilities:**

- Hono-based HTTP server with CORS middleware
- Session validation via `getUserFromSession()` (queries D1 sessions table)
- Injects `X-User-Id` and `X-Username` headers into agent requests
- Routes agent traffic via `routeAgentRequest()` from Agents SDK
- Exposes authentication endpoints and receipt upload API

**Key Routes:**

```typescript
POST   /api/auth/register       // User registration
POST   /api/auth/login          // Login (sets session_token cookie)
POST   /api/auth/logout         // Logout (clears session)
GET    /api/auth/me             // Get current user
POST   /api/receipts/upload     // Upload expense receipt
GET    /api/receipts/:id        // Retrieve receipt data
GET    /check-ai-provider       // Health check for AI binding
*      /agents/*                // Routes to Chat Durable Object
GET    /api/debug/sessions      // Debug: list sessions
POST   /api/debug/clear-sessions // Debug: clear sessions
```

**Session Validation Flow:**

```typescript
// Extract session token from HTTP-only cookie
// Lookup in D1 sessions table
// Validate expiry timestamp
// Return user object or null
```

### 3. Chat Agent (Durable Object)

**Location:** [src/server.ts](../src/server.ts) (class `Chat`, lines 76-420)

**Implementation:**

```typescript
export class Chat extends AIChatAgent<Env> {
  async fetch(request: Request): Promise<Response>;
  async onChatMessage(message: Message): Promise<Message>;
  private async saveMessages(messages: Message[]): Promise<void>;
  async executeTask(task: TaskPayload): Promise<void>;
}
```

**Key Characteristics:**

- Extends `AIChatAgent<Env>` from Agents SDK
- Uses Durable Object storage (`this.ctx.storage`) to persist `userId` and `username`
- Persists conversation history to Durable Object SQLite via `this.sql()`
- Implements WebSocket Hibernation API (NOT legacy `addEventListener`)
- Delegates reasoning and tool execution to `runReActAgent()` from [src/react-agent.ts](../src/react-agent.ts)

**Entry Point Flow:**

1. HTTP/WebSocket request arrives at `fetch()`
2. Extract `X-User-Id` and `X-Username` from headers
3. Store in Durable Object storage for session persistence
4. Accept WebSocket connection via `this.ctx.acceptWebSocket()`
5. On message, call `onChatMessage()` which invokes `runReActAgent()`

### 4. ReAct Agent (Manual Implementation)

**Main File:** [src/react-agent.ts](../src/react-agent.ts) (324 lines)

**Architecture:**

- **Manual ReAct Loop:** Custom implementation (not using AI SDK's native tool framework)
- **Reason:** Workers AI has limitations with structured function calling; regex-based parsing is more reliable
- **Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI binding
- **Iteration Limit:** 15 iterations to handle complex multi-step requests
- **Context Window:** Limited to last 4 messages (2 conversation turns) to manage token limits

**Tool Detection Pattern:**

```typescript
// Agent outputs in this format:
TOOL_CALL: tool_name
PARAMETERS: {"key": "value"}
---

// Regex-based extraction and JSON cleanup before parsing
```

**Key Functions:**

```typescript
export async function runReActAgent(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  context: ToolContext,
  onToolUpdate?: ToolStreamCallback
): Promise<{
  response: string;
  toolCalls: Array<{ toolName; toolCallId; args; result }>;
  steps: Array<{ iteration; thought; action; observation }>;
}>;
```

**Flow:**

1. Format system prompt with current date/time and tool descriptions
2. Add recent conversation history (last 4 messages)
3. Call Workers AI model with `streamText()` from AI SDK
4. Stream response tokens to UI
5. Detect `TOOL_CALL:` pattern in response
6. Extract tool name and parameters (with JSON cleanup/fixing)
7. Execute tool and capture result
8. Add tool result to conversation as observation
9. Continue loop until no more tools or max iterations reached
10. Return final response + all tool calls + reasoning steps

### 5. Tool System

**Main File:** [src/tools.ts](../src/tools.ts) (1,481 lines)

**15 Available Tools:**

1. **get_current_user** - Fetch authenticated user profile (ID, name, role, employee_level, manager_id, hire_date, department)
2. **search_employee_handbook** - Query company policies using Workers AI (direct LLM call, not vector search)
3. **get_pto_balance** - Retrieve PTO balance (accrued, used, available, rollover)
4. **check_blackout_periods** - Validate dates against company calendar (holidays, blackout periods)
5. **get_pto_history** - Fetch past PTO requests with optional filtering
6. **calculate_business_days** - Compute working days between dates (excludes weekends and company holidays)
7. **validate_pto_policy** - Check auto-approval eligibility and spending limits based on employee level
8. **submit_pto_request** - Create PTO request in D1, update balances, log audit event
9. **process_receipt_image** - Returns extracted OCR data for an uploaded receipt (extraction runs at upload time via Workers AI vision model `@cf/llava-hf/llava-1.5-7b-hf`)
10. **get_receipt_data** - Retrieve extracted OCR data from stored receipts
11. **get_expense_history** - Query expense requests with timeframe filtering
12. **validate_expense_policy** - Validate expense request against company policy limits
13. **submit_expense_request** - Create expense reimbursement request in D1 with audit logging
14. **show_expense_dialog** - Trigger UI to open expense submission form (returns `__ui_action` marker)
15. **log_audit_event** - Manually log actions to audit table for compliance tracking

**Tool Interface:**

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute: (
    params: Record<string, unknown>,
    context: ToolContext
  ) => Promise<unknown>;
}

interface ToolContext {
  env: Env; // Cloudflare bindings (AI, APP_DB, etc.)
  userId: string; // Current authenticated user ID
}
```

**Key Patterns:**

- Tools automatically default to current user if `employee_id` not explicitly provided
- All date parameters must be ISO 8601 format (`YYYY-MM-DD`)
- Database queries use D1 API: `context.env.APP_DB.prepare().bind().first()`
- AI calls use `context.env.AI.run()` for handbook search
- Tools return structured objects that agent can process
- Special `__ui_action` marker triggers frontend UI changes

### 6. Database (Cloudflare D1)

**Database Name:** `approvalflow_db`
**Binding:** `APP_DB`

**Schema (8 tables):**

1. **users**
   - `id` (TEXT PRIMARY KEY) - UUID
   - `username`, `email` (TEXT UNIQUE)
   - `password_hash`, `salt` (TEXT) - PBKDF2(SHA-256, 100k iterations)
   - `role` ('employee' | 'manager')
   - `employee_level` ('junior' | 'senior')
   - `manager_id` (REFERENCES users)
   - `hire_date`, `department`, `is_active`, `created_at`

2. **sessions**
   - `id`, `user_id` (REFERENCES users ON DELETE CASCADE)
   - `token` (TEXT UNIQUE) - URL-encoded base64
   - `expires_at`, `created_at` (INTEGER - Unix timestamps)

3. **pto_requests**
   - `id`, `employee_id`, `manager_id`
   - `start_date`, `end_date`, `total_days`, `reason`
   - `status` ('pending' | 'approved' | 'denied' | 'auto_approved' | 'cancelled')
   - `approval_type` ('auto' | 'manual')
   - `ai_validation_notes`, `balance_before`, `balance_after`
   - `created_at`, `updated_at`, `approved_at`

4. **pto_balances**
   - `id`, `employee_id` (UNIQUE)
   - `total_accrued`, `total_used`, `current_balance`
   - `rollover_from_previous_year` (max 5 days per policy)
   - `last_accrual_date`, `created_at`, `updated_at`

5. **expense_requests**
   - `id`, `employee_id`, `manager_id`
   - `amount`, `currency`, `category`, `description`
   - `status` ('pending' | 'approved' | 'denied')
   - `receipt_id` (REFERENCES receipt_uploads)
   - `created_at`, `updated_at`, `approved_at`

6. **company_calendar**
   - `id`, `name`, `description`, `start_date`, `end_date`
   - `event_type` ('holiday' | 'blackout' | 'company_event')
   - `created_at`

7. **receipt_uploads**
   - `id`, `employee_id`, `expense_request_id`
   - `file_name`, `file_type`, `file_size`
   - `ocr_status` ('pending' | 'completed' | 'failed')
   - `extracted_data` (TEXT - JSON), `processing_errors`
   - `created_at`

8. **audit_log**
   - `id`, `user_id`, `action`, `entity_type`, `entity_id`
   - `changes` (TEXT - JSON), `created_at`

**Migrations:** Located in [migrations/](../migrations/) directory (8 migration files)

**Demo Users:** (all password: `Password123!`)

- `ramya_manager` - Manager in People Ops
- `ramya_senior` - Senior engineer reporting to manager
- `ramya_junior` - Junior engineer reporting to manager

### 7. Authentication System

**Password Hashing:**

```typescript
Algorithm: PBKDF2(SHA-256)
Iterations: 100,000
Salt: 16 bytes (random, base64-encoded)
Key Length: 256 bits
```

**Session Management:**

- HTTP-only, secure cookies (`session_token`)
- Cookie value: URL-encoded base64 token
- Stored in D1 `sessions` table with expiry timestamps
- Validated on every request via `getUserFromSession()`

**Auth Flow:**

1. User submits username/password to `POST /api/auth/login`
2. Server retrieves user from D1, validates password hash
3. Creates new session record in D1 with random token
4. Sets `session_token` HTTP-only cookie in response
5. Subsequent requests validate token and inject user headers
6. Agent routes require valid session (401 if missing)

### 8. System Prompt & Tool Orchestration

**Location:** [src/prompts.ts](../src/prompts.ts)

**Key Sections:**

- **Context Injection:** Current date/time in user's timezone
- **Role Definition:** ApprovalFlow AI assistant for PTO & expenses
- **Critical Rules:**
  - Must call tools for any PTO/expense action
  - Never make up data or fake tool results
  - Automatic context gathering (get_current_user, get_pto_balance)
  - Strict date format enforcement (ISO 8601: YYYY-MM-DD)
  - Display ALL numeric values (never hide numbers)

**Tool Call Format:**

```
TOOL_CALL: tool_name
PARAMETERS: {"key": "value"}
---
```

**PTO Request Workflow (mandatory sequence):**

1. `get_current_user()` - Get employee_id
2. `get_pto_balance()` - Check available days
3. Parse dates from natural language
4. `calculate_business_days()` - Compute duration
5. `validate_pto_policy()` - Check eligibility
6. `submit_pto_request()` - Persist to database

**Expense Workflow:**

- Keywords trigger `show_expense_dialog` tool
- UI modal opens for file upload and form submission
- OCR extraction (real, via Workers AI vision model at upload time) populates form fields
- Agent receives submission data and calls `submit_expense_request`

### 9. Observability & AI Gateway

**Configuration:** [wrangler.jsonc](../wrangler.jsonc), [wrangler.tail.jsonc](../wrangler.tail.jsonc), [src/tail.ts](../src/tail.ts), [src/react-agent.ts](../src/react-agent.ts)

Three complementary layers run in production, added on top of the original ReAct implementation:

1. **AI Gateway** — `createWorkersAI()` in `react-agent.ts` is configured with a `gateway` option (`id: "approvalflow-ai"`, `cacheTtl: 3600`). Every `generateText()` call is transparently routed through the gateway, which logs per-request prompts, responses, token counts, and latency, and caches repeated requests to cut inference cost. No inference code changes — only the provider config.
2. **Workers Automatic Tracing** — `observability.traces.enabled = true` in `wrangler.jsonc` emits OTel-compliant spans for every D1 query, Durable Object call, and Workers AI invocation with zero code changes. Exportable via OTLP to Honeycomb, Grafana, or Axiom.
3. **Agents SDK Diagnostics + Tail Worker** — the `Chat` class overrides `observability.emit()` to emit structured JSON for every RPC call, state change, WebSocket connect/disconnect, and chat lifecycle event (errors to `console.error`, everything else to `console.log`). [src/tail.ts](../src/tail.ts) is a **separate Worker** that consumes these diagnostics channel events plus ordinary Worker logs/exceptions, normalizes them to JSON, and is the integration point for forwarding to an external log sink. It deploys independently (`wrangler deploy --config wrangler.tail.jsonc`) and is wired up by uncommenting `tail_consumers` in `wrangler.jsonc`.

### 10. Evaluation Framework

**Configuration:** [docs/evals/golden_queries.json](../docs/evals/golden_queries.json), [tests/evals/golden_queries.test.ts](../tests/evals/golden_queries.test.ts), [vitest.evals.config.ts](../vitest.evals.config.ts)

A golden-query regression suite (`npm run eval`) validates agent behavior against **real Workers AI inference** — not mocked responses — using `@cloudflare/vitest-pool-workers`. 10 queries span 5 categories (`direct_answer`, `clarification`, `workflow`, `safety`) across the three demo users (junior/senior/manager), each seeded into a fresh in-memory D1 instance per test. Each query is graded on:

- `tools_required` / `tools_forbidden` — the exact tool-call trace must (not) contain these tool names
- `response_contains_any` / `response_contains_none` — the final response must (not) contain these phrases, e.g. verifying one user's response never leaks another user's PTO balance

Because each query takes real Workers AI inference (~30–60s), the suite runs via its own Vitest config (`vitest.evals.config.ts`, `npm run eval`) rather than the default `npm test`. Neither is currently wired into CI — `.github/workflows/sanity-check.yml` runs only `npm run check` (prettier, biome, tsc); evals are a manual/local regression gate today.

---

## Architecture Diagrams

### System Architecture (High-Level)

```mermaid
flowchart TB
  Browser["Browser<br/>React UI (src/app.tsx)<br/>useAgent() + useAgentChat()"]
  Browser -->|"HTTP & WebSocket<br/>(session cookie)"| Router["Hono Router / API<br/>(src/server.ts)<br/>CORS + Session Validation"]

  Router -->|"routeAgentRequest()<br/>(injects X-User-Id)"| ChatDO["Chat Durable Object<br/>(extends AIChatAgent)<br/>Persists userId in DO storage"]

  ChatDO -->|"onChatMessage()<br/>→ runReActAgent()"| ReAct["ReAct Agent Loop<br/>(src/react-agent.ts)<br/>Manual tool calling"]

  ReAct -->|"generateText()<br/>model: llama-3.3-70b"| Gateway["AI Gateway<br/>(id: approvalflow-ai)<br/>token/latency logging + caching"]
  Gateway --> AI["Workers AI Binding<br/>(env.AI)"]

  ReAct -->|"Execute tools<br/>(15 tools)"| Tools["Tool System<br/>(src/tools.ts)"]

  Tools -->|"D1 queries<br/>(prepare + bind)"| D1[("Cloudflare D1<br/>APP_DB<br/>8 tables")]

  Tools -->|"search_employee_handbook /<br/>OCR / transcription"| AI

  Tools -->|"search_employee_handbook"| Handbook["Employee Handbook<br/>(docs/employee_handbook.md)"]

  Router -->|"Auth endpoints<br/>/api/auth/*"| D1
  Router -->|"Receipt upload (OCR)<br/>/api/receipts/upload"| AI
  Router -->|"Audio upload (STT)<br/>/api/audio/transcribe"| AI

  ChatDO -->|"Persist state"| DOStorage["Durable Object Storage<br/>(userId, username)"]
  ChatDO -->|"Save history<br/>this.sql()"| DOSQLite["Durable Object SQLite<br/>(conversation history)"]

  Browser -->|"Expense dialog<br/>receipt upload"| Router

  ChatDO -.->|"Agents SDK diagnostics<br/>(observability.emit())"| TailWorker["Tail Worker<br/>(src/tail.ts)<br/>separate deploy"]
  Router -.->|"console logs / exceptions"| TailWorker
  Gateway -.->|"prompt/response/token logs"| GatewayDash["AI Gateway Dashboard"]

  classDef frontend fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#fff;
  classDef backend fill:#f59e0b,stroke:#78350f,stroke-width:2px,color:#000;
  classDef storage fill:#10b981,stroke:#064e3b,stroke-width:2px,color:#fff;
  classDef ai fill:#ec4899,stroke:#831843,stroke-width:2px,color:#fff;
  classDef obs fill:#8b5cf6,stroke:#4c1d95,stroke-width:2px,color:#fff;

  class Browser frontend;
  class Router,ChatDO,ReAct,Tools backend;
  class D1,DOStorage,DOSQLite,Handbook storage;
  class AI,Gateway ai;
  class TailWorker,GatewayDash obs;
```

**Notes:**

- `routeAgentRequest()` from Agents SDK automatically routes to Chat Durable Object instances
- Each user gets their own Durable Object instance (isolated state)
- Session validation happens in Hono middleware before reaching agent
- Tools are executed synchronously within ReAct loop
- All Workers AI calls route through **AI Gateway** (`approvalflow-ai`) for token/latency logging and response caching (`cacheTtl: 3600`)
- The **Tail Worker** (`src/tail.ts`) is a separately deployed consumer that receives Agents SDK diagnostics and Worker logs/exceptions for forwarding to external sinks

---

### Message & Agent Sequence Flow

```mermaid
sequenceDiagram
  participant U as User (Browser)
  participant UI as React UI<br/>(app.tsx)
  participant S as Hono Server<br/>(server.ts)
  participant C as Chat DO<br/>(AIChatAgent)
  participant R as ReAct Loop<br/>(react-agent.ts)
  participant T as Tools<br/>(tools.ts)
  participant DB as D1 Database<br/>(APP_DB)
  participant GW as AI Gateway<br/>(approvalflow-ai)
  participant AI as Workers AI<br/>(env.AI)

  U->>UI: Type message + submit
  UI->>S: POST /agents/chat<br/>(session cookie)
  S->>DB: getUserFromSession()<br/>(validate session token)
  DB-->>S: User object
  S->>S: Inject X-User-Id header
  S->>C: routeAgentRequest()<br/>(WebSocket upgrade)
  C->>C: Extract userId from headers<br/>Store in DO storage
  C->>C: onChatMessage()<br/>(build conversation history)
  C->>R: runReActAgent(<br/>message, history, context)

  loop ReAct Loop (max 15 iterations)
    R->>GW: generateText()<br/>(system prompt + history)
    GW->>AI: forward request<br/>(logged + cached)
    AI-->>GW: model response
    GW-->>R: response (+ log entry)

    alt Tool call detected
      R->>R: Parse TOOL_CALL pattern<br/>Extract tool name + params
      R->>UI: onToolUpdate()<br/>state: input-available
      R->>T: Execute tool<br/>(e.g., validate_pto_policy)
      T->>DB: Query D1<br/>(pto_balances, calendar, etc.)
      DB-->>T: Results
      T-->>R: Tool result<br/>(validation, balance, conflicts)
      R->>UI: onToolUpdate()<br/>state: output-available
      R->>R: Add observation to history<br/>Continue loop
    else No tool call
      R->>R: Break loop
    end
  end

  R-->>C: Final response + tool calls + steps
  C->>C: saveMessages()<br/>(persist to DO SQLite)
  C-->>UI: Final assistant message
  UI->>U: Display response + tool cards

  opt User confirms tool
    U->>UI: Click "Approve" on ToolInvocationCard
    UI->>C: addToolResult() + sendMessage()
    C->>R: Continue with confirmation
  end
```

**Notes:**

- Tools requiring confirmation render as `ToolInvocationCard` components in UI
- User can approve/reject before agent proceeds
- Conversation history saved to Durable Object SQLite for persistence
- Each ReAct iteration calls atomic `generateText()` (not token streaming); the streaming UX comes from discrete `onToolUpdate()` events emitted per tool call
- Every Workers AI call is routed through AI Gateway, which logs prompt/response/token/latency data and applies response caching independent of application logic

---

### PTO Request Flow (End-to-End)

```mermaid
flowchart TD
  Start["User: I need 3 days off next week"]
  Start --> Agent[Chat Agent receives message]

  Agent --> T1[Tool: get_current_user]
  T1 --> D1_1[("D1: Query users table")]
  D1_1 --> T1_Result[Result: employee_id, level, manager]

  T1_Result --> T2[Tool: get_pto_balance]
  T2 --> D2_1[("D1: Query pto_balances")]
  D2_1 --> T2_Result[Result: 15 days available]

  T2_Result --> ParseDates[Agent parses natural language dates]
  ParseDates --> T3[Tool: calculate_business_days]
  T3 --> D3_1[("D1: Query company_calendar")]
  D3_1 --> T3_Result[Result: 3 business days]

  T3_Result --> T4[Tool: check_blackout_periods]
  T4 --> D4_1[("D1: Query company_calendar")]
  D4_1 --> Conflict{Conflicts found?}

  Conflict -->|Yes| AgentWarn[Agent warns user]
  Conflict -->|No| T5[Tool: validate_pto_policy]

  T5 --> D5_1[("D1: Query users, pto_balances")]
  D5_1 --> AutoApproval{Auto-approval eligible?}

  AutoApproval -->|"Yes (≤10 days senior /<br/>≤3 days junior)"| T6A["Tool: submit_pto_request<br/>status=auto_approved"]
  AutoApproval -->|No| T6B["Tool: submit_pto_request<br/>status=pending"]

  T6A --> D6[("D1: Insert pto_requests<br/>Update pto_balances<br/>Insert audit_log")]
  T6B --> D6

  D6 --> AgentResponse["Agent: Your request has been submitted<br/>Status: Auto-approved / Pending manager review"]
  AgentResponse --> End[User sees confirmation]

  classDef toolNode fill:#f59e0b,stroke:#78350f,stroke-width:2px,color:#000;
  classDef dbNode fill:#10b981,stroke:#064e3b,stroke-width:2px,color:#fff;
  classDef decisionNode fill:#8b5cf6,stroke:#4c1d95,stroke-width:2px,color:#fff;
  classDef userNode fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#fff;

  class T1,T2,T3,T4,T5,T6A,T6B toolNode;
  class D1_1,D2_1,D3_1,D4_1,D5_1,D6 dbNode;
  class Conflict,AutoApproval decisionNode;
  class Start,End,Agent,AgentWarn,AgentResponse userNode;
```

**Auto-Approval Rules:**

- Senior employees: ≤10 business days
- Junior employees: ≤3 business days
- Must have sufficient balance
- No blackout period conflicts
- Otherwise escalates to manager

---

### Expense Submission Flow

```mermaid
flowchart TD
  Start["User: I need to submit an expense"]
  Start --> Agent[Chat Agent detects expense keywords]

  Agent --> T1[Tool: show_expense_dialog]
  T1 --> UI[UI: Open ExpenseSubmissionDialog]

  UI --> Upload["User uploads receipt<br/>(JPEG, PNG, PDF)<br/>POST /api/receipts/upload"]
  Upload --> OCR["Workers AI Vision OCR<br/>(@cf/llava-hf/llava-1.5-7b-hf)<br/>runs synchronously on upload"]
  OCR --> Extract["Extracted data stored in D1:<br/>amount, merchant, date, category"]
  Extract --> ToolFetch["Tool: process_receipt_image /<br/>get_receipt_data<br/>(agent retrieves stored OCR result)"]

  ToolFetch --> Review[User reviews and edits form]
  Review --> Submit[User clicks Submit]

  Submit --> T2[Tool: validate_expense_policy]
  T2 --> D1[("D1: Query users, expense policies")]
  D1 --> Valid{Within policy limits?}

  Valid -->|Yes| T3[Tool: submit_expense_request]
  Valid -->|No| AgentWarn[Agent warns: exceeds policy]

  T3 --> D2[("D1: Insert expense_requests<br/>Insert receipt_uploads<br/>Insert audit_log")]
  D2 --> T4[Tool: log_audit_event]

  T4 --> AgentResponse["Agent: Expense submitted<br/>Status: Pending manager approval"]
  AgentResponse --> End[User sees confirmation]

  classDef toolNode fill:#f59e0b,stroke:#78350f,stroke-width:2px,color:#000;
  classDef dbNode fill:#10b981,stroke:#064e3b,stroke-width:2px,color:#fff;
  classDef decisionNode fill:#8b5cf6,stroke:#4c1d95,stroke-width:2px,color:#fff;
  classDef userNode fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#fff;
  classDef uiNode fill:#ec4899,stroke:#831843,stroke-width:2px,color:#fff;

  class T1,T2,T3,T4,OCR,ToolFetch toolNode;
  class D1,D2 dbNode;
  class Valid decisionNode;
  class Start,End,Agent,AgentWarn,AgentResponse userNode;
  class UI,Upload,Extract,Review,Submit uiNode;
```

**Expense Categories:**

- `meals` - Food and beverages
- `travel` - Transportation costs
- `lodging` - Hotel accommodations
- `other` - Miscellaneous expenses

---

### Observability & AI Gateway Flow

```mermaid
flowchart LR
  ReAct["ReAct Loop<br/>(react-agent.ts)<br/>generateText() per iteration"]
  ReAct --> Gateway["AI Gateway<br/>(id: approvalflow-ai)"]
  Gateway --> Cache{"Cached response<br/>available?<br/>(cacheTtl: 3600)"}
  Cache -->|Yes| GWLog["Log cache hit<br/>Return cached response"]
  Cache -->|No| WorkersAI["Workers AI<br/>(Llama 3.3 70B / LLaVA / Whisper)"]
  WorkersAI --> GWLog2["Log prompt, response,<br/>tokens, latency"]
  GWLog --> Dash["AI Gateway Dashboard<br/>(dash.cloudflare.com)"]
  GWLog2 --> Dash
  GWLog2 --> ReAct
  GWLog --> ReAct

  ChatDO["Chat Durable Object<br/>(server.ts)"] -->|"observability.emit()"| Diag["Agents SDK Diagnostics<br/>(structured JSON)"]
  Router["Hono Router<br/>(server.ts)"] -->|"console.log / console.error"| WorkerLogs["Worker Logs"]

  Diag --> TailWorker["Tail Worker<br/>(src/tail.ts)<br/>separate deploy, wrangler.tail.jsonc"]
  WorkerLogs --> TailWorker
  TailWorker -->|"forward (extend handler)"| Sink[("External sink<br/>Honeycomb / Grafana / Axiom")]

  Traces["Workers OTel Traces<br/>(wrangler.jsonc observability.traces)"] -.->|"automatic spans:<br/>D1, DO, Workers AI"| Sink

  classDef ai fill:#ec4899,stroke:#831843,stroke-width:2px,color:#fff;
  classDef backend fill:#f59e0b,stroke:#78350f,stroke-width:2px,color:#000;
  classDef obs fill:#8b5cf6,stroke:#4c1d95,stroke-width:2px,color:#fff;
  classDef decision fill:#3b82f6,stroke:#1e3a8a,stroke-width:2px,color:#fff;

  class ReAct,WorkersAI ai;
  class Gateway,GWLog,GWLog2 ai;
  class ChatDO,Router backend;
  class Diag,WorkerLogs,TailWorker,Dash,Sink,Traces obs;
  class Cache decision;
```

**Notes:**

- The gateway sits between the agent and Workers AI with **zero inference-code changes** — it is purely a `gateway` option on `createWorkersAI()`.
- The Tail Worker is a template: `src/tail.ts` currently `console.log`/`console.error`'s normalized JSON — forwarding to a real sink (HTTP POST, Queues, R2) is left as an integration point.
- OTel traces, AI Gateway logs, and Agents SDK diagnostics are three independent channels; none depends on the others being enabled.

---

### Evaluation Pipeline

```mermaid
flowchart LR
  Golden["docs/evals/golden_queries.json<br/>10 queries × 5 categories<br/>(direct_answer, clarification,<br/>workflow, safety)"]
  Runner["tests/evals/golden_queries.test.ts<br/>npm run eval →<br/>vitest.evals.config.ts"]
  Seed[("In-memory D1<br/>seeded per query:<br/>users, balances, calendar")]
  Agent["runReActAgent()<br/>real Workers AI inference<br/>(via AI Gateway)"]
  Grade["Graders<br/>tools_required / tools_forbidden<br/>response_contains_any / _none"]
  Result{"Pass / Fail"}

  Golden --> Runner
  Runner --> Seed
  Runner --> Agent
  Seed --> Agent
  Agent -->|"tool call trace + final response"| Grade
  Grade --> Result

  classDef data fill:#10b981,stroke:#064e3b,stroke-width:2px,color:#fff;
  classDef proc fill:#f59e0b,stroke:#78350f,stroke-width:2px,color:#000;
  classDef ai fill:#ec4899,stroke:#831843,stroke-width:2px,color:#fff;
  classDef decision fill:#8b5cf6,stroke:#4c1d95,stroke-width:2px,color:#fff;

  class Golden,Seed data;
  class Runner,Grade proc;
  class Agent ai;
  class Result decision;
```

---

## Key Implementation Details

### 1. Why Manual ReAct Loop?

**Problem:** Workers AI models have inconsistent support for structured function calling.

**Solution:** Custom ReAct implementation with regex-based tool detection.

**Benefits:**

- 100% reliable tool calling with current Workers AI models
- Full control over tool execution flow
- Easier debugging of tool call patterns
- Robust JSON cleanup and error recovery

**Trade-offs:**

- More verbose code than native AI SDK tools
- Manual parsing of tool calls
- Need to maintain regex patterns

### 2. Conversation Context Management

**Challenge:** Workers AI context window limits.

**Strategy:**

- Limit to last 4 messages (2 conversation turns)
- System prompt regenerated on each iteration
- Tool results compressed in observations
- Conversation history persisted in DO SQLite for future reference

### 3. Streaming Architecture

**Problem:** The `workers-ai-provider`'s `streamText()` implementation double-emitted tokens (each token appeared twice), so it can't be used per ReAct iteration.

**Flow:**

1. Each ReAct iteration calls atomic `generateText()` (routed through AI Gateway) instead of streaming tokens
2. Tool execution is streamed discretely instead: an `onToolUpdate()` callback fires with `state: "input-available"` when a tool starts and `state: "output-available"` (or `"output-error"`) when it finishes
3. Callback sends these tool-update events to the UI via WebSocket
4. React UI renders/updates the corresponding `ToolInvocationCard` in real time
5. Final message saved to DO SQLite

**Benefits:**

- Immediate feedback on agent progress without the provider's token-streaming bug
- Users see exactly which tool is running and its result as it happens
- Graceful handling of long multi-tool workflows

### 4. Tool Confirmation UI

**Pattern:**

```typescript
// Agent returns tool call in message
{
  role: 'assistant',
  parts: [
    { type: 'tool-call', toolCallId: 'xyz', toolName: 'submit_pto_request', args: {...} }
  ]
}

// UI renders ToolInvocationCard
// User clicks "Approve"
// UI sends tool result back to agent
addToolResult({ toolCallId: 'xyz', result: { approved: true } })
```

**Tools requiring confirmation:**

- `submit_pto_request`
- `submit_expense_request`
- High-impact actions

### 5. Durable Object State Management

**Stored in DO Storage:**

```typescript
await this.ctx.storage.put("userId", userId);
await this.ctx.storage.put("username", username);
```

**Stored in DO SQLite:**

```typescript
await this.sql(
  `INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)`
)
  .bind(role, content, Date.now())
  .run();
```

**Benefits:**

- User context persists across sessions
- Conversation history available for context
- Isolated state per user
- Automatic replication and durability

---

## Data Flows

### Authentication Flow

```mermaid
flowchart LR
  A["User submits<br/>Login Form"] --> B["POST /api/auth/login"]
  B --> C["Validate Password<br/>(PBKDF2-SHA256)"]
  C --> D["Create Session in D1"]
  D --> E["Set HTTP-only Cookie"]
  E --> F["Return User Object"]
  F --> G["Subsequent Requests"]
  G --> H["Extract Cookie"]
  H --> I["getUserFromSession()"]
  I --> J["Query D1 sessions"]
  J --> K["Validate Expiry"]
  K --> L["Inject X-User-Id Header"]
```

### PTO Request Flow

```mermaid
flowchart LR
  A["User Message"] --> B["Chat Agent"]
  B --> C["get_current_user"]
  C --> D["get_pto_balance"]
  D --> E["Parse Dates"]
  E --> F["calculate_business_days"]
  F --> G["check_blackout_periods"]
  G --> H["validate_pto_policy"]
  H --> I["submit_pto_request<br/>(AI Gateway-logged inference)"]
  I --> J["Insert pto_requests"]
  J --> K["Update pto_balances"]
  K --> L["Insert audit_log"]
  L --> M["Return Confirmation"]
  M --> N["Stream to UI"]
```

### Expense Request Flow

```mermaid
flowchart LR
  A["User Message"] --> B["Chat Agent"]
  B --> C["show_expense_dialog<br/>(UI action)"]
  C --> D["UI Modal Opens"]
  D --> E["User Uploads Receipt"]
  E --> F["Workers AI Vision OCR<br/>(on upload, synchronous)"]
  F --> G["process_receipt_image /<br/>get_receipt_data"]
  G --> H["User Reviews & Submits Form"]
  H --> I["validate_expense_policy"]
  I --> J["submit_expense_request"]
  J --> K["Insert expense_requests"]
  K --> L["Insert receipt_uploads"]
  L --> M["Insert audit_log"]
  M --> N["Return Confirmation"]
  N --> O["Stream to UI"]
```

---

## File Structure

### Source Code (`src/`)

```
src/
├── server.ts              (1,437 lines) - Hono server + Chat Durable Object + AI Gateway wiring
├── react-agent.ts         (328 lines)   - ReAct loop implementation
├── tools.ts               (1,438 lines) - 15 tool implementations
├── prompts.ts             (278 lines)   - System prompt + handbook search
├── tail.ts                (63 lines)    - Tail Worker (separate deployable, log/diagnostics forwarding)
├── ingest_handbook.ts     (364 lines)   - Handbook ingestion script
├── shared.ts                           - Shared constants
├── utils.ts               (122 lines)  - Shared helpers
├── app.tsx                (675 lines)   - Main React chat UI
├── client.tsx                          - React DOM entry point
├── components/                         - UI component library
│   ├── auth/              - Login component
│   ├── expense/           - ExpenseSubmissionDialog
│   ├── tool-invocation-card/ - ToolInvocationCard
│   └── [UI primitives]    - Button, Card, Input, Modal, etc.
├── hooks/
│   └── useAuth.ts         - Authentication hook
└── providers/
    ├── AuthProvider.tsx   - Auth context provider
    └── ModalProvider.tsx  - Modal context provider
```

### Evaluation & Tests (`docs/evals/`, `tests/`)

```
docs/evals/
├── golden_queries.json        - 10 golden queries + graders + demo user fixtures
├── golden_queries_plan.md     - Design notes for the eval suite
└── transcripts/                - (empty, .gitkeep) reserved for saved run transcripts

tests/
├── index.test.ts               - Main Vitest suite (npm test)
└── evals/
    └── golden_queries.test.ts  - Golden-query regression suite (npm run eval)
```

### Database (`migrations/`)

```
migrations/
├── 0000_drop_all_tables.sql          - Development reset
├── 0001_create_auth_tables.sql       - Users + sessions + demo users
├── 0002_create_pto_requests_table.sql
├── 0003_create_pto_balances_table.sql
├── 0004_create_expense_requests_table.sql
├── 0005_create_company_calendar_table.sql
├── 0006_create_audit_log_table.sql
├── 0007_seed_pto_balances.sql
└── 0008_create_receipt_uploads_table.sql
```

9 sequential migration files (`0000`–`0008`), applied via [scripts/d1/apply_migrations.sh](../scripts/d1/apply_migrations.sh).

### Configuration

```
wrangler.jsonc            - Cloudflare Workers config
vite.config.ts            - Vite build config
tsconfig.json             - TypeScript config
tailwind.config.ts        - Tailwind CSS config
package.json              - Dependencies
```

### Documentation (`docs/`)

```
docs/
├── ARCHITECTURE.md          - This file
├── PROJECT_OVERVIEW.md      - Product/engineering-depth overview with live architecture diagram
├── TEST_SCENARIOS.md        - Manual agent behavior test scenarios
├── evals/                   - Golden-query eval suite (see Evaluation Framework)
├── features/                - Feature/persona planning docs
└── handbook/
    └── employee_handbook.md - Company policies for AI (queried by search_employee_handbook)
```

---

## Design Contracts

### Inputs

- **HTTP Requests:** From browser with session cookie for authentication
- **Agent Messages:** User text via WebSocket connection
- **File Uploads:** Receipt images (JPEG, PNG, PDF)

### Outputs

- **Streaming Assistant Text:** Real-time AI responses via WebSocket
- **Tool Call Results:** Structured data from tool executions
- **Database Updates:** PTO requests, expense requests, sessions, audit logs
- **UI Actions:** Expense dialog triggers, tool confirmation cards

### Error Modes

- **Missing Auth/Session:** 401 Unauthorized response
- **Tool Errors:** Agent fallback message with error details
- **AI Provider Not Configured:** UI banner + `/check-ai-provider` endpoint returns failure
- **Invalid Tool Parameters:** Agent re-prompts user for correct input
- **Database Errors:** Logged to console, agent notifies user

---

## Known Limitations & Future Enhancements

### Current Limitations

1. **Vector Search Not Active:** VECTORIZE binding configured but not used; handbook search uses direct LLM queries
2. **Conversation History:** Limited to last 4 messages (2 turns) due to context window constraints
3. **No Real-time Notifications:** Managers don't receive real-time notifications for pending requests
4. **Receipt Storage:** File uploads not persisted to R2 or other object storage (metadata only in D1)
5. **Manual ReAct Loop:** Less efficient than native AI SDK tool framework but more reliable with current models
6. **Tail Worker Not Wired Up by Default:** `src/tail.ts` is deployable but `tail_consumers` is commented out in `wrangler.jsonc` until deployed
7. **Evals Not in CI:** `npm run eval` is a manual/local regression gate; `.github/workflows/sanity-check.yml` only runs `npm run check`

### Potential Enhancements

- Add Cloudflare Queues for async manager notifications
- Store receipt images in R2 with signed URLs
- Implement vector search for handbook queries (chunk + embed docs)
- Add automated PTO accrual calculations on schedule
- Support for multi-language conversations
- Manager dashboard for approving/denying requests
- Integration with calendar systems (Google Calendar, Outlook)
- Wire the golden-query eval suite into CI as a pre-deploy gate
- Forward Tail Worker output to a real sink (Honeycomb, Grafana, Axiom) instead of `console.log`

---

## How to View These Diagrams

- The diagrams use Mermaid syntax (fenced code blocks)
- View in VS Code with Mermaid preview extension
- Render online at [mermaid.live](https://mermaid.live)
- GitHub automatically renders Mermaid diagrams in markdown

---

## Quick Reference

### Key Files by Concern

| Concern             | File(s)                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Entry Point         | [src/server.ts](../src/server.ts)                                                                                           |
| Agent Logic         | [src/server.ts](../src/server.ts) (Chat class), [src/react-agent.ts](../src/react-agent.ts)                                 |
| Tools               | [src/tools.ts](../src/tools.ts)                                                                                             |
| System Prompt       | [src/prompts.ts](../src/prompts.ts)                                                                                         |
| Frontend UI         | [src/app.tsx](../src/app.tsx), [src/client.tsx](../src/client.tsx)                                                          |
| Auth                | [src/server.ts](../src/server.ts) (getUserFromSession), [src/providers/AuthProvider.tsx](../src/providers/AuthProvider.tsx) |
| Database Schema     | [migrations/](../migrations/)                                                                                               |
| Config              | [wrangler.jsonc](../wrangler.jsonc)                                                                                         |
| AI Gateway Config   | [src/react-agent.ts](../src/react-agent.ts) (`gateway` option), [wrangler.jsonc](../wrangler.jsonc)                         |
| Tail Worker         | [src/tail.ts](../src/tail.ts), [wrangler.tail.jsonc](../wrangler.tail.jsonc)                                                |
| Eval Suite          | [docs/evals/golden_queries.json](../docs/evals/golden_queries.json), [tests/evals/golden_queries.test.ts](../tests/evals/golden_queries.test.ts), [vitest.evals.config.ts](../vitest.evals.config.ts) |

### Important Constants

- **AI Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (reasoning), `@cf/llava-hf/llava-1.5-7b-hf` (receipt OCR), `@cf/openai/whisper-large-v3-turbo` (voice, with `@cf/deepgram/nova-3` fallback)
- **Max ReAct Iterations:** 15
- **Conversation Context:** Last 4 messages (2 turns)
- **Auto-Approval Limits:** Senior ≤10 business days, Junior ≤3 business days
- **Max PTO Rollover:** 5 days per year
- **Session Expiry:** Set in session creation (not hardcoded globally)
- **AI Gateway ID:** `approvalflow-ai` (`cacheTtl: 3600`)

### Useful Commands

```bash
npm start              # Local dev server
npm run deploy         # Deploy to Cloudflare
npm run d1:apply       # Apply database migrations
npm run check          # Run all code quality checks
npm test               # Run unit/integration tests
npm run eval           # Run golden-query eval suite (real Workers AI inference)

# Tail Worker (deploy separately for production log forwarding)
wrangler deploy --config wrangler.tail.jsonc
# Then uncomment "tail_consumers" in wrangler.jsonc and redeploy
```
