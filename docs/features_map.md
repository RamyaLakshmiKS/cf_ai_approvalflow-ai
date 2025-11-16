### User Personas

Let us start by defining key personas based on the scoped product (ApprovalFlow AI for PTO requests, expense reimbursements, and access grants). These are derived from the described users: 2-3 kinds of workers (interpreting as Junior Employee and Senior Employee for differentiation in permissions, e.g., seniors may have higher auto-approval thresholds) and a Manager. All interact via a secure login system backed by an in-memory SQL DB for credentials and permissions.

1. **Junior Employee**: Entry-level worker with basic permissions. Requests often require escalation due to lower thresholds (e.g., limited PTO days or expense limits).
2. **Senior Employee**: Experienced worker with elevated permissions. More requests can be auto-approved (e.g., higher expense limits or self-approval for certain access).
3. **Manager**: Supervisory role with approval authority. Can review, approve, or deny escalated requests from employees.

Additional assumptions (based on best practices):

- All users authenticate via login (username/password or similar, stored in SQL DB).
- Policies (e.g., PTO accrual, expense per diems, access roles) are queried from Cloudflare Vector DB (employee handbook).
- System is realtime, with chat/voice input via Cloudflare Pages/Realtime, stateful coordination via Durable Objects/Workflows, and LLM analysis for natural language processing.
- Escalations notify managers via chat/email (modular extension).
- Audit trails persist for all actions.

### User Stories

User stories are written in the standard format: "As a [persona], I want [feature] so that [benefit]." I've grouped them by use case (PTO, Expenses, Access) and cross-cutting features (e.g., authentication, escalation). Prioritized by MVP scope: core automation, escalation, and manager review.

#### Cross-Cutting Stories (Authentication & System Basics)

1. As a Junior/Senior Employee or Manager, I want to log in securely using my credentials so that I can access the system with appropriate permissions.
2. As any user, I want my permissions (e.g., approval thresholds) pulled from the SQL DB upon login so that the AI applies the correct rules based on my role.
3. As any user, I want to submit requests via natural language chat or voice input so that interactions feel intuitive and efficient.
4. As any user, I want realtime status updates on my requests so that I can track progress without refreshing.
5. As any user, I want an audit trail of my requests viewable in the system so that I can reference history for compliance or disputes.
6. As a Manager, I want notifications (e.g., chat/email) for escalated requests so that I can respond promptly.

#### PTO Requests Stories

7. As a Junior Employee, I want to submit a PTO request (e.g., "Request 3 days off starting Monday") so that the AI parses dates, checks my accrual balance and policy in Vector DB, and auto-approves if under my threshold or escalates to Manager.
8. As a Senior Employee, I want to submit a PTO request so that the AI auto-approves higher amounts (e.g., up to 10 days) based on my permissions, reducing escalation needs.
9. As a Manager, I want to view escalated PTO requests with details (e.g., employee info, policy validation) so that I can approve or deny with a reason.
10. As any Employee, I want the AI to validate against company calendar (e.g., no blackouts) from Vector DB so that invalid requests are flagged early.

#### Expense Reimbursements Stories

11. As a Junior Employee, I want to submit an expense request (e.g., "Reimburse $100 for travel") with optional receipt upload so that the AI extracts details, validates against per diem policy in Vector DB, and auto-approves small amounts or escalates.
12. As a Senior Employee, I want to submit an expense request so that the AI auto-approves up to higher limits (e.g., $500) based on my role.
13. As a Manager, I want to review escalated expense requests with parsed metadata (e.g., amount, category, receipt) so that I can approve or deny securely.
14. As any Employee, I want the AI to flag policy violations (e.g., over budget) from Vector DB so that I can revise before submission.

#### Access Grants Stories

15. As a Junior Employee, I want to request access (e.g., "Grant me read access to shared drive") so that the AI verifies my identity/role from SQL DB, checks role-based policies in Vector DB, and auto-approves basic access or escalates.
16. As a Senior Employee, I want to request access so that the AI auto-grants elevated permissions (e.g., admin-level) if policy-compliant, without always escalating.
17. As a Manager, I want to approve/deny escalated access requests with risk analysis (e.g., LLM-flagged sensitivities) so that security is maintained.
18. As any Employee, I want realtime confirmation of access changes so that I can proceed with work immediately if approved.

#### Advanced/Edge Case Stories (Post-MVP)

19. As any user, I want the system to handle multi-request sessions (e.g., PTO + expense in one chat) so that workflows are efficient.
20. As a Manager, I want bulk approval/denial for multiple escalated requests so that high-volume scenarios are manageable.
21. As an admin (future persona), I want to update Vector DB policies or SQL DB permissions so that the system evolves with company changes.

### User Journeys

User journeys map end-to-end flows, including happy paths and alternatives (e.g., escalation). I've used numbered steps with decision points. Each journey assumes login as a prerequisite.

#### Journey 1: PTO Request (Employee Perspective)

1. Employee logs in; system authenticates via SQL DB and loads permissions.
2. Employee submits request via chat/voice (e.g., "5 days PTO next week").
3. AI (via LLM) parses input: extracts dates, category.
4. AI queries Vector DB for policy (e.g., accrual balance, calendar conflicts).
5. Decision: If within employee's threshold (e.g., Junior <3 days), auto-approve → Send realtime confirmation + update audit trail.
   - Alternative: If over threshold or violation → Escalate to Manager with details → Notify Manager.
6. Employee receives status update (e.g., "Approved" or "Pending Manager Review").
7. If escalated, Manager logs in, views request, approves/denies → Employee notified realtime.

#### Journey 2: Expense Reimbursement (Employee Perspective)

1. Employee logs in; permissions loaded from SQL DB.
2. Employee submits request (e.g., "Reimburse $150 dinner" + optional image upload).
3. AI parses: extracts amount, category, receipt details via LLM.
4. AI checks Vector DB policy (e.g., per diem limits, budget).
5. Decision: If under role threshold (e.g., Senior <$300), auto-approve → Confirm + log audit.
   - Alternative: If over or flagged (e.g., no receipt) → Escalate → Notify Manager.
6. Employee gets realtime update.
7. If escalated, Manager reviews (with metadata), approves/denies → System processes (e.g., mock reimbursement) + notifies Employee.

#### Journey 3: Access Grant (Employee Perspective)

1. Employee logs in; role/permissions from SQL DB.
2. Employee requests access (e.g., "Admin access to DB").
3. AI parses: identifies resource, level.
4. AI verifies against Vector DB policies (e.g., role-based access control) and SQL DB identity.
5. Decision: If basic and policy-compliant (e.g., Junior read-only), auto-grant → Confirm + apply access (e.g., via integration).
   - Alternative: If elevated or risky → Escalate with LLM risk analysis → Notify Manager.
6. Employee receives status (e.g., "Granted" or "Pending").
7. If escalated, Manager logs in, reviews details/risks, approves/denies → Access updated + notified.

#### Journey 4: Manager Review (Manager Perspective)

1. Manager logs in; elevated permissions loaded.
2. System displays dashboard of pending escalations (from any use case).
3. Manager selects request → Views details (e.g., employee info, policy check results, audit history).
4. Manager approves/denies with optional reason → System updates state, notifies Employee, logs audit.
5. Realtime sync: Employee sees resolution.

### Prioritization & Recommendations

- **MVP Backlog**: Focus on core stories 1-18. Implement authentication first, then one use case (e.g., PTO) end-to-end, iterate on others.
- **Metrics for Success**: Approval time reduction (e.g., 80% auto-approved), escalation rate (<20%), user satisfaction (NPS >8).
- **Risks**: Data security (encrypt SQL DB), policy accuracy (regular Vector DB updates), edge cases (e.g., concurrent requests).
- **Next Steps**: Wireframe UI (chat/dashboard), define API schemas for DB integrations, prototype with sample data.
