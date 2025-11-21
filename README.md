# 🤖 ApprovalFlow AI
## Your company's Instant HR -  Get your PTOs approved & expenses reimbursed in seconds 🚀 all in natural language

Built using Cloudflare's Agent platform, powered by [`agents`](https://www.npmjs.com/package/agents).

## Features

- 💬 Interactive chat interface with AI
- 🛠️ Built-in tool system with human-in-the-loop interactions.
- 🌓 Dark/Light theme support
- ⚡️ Real-time streaming responses
- 🔄 State management and chat history
# ApprovalFlow AI

A Cloudflare Agents-based demo that showcases a ReAct-style AI assistant for employee workflows (PTO requests, expense reimbursements, receipt OCR, and handbook search). The project is built as a small, production-minded example using Cloudflare Workers, Workers AI, D1 (relational DB), Vectorize, and the Agents SDK.

This README is intentionally concise and focused for hiring reviewers:
- Recruiters: quick summary of goal and highlights
- Engineers: architecture, bindings, run/deploy steps, where core logic lives
- Hiring managers: what the candidate implemented and how to evaluate it

Project highlights
- ReAct agent loop implemented in `src/react-agent.ts` using Workers AI and a pattern-based tool call protocol.
- Tool registry in `src/tools.ts` implements domain primitives (get_current_user, get_pto_balance, validate_pto_policy, submit_pto_request, validate_expense_policy, submit_expense_request, show_expense_dialog, receipt OCR helpers, handbook search, audit logging).
- Agent runtime using Cloudflare Agents (`src/server.ts`) for streaming chat and tool-part updates to the frontend.
- Frontend chat UI using `agents/react` hooks in `src/app.tsx` with interactive tool cards and an expense submission dialog.
- Handbook ingestion + embeddings using `src/ingest_handbook.ts` and Vectorize (optional RAG workflows).

Quick repo map (important files)
- `src/react-agent.ts` — ReAct loop, tool-call parsing, streaming tool updates.
- `src/tools.ts` — Tool implementations and DB interactions (D1). Core business logic lives here.
- `src/prompts.ts` — System prompt that instructs the model how to call tools and required workflows.
- `src/server.ts` — Agent routing, authentication middleware, receipt upload + OCR pipeline.
- `src/app.tsx` — Frontend chat UI that renders streaming tool parts and opens the expense dialog.
- `docs/` — design and implementation notes (read these to understand assumptions).

What to look for when reviewing
- Correct and secure tool usage: tools must not leak internal operations to users; check `src/prompts.ts` rules.
- Data flow: authenticated session -> agent Durable storage -> tool calls (D1) -> final user response.
- Error handling and auditing: `log_audit_event` records actions; heavy LLM failures are surfaced conservatively.
- Separation of responsibilities: agent orchestrates reasoning, tools perform side effects and DB access.

Required Cloudflare bindings (configure in `wrangler.jsonc`)
- `AI`: Workers AI gateway binding (used for LLM calls and vision/OCR)
- `APP_DB`: D1 database binding (users, sessions, pto_balances, expense_requests, receipt_uploads, audit_log, company_calendar)
- `VECTORIZE`: Vectorize index binding (optional — used by `ingestHandbook`)
- Agents bindings/migrations: ensure migrations include the Agent class for Durable state if using Agents runtime

Quick local development
1. Install dependencies

```bash
npm install
```

2. Start local dev (workers + remote AI gateway recommended)

```bash
# Run worker in dev mode (use --remote if you rely on remote AI gateway bindings)
npx wrangler dev --local
```

Notes:
- Configure `wrangler.jsonc` with the `ai`, `d1`, and `vectorize` bindings used in this repo. The frontend checks `/check-ai-provider` and will show a banner if `env.AI` is not present.
- For true end-to-end testing, attach an AI Gateway (Workers AI) or configure external LLM keys and update code to use them.

Deployment
- Use Wrangler to publish: `npx wrangler deploy` (ensure account, bindings, and migrations are configured).
- Run the D1 migrations in `scripts/d1/apply_migrations.sh` to create tables used by the tools.

Evaluating the assignment (for hiring)
- Functionality: the agent should correctly call tools in the order described by `src/prompts.ts` (e.g., PTO flows must call get_current_user, get_pto_balance, calculate_business_days, validate_pto_policy, submit_pto_request).
- Reproducibility: the repo should include `PROMPTS.md` (AI prompts used) and clear run instructions. The Cloudflare assignment requires the repo name to be prefixed with `cf_ai_` and to include `PROMPTS.md`.
- Security & correctness: session handling, authorization checks on receipts and expense data, and audit logging.
- UX: frontend opens expense dialog when `show_expense_dialog` is returned as a tool output; tool parts stream in live.

Short checklist for a reviewer
- Are the required bindings present and documented in `wrangler.jsonc`?
- Can you run the app locally with `wrangler dev` and a configured AI provider?
- Does `src/prompts.ts` clearly outline the expected tool calling format and rules?
- Do tools in `src/tools.ts` perform authorization checks and audit logging?

Next recommended repository additions (low-effort, high-value)
- `PROMPTS.md` — include the exact system prompts and example tool-call outputs used during model interactions.
- `DEPLOY.md` — concrete wrangler + migration steps for fast evaluation by a recruiter or hiring manager.
- Integration tests for PTO and Expense flows (exercise `validate_*` and `submit_*` tools).

Contact / Maintainers
- See `package.json` and `docs/` for author and implementation notes.

License
- See `LICENSE` at repository root.

----
If you want, I can now:
- Add `PROMPTS.md` with the system prompt and examples (recommended for the Cloudflare assignment), or
- Create `DEPLOY.md` with exact `wrangler` and D1 migration commands to make this repo reviewer-ready.
Choose one and I will implement it next.
// Example of a tool that requires confirmation
