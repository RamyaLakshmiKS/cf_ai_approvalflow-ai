# AI Coding Agents in Development

This document explains how AI coding agents (Claude, GitHub Copilot) were used to develop ApprovalFlow AI, as required by the Cloudflare internship assignment.

## Development Workflow

The development process followed a **structured, AI-assisted approach** with clear human oversight at each stage:

### Phase 1: Product Planning with AI (Project Manager Role)

**Goal**: Define user personas, stories, and journeys before writing any code.

**Process**: I conducted an iterative planning session with Claude, acting as a product manager to scope out the application features. This resulted in:

📋 **[Features Map](docs/features/features_map.md)** - Comprehensive planning document containing:
- User personas (Junior Employee, Senior Employee, Manager)
- User stories for PTO requests, expense reimbursements, and access grants
- End-to-end user journeys with decision points
- Mermaid diagrams showing approval flows

**Human Decisions**:
- Chose to focus on PTO and expenses (not access grants) for MVP
- Defined auto-approval thresholds: 3 days (junior), 10 days (senior), $100 (junior), $500 (senior)
- Decided on escalation workflow (manager review for requests exceeding thresholds)

**AI Contribution**:
- Structured the user stories in standard format ("As a [persona], I want [feature] so that [benefit]")
- Generated flow diagrams
- Identified edge cases and post-MVP features

---

### Phase 2: Feature-by-Feature Implementation Planning

After defining the product scope, I worked with AI to create detailed implementation plans for each major feature in order:

#### 2.1 Authentication System

📋 **[Auth MVP Plan](docs/features/implementation_plans/auth_mvp_plan.md)**

**Human Prompt**: "Create a detailed implementation plan for password-based authentication with session management using D1 and Durable Objects."

**AI Output**: Step-by-step plan including:
- Database schema (users, sessions tables)
- PBKDF2 password hashing approach
- Session cookie management with HTTP-only flags
- Middleware for session validation

**My Review**: Suggested multiple changes, altered plans, made edits, then prompted GitHub Copilot to implement it following the plan.

#### 2.2 PTO Request Feature

📋 **[PTO Request Plan](docs/features/implementation_plans/pto_request_plan.md)**

**My Prompt**: "Design the PTO request workflow with tools for balance checking, business day calculation, blackout period validation, and auto-approval logic."

**AI Output**: Complete tool architecture with:
- 7 tools required: `get_current_user`, `get_pto_balance`, `calculate_business_days`, `check_blackout_periods`, `validate_pto_policy`, `submit_pto_request`, `log_audit_event`
- Database tables: `pto_requests`, `pto_balances`, `company_calendar`, `audit_log`
- Tool execution sequence and decision logic

**My Review**: Replanned, suggested edit, reviewed AI code, made changes manually when necessary. Tested the feature, addressed bugs and made sure it was completed.

#### 2.3 Expense Reimbursement Feature

📋 **[Expense Reimbursement Plan](docs/features/implementation_plans/EXPENSE_REIMBURSEMENT_IMPLEMENTATION_PLAN.md)**

**My Prompt**: "Design expense reimbursement with receipt OCR using Workers AI Vision, policy validation, and auto-approval workflow."

**AI Output**: Comprehensive implementation plan including:
- Receipt upload and base64 storage in D1
- OCR extraction with LLaVA model and JSON parsing
- Expense validation tools checking daily limits, receipt requirements, non-reimbursable items
- UI dialog integration

**My Review**: Reviewed the plan, suggested changes, review AI's code and made edits etc:-. Tested the feature, addressed bugs and made sure it was completed

#### 2.4 Agentic Framework

📋 **[Agentic Implementation Plan](docs/features/implementation_plans/AGENTIC_IMPLEMENTATION_PLAN.md)**

**My Prompt**: "Design a ReAct agent framework that can reason about user requests and call tools iteratively to fulfill PTO and expense workflows. Here's a [insert links] bunch of links about ReAct agentic flow from huggingface. Make your plan according after understanding from your web resarch."

**AI Output**: Detailed architecture for:
- ReAct loop with up to 15 iterations
- Custom tool-calling format (`TOOL_CALL: tool_name` / `PARAMETERS: {...}`)
- Streaming tool updates to UI
- System prompts and behavior rules

**My Decision**: After AI suggested multiple approaches, I chose the manual tool-calling pattern over AI SDK's native tools because Workers AI models had poor function-calling reliability with standard schemas.

---

### Phase 3: Implementation with GitHub Copilot

**Process**: With detailed plans in hand, I used **GitHub Copilot** (smaller LLM model) to write code following the specifications.

**Example Interaction**:

```
Human: "Implement the get_pto_balance tool according to the PTO request plan.
Query D1 for current_balance, total_accrued, total_used, rollover_from_previous_year
from pto_balances table."

GitHub Copilot: [Generated code for src/tools.ts]

const get_pto_balance: Tool = {
  name: "get_pto_balance",
  description: "Retrieves the employee's current PTO balance...",
  parameters: { ... },
  execute: async (params, context) => {
    const userId = params.employee_id || context.userId;
    const ptoBalance = await context.env.APP_DB.prepare(
      "SELECT current_balance, total_accrued, total_used, rollover_from_previous_year
       FROM pto_balances WHERE employee_id = ?"
    ).bind(userId).first();
    ...
  }
};
```

**Human Role**:
- Reviewed all AI-generated code for correctness
- Tested each tool individually
- Fixed bugs and edge cases (e.g., UUID truncation in expense submission)
- Refactored for consistency and maintainability

---

## Key AI Contributions

### 1. Architecture Design
AI helped design the multi-model approach:
- Llama 3.3 70B for main agent (chat + tool calling)
- Llama 3.1 8B for handbook search (faster, cheaper for Q&A)
- LLaVA 1.5 7B for receipt OCR (vision model)

### 2. Prompt Engineering
AI assisted in crafting system prompts that prevent hallucinations:
- "CRITICAL: NEVER pass employee_id parameter" (prevents cross-user data leaks)
- "When you need to call a tool, respond with ONLY the tool call - NO other text"
- Date injection for relative date calculations

### 3. Error Handling Patterns
AI suggested auto-correction for common LLM JSON errors:
```typescript
// Fix missing values after colons (e.g., "amount":, -> "amount": null,)
paramsStr = paramsStr.replace(/:\s*,/g, ": null,");
```

### 4. Code Structure
AI organized the codebase into clean separation of concerns:
- `src/server.ts` - Routing and authentication
- `src/react-agent.ts` - ReAct loop logic
- `src/tools.ts` - Tool implementations
- `src/prompts.ts` - System prompts
- `src/app.tsx` - Frontend React components

### 5. Documentation
AI helped write:
- Architecture diagrams (Mermaid syntax)
- Test scenarios
- This PROMPTS.md file

---

## Human Oversight & Critical Decisions

While AI accelerated development, all major decisions were human-driven:

### Model Selection
**Process**: I prompted AI to test multiple Workers AI models for function-calling reliability.

**Result**: Tested 10+ models, documented in `FUNCTION-CALLING-TEST-RESULTS.md`. Only Llama 3.3 70B achieved 100% success rate.

**Human Decision**: Chose Llama 3.3 70B despite slower speed (~1.5s penalty) because reliability was critical.

### Security Implementation
**AI Suggestion**: Basic session tokens.

**Human Enhancement**:
- Added PBKDF2 password hashing with 100,000 iterations
- Implemented HTTP-only secure cookies
- Added session expiry validation
- Logged invalid login attempts without exposing sensitive data

### Policy Enforcement Approach
**AI Suggestion**: Vector embeddings with Vectorize.

**Human Decision**: Used simpler approach for MVP—pass full handbook to LLM in context (5KB fits easily). Vectorize is planned for future scale.

### Database Schema
**AI Draft**: Suggested tables and columns.

**Human Refinement**:
- Added audit logging for compliance
- Included manager escalation workflow
- Designed for future extensions (employee levels, departments)

---

## Development Metrics

**Time Saved with AI**: ~60-70% reduction in boilerplate code writing

**Lines of Code Generated by AI**: ~4,000 lines (estimated)

**Lines of Code Written by Human**: ~2,000 lines (refactoring, bug fixes, tests)

**AI-Assisted Planning Sessions**: 4 major planning documents

**Iterations Required**:
- Planning phase: 10-15 iterations per feature
- Implementation: 5-10 iterations per tool
- Debugging: 20+ iterations for edge cases

---

## Lessons Learned

### 1. Plan First, Code Second
Having detailed implementation plans from AI made coding with Copilot much faster and more accurate. Without the plan, Copilot would generate generic code that didn't align with the architecture.

### 2. Validate AI Suggestions
AI suggested using Workers AI's native tool schema, but testing revealed poor reliability. Always validate AI architectural recommendations with experiments.

### 3. Iterative Refinement
The best results came from iterative prompting:
- Draft 1: "Create a PTO tool"
- Draft 2: "Add balance checking and business day calculation"
- Draft 3: "Include blackout period validation from company calendar"
- Final: Integrated, tested, working implementation

### 4. Human Debugging is Essential
AI couldn't debug complex issues like:
- UUID truncation (LLM copying only 32 chars instead of 36)
- WebSocket streaming state management
- Race conditions in tool execution

### 5. Documentation Multiplier Effect
Using AI to write documentation freed up time for architectural thinking and testing, resulting in better overall code quality.

---

## Tools Used

| Tool | Purpose | Usage |
|------|---------|-------|
| **Claude (Sonnet)** | Planning, architecture design, documentation | Heavy |
| **GitHub Copilot** | Code implementation following plans | Heavy |
| **Cursor AI** | In-editor code suggestions and refactoring | Medium |
| **Wrangler AI** | Testing Workers AI models for function calling | Light |

---

## Conclusion

AI coding agents didn't replace the developer—they **amplified productivity** by:
- Handling repetitive tasks (boilerplate code, documentation)
- Suggesting architectural patterns and best practices
- Accelerating the plan-to-implementation cycle

The key to success was treating AI as a **collaborative tool** with clear human oversight, not a replacement for engineering judgment.

All critical decisions (model selection, security design, business logic) were made by analyzing AI suggestions against project requirements and validating through testing.

This approach aligns with Cloudflare's philosophy: use AI to build better products faster, but maintain rigorous standards for production code.
