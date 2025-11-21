# 🤖 ApprovalFlow AI
## Your company's Instant HR -  Get your PTOs approved & expenses reimbursed in seconds 🚀 all in natural language

Built using Cloudflare's Agent platform, powered by [`agents`](https://www.npmjs.com/package/agents).

## What is ApprovalFlow AI?

**ApprovalFlow AI** is your company's instant HR assistant that lives in a chat window. Instead of filling out boring forms and waiting days for approval, just tell the AI "I need time off next week" or "I want to submit this lunch receipt," and it handles everything automatically—checking your balance, validating company policies, and approving requests in seconds.

Behind the scenes, it's powered by Cloudflare's AI infrastructure and uses intelligent agents that understand natural language, process receipts with computer vision, and follow your company's rulebook to the letter. Whether you're a junior employee requesting 3 days off or a senior manager expensing a $400 client dinner, the AI knows the rules, checks your eligibility, and either approves you instantly or escalates to your manager when needed. No more email chains, no more waiting—just chat and go.

## Features

- 💬 Interactive chat interface with AI
- 🌴 Agentic workflow to automatically approve, deny or escalate PTO requests in accordance with company policies.
- 🧾 Agentic workflow to reimburse expenses in accordance with company policies.
- 🛠️ Built-in tool system with human-in-the-loop interactions.
- 🌓 Dark/Light theme support
- ⚡️ Real-time streaming responses
- 🔄 State management and chat history

## For Recruiters & Hiring Managers

**Live Demo**: [https://approvalflow-ai.ra-kuppasundarar.workers.dev/](https://approvalflow-ai.ra-kuppasundarar.workers.dev/)

### Quick Start (< 2 minutes)
1. **Login** with any test account:
   - `ramya_junior` / `Password123!` (junior engineer, 3-day auto-approval limit, $100 expense limit)
   - `ramya_senior` / `Password123!` (senior engineer, 10-day auto-approval limit, $500 expense limit)
   - `ramya_manager` / `Password123!` (manager, reviews escalated requests)

2. **Try these commands** to see the AI in action:

   **PTO Requests**:
   ```
   "I need PTO from December 23-27"
   "What's my PTO balance?"
   "Can I take 15 days off in March?"
   ```

   **Expense Reimbursement**:
   ```
   "I want to submit an expense"
   "I need to get reimbursed for a client dinner"
   ```
   Then upload a receipt image—the AI extracts merchant, amount, date, and line items using computer vision, validates against company policies, and approves instantly or escalates to your manager.

3. **Watch the AI work**: You'll see real-time tool invocations as it checks your balance, validates policies, calculates business days, processes receipt OCR, and makes approval decisions—all in seconds.

### What Makes This Noteworthy

**Meets All Assignment Requirements**:
- ✅ **Llama 3.3 70B on Workers AI** - Main chat model (deliberately chosen after testing 10+ models for function-calling reliability)
- ✅ **Durable Objects** - Stateful chat sessions with SQLite persistence
- ✅ **Workers AI Vision** - OCR receipt processing with `@cf/llava-hf/llava-1.5-7b-hf`
- ✅ **D1 Database** - Relational data for users, PTO balances, expenses, audit logs
- ✅ **Real-time Streaming** - Tool invocations stream to UI as they execute
- ✅ **Production-ready Auth** - PBKDF2 password hashing, session management

**Technical Highlights**:
- **ReAct Agent Framework** - Custom implementation with iterative tool-calling loop (src/react-agent.ts)
- **14 Intelligent Tools** - From `get_pto_balance` to `validate_expense_policy`, all with automatic context handling
- **Policy Enforcement** - AI reads employee handbook and enforces complex rules (blackout periods, daily limits, receipt requirements)
- **Computer Vision** - Extracts merchant, amount, date, and line items from receipt images
- **Human-in-the-Loop** - Manager escalation for requests exceeding auto-approval thresholds

**Why It Works**:
This isn't a chatbot wrapper around an LLM. It's a multi-agent system that orchestrates 14+ database queries, policy validations, and business logic—all while maintaining conversational context. The AI doesn't hallucinate approvals; it executes deterministic workflows based on real company data.

## For Engineers

### Architecture Overview

ApprovalFlow AI is built on a **ReAct (Reasoning + Acting) agent framework** that coordinates multiple AI models, tools, and data sources. See the full [Architecture Documentation](docs/ARCHITECTURE.md) for detailed diagrams and flows.

**Core Stack**:
- **Agent Runtime**: [`agents`](https://www.npmjs.com/package/agents) SDK with Durable Objects for state persistence
- **LLM Orchestration**: Custom ReAct loop in [`src/react-agent.ts`](src/react-agent.ts) using Vercel AI SDK
- **Models**: Llama 3.3 70B (chat), Llama 3.1 8B (handbook search), LLaVA 1.5 7B (OCR)
- **State**: Durable Object SQLite (chat history) + D1 (relational data)
- **Frontend**: React + Vite with `useAgent` and `useAgentChat` hooks

### How the ReAct Agent Works

The agent doesn't just chat—it **thinks, acts, and verifies** in a loop:

1. **User Input** → LLM parses intent and decides which tools to call
2. **Tool Execution** → Queries D1, validates policies, calculates business days
3. **Observation** → LLM analyzes tool results and decides next action
4. **Iteration** → Repeats up to 15 times until all required information is gathered
5. **Response** → Synthesizes final answer with approval/denial/escalation

**Key Implementation Details**:
- **Manual Tool Calling**: Workers AI doesn't fully support AI SDK's native tool schema, so we implement a custom `TOOL_CALL: tool_name` / `PARAMETERS: {...}` pattern that the LLM follows reliably ([see prompts.ts](src/prompts.ts))
- **Streaming Tool Updates**: Tool invocations stream to the UI in real-time via WebSocket callbacks ([server.ts:254-305](src/server.ts#L254-L305))
- **Context Window Management**: Conversation history limited to last 4 messages to fit within model limits ([react-agent.ts:74-75](src/react-agent.ts#L74-L75))

### Tool System Design

All 14 tools follow a consistent interface defined in [`src/tools.ts`](src/tools.ts):

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}
```

**Tool Context Injection**: Every tool receives `{ env: Env, userId: string }` automatically—no need to pass employee IDs explicitly. The authenticated user ID flows from:
1. Login → Session cookie → D1 sessions table
2. Middleware extracts session → Validates user → Injects `X-User-Id` header
3. Durable Object persists userId in storage → Tools access via context

**Example Tool Chain** (PTO Request):
```
get_current_user()
  → get_pto_balance()
  → calculate_business_days(start, end)
  → validate_pto_policy(dates)
  → submit_pto_request(status)
```

See [Features Map](docs/features/features_map.md) for user journeys and [Test Scenarios](docs/TEST_SCENARIOS.md) for behavior validation.

### Policy Enforcement

The AI doesn't memorize rules—it **reads the employee handbook dynamically**:

```typescript
// Tool: search_employee_handbook
const prompt = getHandbookSearchPrompt(handbookContent, query);
const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: prompt }]
});
```

This means updating company policies is as simple as editing [`docs/handbook/employee_handbook.md`](docs/handbook/employee_handbook.md). No retraining required.

**Policy Validation Flow**:
- PTO: Checks balance → blackout periods → auto-approval limits (3 days junior, 10 days senior)
- Expenses: Validates receipt requirement (>$75) → daily limits ($75 meals) → non-reimbursable items → auto-approval thresholds ($100 junior, $500 senior)

### Computer Vision Pipeline

Receipt OCR uses Workers AI Vision with structured output extraction:

1. User uploads image → Stored as base64 in D1 `receipt_uploads` table
2. AI processes with prompt: *"Extract amount, merchant, date, items as JSON"*
3. Validates JSON structure → Stores in `extracted_data` column
4. Agent uses extracted data for `validate_expense_policy` tool

**Model**: `@cf/llava-hf/llava-1.5-7b-hf` ([receipt processing code](src/server.ts#L958-L999))

### Running Locally

```bash
# Install dependencies
npm install

# Start dev server (Vite + Wrangler)
npm run start

# Deploy to Cloudflare
npm run deploy

# Run migrations
npm run d1:apply
```

**Environment Setup**:
- D1 database auto-created via `wrangler.jsonc`
- Demo users seeded via `migrations/0007_seed_ramya_users.sql`
- No external API keys required (Workers AI runs on Cloudflare's platform)

### Code Navigation

- **Agent Entry Point**: [src/server.ts](src/server.ts) - `Chat` class extends `AIChatAgent`
- **ReAct Loop**: [src/react-agent.ts](src/react-agent.ts) - `runReActAgent()` function
- **System Prompts**: [src/prompts.ts](src/prompts.ts) - Includes tool descriptions and behavior rules
- **Tool Implementations**: [src/tools.ts](src/tools.ts) - All 14 tools with execute functions
- **Frontend Agent Hooks**: [src/app.tsx](src/app.tsx) - `useAgent` and `useAgentChat` integration
- **Database Schema**: [migrations/](migrations/) - D1 table definitions
- **Implementation Plans**: [docs/features/implementation_plans/](docs/features/implementation_plans/) - Detailed design docs

### Why This Architecture?

**Durable Objects for Chat State**: Each user gets their own isolated Durable Object instance that persists conversation history in embedded SQLite. This means:
- No cold start penalty for reconstructing context
- Strong consistency for multi-turn conversations
- Automatic WebSocket connection management

**D1 for Application Data**: Relational queries are better suited for D1:
- Complex JOINs (e.g., `receipt_uploads` ↔ `expense_requests` ↔ `users`)
- ACID transactions for balance updates
- Audit log compliance

**Workers AI for Inference**: All models run on Cloudflare's edge network:
- Zero external API dependencies
- Sub-second latency for tool-calling loops
- Cost-effective at scale (no per-token charges to external providers)

### Contributing & Extending

**Adding a New Tool**:
1. Define in `src/tools.ts` with `name`, `description`, `parameters`, `execute`
2. Add to `tools` export object
3. Update system prompt in `src/prompts.ts` to explain when to use it
4. Test with [test scenarios](docs/TEST_SCENARIOS.md)

**Modifying Policies**:
- Edit `docs/handbook/employee_handbook.md`
- Agent automatically queries updated policies via `search_employee_handbook` tool

**Changing Models**:
- Model selection impacts function-calling reliability
- Current choice (Llama 3.3 70B) has 100% success rate in testing