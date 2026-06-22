<table>
  <tr>
    <td width="200">
      <img src="public/Enterprise AI Approval Workflow Logo.png" alt="ApprovalFlow AI" width="200" />
    </td>
    <td valign="middle">
      <h1>ApprovalFlow AI</h1>
      <blockquote>
        <strong>🚀 <a href="https://approvalflow-ai.ra-kuppasundarar.workers.dev/">Try the Live Demo</a></strong> | Login with the quick demo options to test PTO requests &amp; expense reimbursement
      </blockquote>
    </td>
  </tr>
</table>

## Your company's instant HR — get PTOs approved & expenses reimbursed in seconds, all in natural language

Built on Cloudflare's agent platform using the [`agents`](https://www.npmjs.com/package/agents) SDK.

## What is ApprovalFlow AI?

**ApprovalFlow AI** is your company's instant HR assistant that lives in a chat window. Instead of filling out forms and waiting days for approval, just say "I need time off next week" or "I want to submit this lunch receipt" — and the AI handles everything automatically. It checks your balance, validates company policies, and approves requests in seconds.

Behind the scenes it orchestrates 15 specialized tools, processes receipts with computer vision, and follows your company's rulebook to the letter. Whether you're a junior engineer requesting 3 days off or a senior manager expensing a client dinner, the AI knows the rules, checks eligibility, and either approves instantly or escalates to your manager. No email chains. No waiting. Just chat and go.

## Features

- 💬 **Conversational AI** — natural language interface with real-time streaming responses via WebSocket
- 🌴 **PTO Workflow** — auto-approve, deny, or escalate requests based on company policies and employee level
- 🧾 **Expense Reimbursement** — receipt OCR processing with Workers AI Vision, policy validation, and instant approval
- 🛠️ **15 Specialized Tools** — automatic context injection, privacy-enforced data access, and human-in-the-loop confirmations
- 🔒 **Privacy Enforcement** — tool-level guards ensure users can only access their own data; `employee_id` overrides are rejected server-side regardless of what the LLM passes
- 📊 **Observability** — Workers automatic tracing (OTel), agents SDK diagnostics, and AI Gateway logging for every model call
- 🌓 **Dark/Light theme** — persisted via localStorage
- ⚡ **Real-time streaming** — Durable Object WebSocket with incremental tool-call updates in the UI
- 🔐 **Secure auth** — PBKDF2 password hashing, HTTP-only session cookies

## Demo Videos

### PTO workflow & employee handbook Q&A

https://github.com/user-attachments/assets/08cdad5b-6fdd-42cc-9906-7f8f197fada8

### Agent recovering from a tool failure and completing the workflow (policy rejection)

https://github.com/user-attachments/assets/d2e0aa7f-6b32-495e-aaef-f503ebc58521

### Submitting an expense reimbursement

https://github.com/user-attachments/assets/567b9d7c-169e-4614-bedc-31b9b03c6c42

---

## For Recruiters & Hiring Managers

**Live Demo**: [https://approvalflow-ai.ra-kuppasundarar.workers.dev/](https://approvalflow-ai.ra-kuppasundarar.workers.dev/)

### Quick Start (< 2 minutes)

1. **Login** with any test account:
   - `ramya_junior` / `Password123!` — junior engineer, 3-day PTO auto-approval, $100 expense limit
   - `ramya_senior` / `Password123!` — senior engineer, 10-day PTO auto-approval, $500 expense limit
   - `ramya_manager` / `Password123!` — manager, reviews escalated requests

2. **Try these prompts**:

   **PTO Requests**
   ```
   "I need PTO from December 23-27"
   "What's my PTO balance?"
   "Can I take 15 days off in March?"
   ```

   **Expense Reimbursement**
   ```
   "I want to submit an expense"
   "I need to get reimbursed for a client dinner"
   ```
   Upload a receipt image — the AI extracts merchant, amount, date, and line items using computer vision, validates against company policies, and approves instantly or escalates.

3. **Watch the AI work** — see real-time tool invocations as it checks balances, validates policies, processes receipt OCR, and makes approval decisions, all in seconds.

### What Makes This Noteworthy

**Core Technologies**

- ✅ **Llama 3.3 70B on Workers AI** — main chat model (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- ✅ **Durable Objects** — stateful chat sessions with SQLite persistence via Agents SDK
- ✅ **Workers AI Vision** — OCR receipt processing with `@cf/llava-hf/llava-1.5-7b-hf`
- ✅ **D1 Database** — relational data for users, PTO balances, expenses, audit logs
- ✅ **AI Gateway** — per-request LLM observability: token counts, latency, prompt/response logs, and response caching across all three models
- ✅ **Workers OTel Tracing** — automatic end-to-end traces for every D1 query, Durable Object call, and Workers AI invocation
- ✅ **Real-time Streaming** — tool invocations stream to the UI as they execute
- ✅ **Production-ready Auth** — PBKDF2 password hashing, HTTP-only session cookies

**Technical Highlights**

- **ReAct Agent Framework** — custom iterative tool-calling loop ([src/react-agent.ts](src/react-agent.ts))
- **Privacy-enforced Tools** — `employee_id` is stripped from all tool schemas; every tool resolves identity from the authenticated session only, making it impossible for the LLM to access another user's data
- **Policy Enforcement** — AI reads the employee handbook dynamically; updating policies requires only editing a markdown file, no retraining
- **Computer Vision** — extracts merchant, amount, date, and line items from receipt images using Workers AI Vision
- **Human-in-the-Loop** — manager escalation for requests exceeding auto-approval thresholds
- **Agents SDK Observability** — structured diagnostics for every RPC call, state change, and message lifecycle event

---

## For Engineers

### Architecture Overview

**Core Stack**

| Layer | Technology |
|-------|-----------|
| Agent Runtime | [`agents`](https://www.npmjs.com/package/agents) SDK v0.2.20 + Durable Objects |
| LLM Orchestration | Custom ReAct loop in [`src/react-agent.ts`](src/react-agent.ts) via Vercel AI SDK |
| Chat Model | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) |
| Vision / OCR | LLaVA 1.5 7B (`@cf/llava-hf/llava-1.5-7b-hf`) |
| Handbook Search | Llama 3.1 8B (`@cf/meta/llama-3.1-8b-instruct`) |
| State | Durable Object SQLite (chat history) + D1 (relational data) |
| Frontend | React 19 + Vite with `useAgent` hook from `agents/react` |
| Router | Hono v4 with session middleware |
| Observability | Workers OTel tracing + AI Gateway + Agents SDK diagnostics + Tail Worker |

### How the ReAct Agent Works

1. **User Input** → LLM parses intent and decides which tools to call
2. **Tool Execution** → Queries D1, validates policies, calculates business days
3. **Observation** → LLM analyzes tool results and decides next action
4. **Iteration** → Repeats up to 15 times until all required information is gathered
5. **Response** → Synthesizes final answer with approval/denial/escalation

**Key Implementation Details**

- **Manual Tool Calling** — Workers AI requires custom tool parsing; implemented as a `TOOL_CALL: tool_name` / `PARAMETERS: {...}` pattern with regex-based extraction ([src/prompts.ts](src/prompts.ts))
- **Streaming Tool Updates** — invocations stream to the UI in real-time via WebSocket callbacks
- **Context Window Management** — conversation history limited to last 4 messages to fit within model limits
- **Output Token Cap** — `maxOutputTokens: 1024` on every `generateText` call prevents mid-sentence cutoffs

### Tool System Design

All 15 tools follow a consistent interface in [`src/tools.ts`](src/tools.ts):

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}
```

**Privacy-enforced Context Injection** — every tool receives `{ env: Env, userId: string }` from the authenticated session. The `employee_id` parameter has been removed from all tool schemas so the LLM cannot override the authenticated identity. The user ID flows from:

1. Login → session cookie → D1 `sessions` table
2. Middleware validates session → injects `X-User-Id` header
3. Durable Object persists `userId` in storage → all tools use `context.userId`

**PTO Tool Chain**
```
get_current_user()
  → get_pto_balance()
  → calculate_business_days(start, end)
  → validate_pto_policy(dates)
  → submit_pto_request(status)
```

**Expense Tool Chain**
```
show_expense_dialog()
  → get_current_user()
  → validate_expense_policy(amount, category, has_receipt)
  → submit_expense_request(status)
```

### Observability & Monitoring

Three complementary layers run in production:

**1. Workers Automatic Tracing** ([wrangler.jsonc](wrangler.jsonc))
```jsonc
"observability": {
  "traces": { "enabled": true, "head_sampling_rate": 1 }
}
```
Zero-code OTel traces for every D1 query, Durable Object invocation, and Workers AI call. Export to Honeycomb, Grafana, or Axiom by adding a destination in the Workers dashboard.

**2. Agents SDK Diagnostics** ([src/server.ts](src/server.ts))
```typescript
override observability: Observability = {
  emit(event) {
    const isError = event.type.endsWith(":error");
    const entry = JSON.stringify({ src: "agent-sdk", evt: event.type, event });
    isError ? console.error(entry) : console.log(entry);
  }
};
```
Structured JSON logs for every RPC call, state change, chat message, and WebSocket lifecycle event.

**3. AI Gateway** ([src/react-agent.ts](src/react-agent.ts))
```typescript
const workersai = createWorkersAI({
  binding: context.env.AI,
  gateway: { id: "approvalflow-ai", skipCache: false, cacheTtl: 3600 }
});
```
Per-request token counts, latency, and prompt/response logs for all LLM calls. Response caching reduces cost for repeated queries. View logs at `dash.cloudflare.com → AI → AI Gateway`.

**4. Tail Worker** ([src/tail.ts](src/tail.ts))
Captures all diagnostics channel events, worker logs, and unhandled exceptions in production. Deploy separately with `wrangler deploy --config wrangler.tail.jsonc`, then uncomment `tail_consumers` in [wrangler.jsonc](wrangler.jsonc).

### Policy Enforcement

The AI reads the employee handbook dynamically rather than hardcoding rules:

```typescript
const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
  messages: [{ role: "user", content: getHandbookSearchPrompt(handbookContent, query) }]
});
```

Updating company policies requires only editing [`docs/handbook/employee_handbook.md`](docs/handbook/employee_handbook.md). No retraining needed.

- **PTO**: balance check → blackout period conflicts → auto-approval threshold (3 days junior, 10 days senior)
- **Expenses**: receipt requirement (>$75) → daily limits → non-reimbursable item check → auto-approval threshold ($100 junior, $500 senior)

### Computer Vision Pipeline

1. User uploads receipt → stored as base64 in D1 `receipt_uploads` table
2. `@cf/llava-hf/llava-1.5-7b-hf` extracts amount, merchant, date, and line items as structured JSON
3. Extracted data stored in `extracted_data` column and passed to `validate_expense_policy`

### Running Locally

```bash
npm install
npm start            # Vite + Wrangler dev server
npm run deploy       # Build and deploy to Cloudflare
npm run d1:apply     # Apply pending D1 migrations
npm run check        # Prettier + Biome lint + TypeScript
npm test             # Run tests with Vitest
```

**Environment Setup**
- D1 database configured in `wrangler.jsonc`
- Demo users seeded via `migrations/0001_create_auth_tables.sql` (password: `Password123!`)
- No external API keys required — all inference runs on Workers AI
- AI Gateway: create at `dash.cloudflare.com → AI → AI Gateway`, set the gateway ID in [src/react-agent.ts](src/react-agent.ts)

### Code Navigation

| File | Purpose |
|------|---------|
| [src/server.ts](src/server.ts) | `Chat` Durable Object — session handling, agents SDK observability override, Hono routes |
| [src/react-agent.ts](src/react-agent.ts) | `runReActAgent()` — ReAct loop, tool parsing, AI Gateway config |
| [src/prompts.ts](src/prompts.ts) | System prompt — tool descriptions, privacy rules, capability examples |
| [src/tools.ts](src/tools.ts) | All 15 tools with privacy-enforced execute functions |
| [src/tail.ts](src/tail.ts) | Tail Worker — production log forwarding (deploy separately) |
| [src/app.tsx](src/app.tsx) | React chat UI with `useAgent` and `useAgentChat` hooks |
| [migrations/](migrations/) | D1 migration files |
| [docs/handbook/employee_handbook.md](docs/handbook/employee_handbook.md) | Company policies — edit to update rules without redeployment |
| [wrangler.jsonc](wrangler.jsonc) | Workers config — AI binding, D1, Durable Objects, OTel tracing |
| [wrangler.tail.jsonc](wrangler.tail.jsonc) | Tail Worker deployment config |

### Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Employee profiles (level, manager, department) |
| `sessions` | Auth sessions with expiry |
| `pto_requests` | PTO request records with approval workflow |
| `pto_balances` | Accrual and usage tracking |
| `company_calendar` | Holidays and blackout periods |
| `expense_requests` | Expense reimbursement workflow |
| `receipt_uploads` | Base64 receipt images + OCR extracted data |
| `audit_log` | Compliance event tracking |

### Why This Architecture?

**Durable Objects for Chat State** — each user gets an isolated DO instance with embedded SQLite. No cold-start penalty for reconstructing context, strong consistency for multi-turn conversations, automatic WebSocket management.

**D1 for Application Data** — relational queries, complex JOINs, and ACID transactions for balance updates and audit logs.

**Workers AI for Inference** — all models run on Cloudflare's edge network. Zero external API dependencies, sub-second latency for tool-calling loops.

**AI Gateway as LLM Control Plane** — unified observability across all three models (Llama 3.3 70B, LLaVA, Whisper) through a single binding config change. Adds caching, rate limiting, and per-request logging with no code changes.

### Contributing & Extending

**Adding a New Tool**
1. Define in `src/tools.ts` with `name`, `description`, `parameters`, `execute`
2. Never accept `employee_id` as a parameter — always use `context.userId`
3. Add to the `tools` export object
4. Update `src/prompts.ts` to describe when to use the tool

**Modifying Policies**
- Edit `docs/handbook/employee_handbook.md`
- The agent queries updated policies automatically via `search_employee_handbook`

**Changing Models**
- ⚠️ Do not change `@cf/meta/llama-3.3-70b-instruct-fp8-fast` without comprehensive testing — other models have different function-calling behavior with the custom ReAct parser
