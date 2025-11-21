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

### Architecture Deep Dive
See [CLAUDE.md](CLAUDE.md) for complete implementation details, agent design patterns, and tool-calling strategies.

