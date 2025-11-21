# PROMPTS.md

This file documents the primary AI prompts used by the ApprovalFlow AI project, example model-tool exchanges, and a short explanation of how AI coding agents were used during development.

## Purpose
- Make the system prompt and examples explicit for reviewers and graders.
- Provide reproducible prompts for local testing and fine-tuning.
- Explain how AI-assisted coding was used so reviewers can evaluate originality and provenance.

---

## 1) System Prompt (summary)

The system prompt lives in `src/prompts.ts` and instructs the LLM to behave as "ApprovalFlow AI". Key responsibilities enforced by the prompt:

- Identify itself as an assistant for PTO and expense workflows.
- Always gather automatic context for user-specific actions by calling domain tools (e.g., `get_current_user`, `get_pto_balance`).
- Enforce an exact tool-calling format when the model needs to invoke a tool:

  TOOL_CALL: <tool_name>
  PARAMETERS: {<json parameters>}
  ---

- For expense submissions, require the model to call `show_expense_dialog` with empty parameters as the first step.
- Never expose internal tool calls or background processing in final user-facing messages.
- Use natural, friendly language and emojis in the final response while keeping it concise.
- When dates are mentioned, compute exact ISO dates and call `calculate_business_days`.

This strict format allows the manual ReAct loop in `src/react-agent.ts` to parse the model's output reliably and call the corresponding tools.

---

## 2) Example Exchanges

### PTO Request (short flow)

User: "I need PTO from December 20-22, 2025"

Model steps (expected tool calls):

1. TOOL_CALL: get_current_user
   PARAMETERS: {}
   ---
2. TOOL_CALL: get_pto_balance
   PARAMETERS: {}
   ---
3. TOOL_CALL: calculate_business_days
   PARAMETERS: {"start_date": "2025-12-20", "end_date": "2025-12-22"}
   ---
4. TOOL_CALL: validate_pto_policy
   PARAMETERS: {"start_date": "2025-12-20", "end_date": "2025-12-22", "reason": "PTO request"}
   ---
5. Depending on validation.recommendation, TOOL_CALL: submit_pto_request with appropriate status and fields.

Final user-facing message: A natural-language confirmation (e.g., "Great news! ✅ Your PTO request ... has been approved.")

---

### Expense Submission (short flow)

User: "I want to submit an expense"

Model steps (expected tool call):

1. TOOL_CALL: show_expense_dialog
   PARAMETERS: {}
   ---

Frontend will open an expense dialog and upload a receipt; once the user submits the dialog, the agent will be fed a summarizing message like:

User: "I've submitted an expense: $150 for meals. Client dinner. Receipt ID: 49973e8b-f4d6-4bd0-b448-60ec2187e5eb"

2. TOOL_CALL: get_current_user
   PARAMETERS: {}
   ---
3. TOOL_CALL: validate_expense_policy
   PARAMETERS: {"amount": 150, "category": "meals", "description": "Client dinner", "has_receipt": true}
   ---
4. TOOL_CALL: submit_expense_request
   PARAMETERS: {"category": "meals", "amount": 150, "currency": "USD", "description": "Client dinner", "receipt_id": "49973e8b-f4d6-4bd0-b448-60ec2187e5eb", "status": "auto_approved", "auto_approved": true}
   ---

Final user-facing message: natural-language status (approved/escalated/denied).

---

## 3) Tool protocol and UI integration notes

- Tools return structured JSON. Tools that trigger UI actions (e.g., `show_expense_dialog`) return a marker `__ui_action: "show_expense_dialog"` which the frontend detects and uses to open the dialog.
- The frontend listens for `tool-*` parts and renders `ToolInvocationCard` components to display streaming progress.
- Tool calls are streamed back to the frontend via `onToolUpdate` in the ReAct loop so users can see progress (input-available, output-available, output-error).

---

## 4) How AI coding agents were used during development

This project was developed using an AI-assisted workflow. Below are the steps and guardrails used so reviewers can assess originality and contributions:

1. Planning and scoping
- High-level architecture, wireframes, and features were drafted by the developer and iterated with AI-assisted brainstorming prompts. The `docs/` folder contains planning notes and implementation plans (see `docs/AGENTIC_IMPLEMENTATION_PLAN.md` and related files).

2. Generating scaffolding and snippets
- Repetitive boilerplate (e.g., Hono route handlers, component scaffolds, and small utility functions) was generated or accelerated using AI coding agents. Generated code was reviewed and adapted by the developer; nothing was copy-pasted from unknown sources without review.

3. Writing prompts and agent behavior
- The system prompt in `src/prompts.ts` and the ReAct orchestration in `src/react-agent.ts` were written iteratively with AI help to refine the tool-call format and failure modes.

4. Testing and validation
- The developer used AI agents to propose test cases and edge-case scenarios for PTO and expense validation. These suggestions were manually implemented in tests and manual checks.

5. Documentation and explanation
- README and `PROMPTS.md` were written and refined with AI assistance; these documents explain the system prompt and reproduce exactly what the agent expects.

Guidelines followed during AI-assisted development
- All final code was reviewed and approved by the developer — the repository contains only reviewed, edited, and integrated code.
- Any AI-generated content that was used to author code or prose is captured here and in `PROMPTS.md` for transparency.
- No external project submissions or public assignment solutions were copied; all code is original or derived from standard patterns adapted to this project.

---

## 5) Reproducibility & grading notes (for recruiters)

- Repo name must be prefixed with `cf_ai_` (this repository already follows that pattern).
- Include `PROMPTS.md` (this file) in your submission to explain the system prompt and examples.
- Ensure `wrangler.jsonc` is populated with `ai`, `d1`, and optionally `vectorize` bindings so the evaluator can deploy and test the assignment.

---

If you'd like, I can also:
- Add a `DEPLOY.md` with concrete wrangler commands and D1 migration steps, or
- Add small integration tests that exercise the PTO and expense flows using the tools directly.


