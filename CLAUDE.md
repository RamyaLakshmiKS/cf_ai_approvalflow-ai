# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI-powered approval flow application built on Cloudflare Workers using the `agents` SDK. It's a conversational agent system that handles employee PTO (Paid Time Off) requests and expense reimbursements through a chat interface. The application uses Workers AI for LLM capabilities, D1 for relational data storage, and Durable Objects for stateful chat sessions.

## Development Commands

### Running the Application

```bash
npm start                 # Start local dev server (uses Vite + Wrangler)
```

### Building and Deployment

```bash
npm run deploy           # Build and deploy to Cloudflare
npm run deploy:migrate   # Deploy and run D1 migrations
```

### Database Management

```bash
npm run d1:apply         # Apply pending D1 migrations
npm run d1:setup         # Deploy and seed database (full setup)
```

### Code Quality

```bash
npm run check            # Run all checks: prettier, biome lint, and TypeScript
npm run format           # Format code with Prettier
npm run types            # Generate TypeScript types from Wrangler config
npm test                 # Run tests with Vitest
```

## Architecture Overview

### Core Components

**1. Chat Agent System (`src/server.ts` - Chat class)**

- Extends `AIChatAgent` from the `agents` SDK
- Uses Durable Objects for stateful chat sessions (each user conversation is a separate DO instance)
- Implements the ReAct (Reasoning + Acting) framework via `runReActAgent()`
- Persists user context (`userId`, `username`) in Durable Object storage
- Handles authentication via session cookies and middleware

**2. AI Agent Implementation (`src/react-agent.ts`)**

- Uses Vercel AI SDK with Workers AI provider
- **Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`** ⚠️ DO NOT CHANGE without testing
- Implements a manual ReAct loop with tool calling support
- Maintains conversation history (limited to last 4 messages/2 turns for context window)

**⚠️ CRITICAL: Model Selection**

The model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` is currently being used for function calling. DO NOT change this model without extensive testing across multiple iterations with production tools.

**3. Tool System**

All tools are defined in `src/tools.ts` as manual tool definitions with typed parameters. All tools require a `ToolContext` containing `{ env: Env, userId: string }`.

**Available Tools:**

- `get_current_user` - Fetch authenticated user profile from D1
- `search_employee_handbook` - Query policies using Workers AI
- `get_pto_balance` - Retrieve PTO balance from D1
- `check_blackout_periods` - Validate dates against company calendar
- `get_pto_history` - Fetch past PTO requests
- `calculate_business_days` - Calculate working days between dates
- `validate_pto_policy` - Check auto-approval eligibility
- `submit_pto_request` - Create PTO request in D1
- `process_receipt_image` - Process and extract data from receipt images via Workers AI
- `get_receipt_data` - Retrieve previously processed receipt data from D1
- `show_expense_dialog` - Trigger the expense submission UI dialog in the frontend
- `get_expense_history` - Fetch past expense reimbursement requests
- `validate_expense_policy` - Check expense reimbursement eligibility against policy
- `submit_expense_request` - Create expense reimbursement request in D1
- `log_audit_event` - Write compliance audit entries to D1

**4. Frontend (`src/app.tsx` and `src/client.tsx`)**

- React-based chat UI with Tailwind CSS
- Uses `useAgentChat` from `agents/ai-react` for AI chat and `useAgent` from `agents/react` for the WebSocket connection
- Components follow shadcn/ui patterns
- Theme switching (light/dark mode) managed via `useState` and localStorage
- Authentication state managed by `AuthProvider`

**5. Authentication System**

- Password-based auth with PBKDF2 hashing
- HTTP-only secure cookies for session tokens
- Middleware validates sessions on protected routes
- Demo users seeded via migration `migrations/0001_create_auth_tables.sql`

### Data Flow

1. User sends message via React UI
2. WebSocket connection to Chat Durable Object
3. Chat DO extracts userId from storage, calls `runReActAgent()`
4. ReAct agent uses Workers AI to process message and decide tool calls
5. Tools query D1, Workers AI, or perform calculations
6. Agent synthesizes response and streams back to UI

### Key Architectural Decisions

**ReAct Framework:**
The agent follows a strict tool-calling sequence for PTO requests (see `src/prompts.ts`):

1. `get_current_user()` - ALWAYS first to get employee_id
2. `get_pto_balance()` - Check available days
3. Parse dates from natural language
4. `calculate_business_days()` - Compute request duration
5. `validate_pto_policy()` - Check eligibility and auto-approval rules
6. `submit_pto_request()` - Persist to database

**Policy Enforcement:**

- Company policies defined in `docs/handbook/employee_handbook.md`
- Policies retrieved via Workers AI (no vector search currently - uses direct LLM query)
- Auto-approval limits and blackout periods enforced server-side
- Manager escalation for requests exceeding auto-approval thresholds

**State Management:**

- Chat sessions stored in Durable Object SQLite (via `agents` SDK)
- User/session data in D1 database
- No client-side state persistence (session cookies only)

## Database Schema

Key D1 tables (see `migrations/`):

- `users` - Employee profiles (username, role, employee_level, manager_id, etc.)
- `sessions` - Authentication sessions
- `pto_requests` - PTO request records with approval workflow
- `pto_balances` - Employee PTO accrual and usage tracking
- `company_calendar` - Holidays and blackout periods
- `expense_requests` - Expense reimbursement workflow
- `receipt_uploads` - Uploaded receipt images and extracted data
- `audit_log` - Action tracking for compliance

## Important Configuration

**Wrangler Configuration (`wrangler.jsonc`):**

- Main entry: `src/server.ts`
- Bindings: AI (Workers AI), VECTORIZE (not actively used), APP_DB (D1), Chat (Durable Object)
- Static assets served from `public/` directory
- Durable Object migration: `new_sqlite_classes: ["Chat"]` enables Agent state persistence

**Environment Variables:**

- No `.dev.vars` committed (see `.dev.vars.example`)
- Session secrets and API keys managed via Wrangler secrets in production

## Common Patterns

### Adding a New Tool

1. Define in `src/tools.ts`:

```typescript
const my_tool: Tool = {
  name: "my_tool",
  description: "What it does",
  parameters: { type: "object", properties: {...}, required: [...] },
  execute: async (params, context) => { /* implementation */ }
};
// Add to tools export
export const tools = { ..., my_tool };
```

2. Update system prompt in `src/prompts.ts` to describe when/how to use the tool

### Database Migrations

Create numbered migration files in `migrations/` directory:

- Format: `XXXX_description.sql` (e.g., `0009_add_column.sql`)
- Use `IF NOT EXISTS` for idempotent migrations
- Avoid explicit transactions (Cloudflare D1 handles this)
- Run via `npm run d1:apply` or deploy script

### Testing with Demo Users

Three demo users available (password: `Password123!`):

- `ramya_manager` - Senior manager in People Ops
- `ramya_senior` - Senior engineer reporting to ramya_manager
- `ramya_junior` - Junior engineer reporting to ramya_manager

Login via `POST /api/auth/login` with username/password.

## Known Limitations

- Vector search (VECTORIZE binding) configured but not actively used - handbook search uses direct LLM queries
- Conversation history limited to 4 messages (2 turns) to manage context window
- No real-time manager notifications (planned for future iterations)
- Employee handbook is imported as raw markdown, not chunked/embedded

## Additional Notes

- The application is built on the `agents-starter` template from Cloudflare
- Uses Workers AI for all LLM inference (no external API calls)
- Frontend uses Vite for development and bundling
- All dates stored in ISO 8601 format (YYYY-MM-DD)
- Business day calculations exclude weekends and company holidays
