# Implementation Plan: Manager Approval Flow & Request Escalation

**Version:** 1.0  
**Date:** February 2026  
**Status:** Planning  
**Owner:** Engineering Team

---

## Executive Summary

This plan implements a **manager approval workflow** and **request escalation** capability for the ApprovalFlow AI system. The system will enable:

1. **Managers** to view, approve, and deny pending requests from direct reports
2. **Employees** to escalate requests that violate policies (blackout periods, quota overages)
3. **Real-time chatbot notifications** when managers take action on requests
4. **Audit trail** for all approval/denial decisions with reasoning

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [Scope & Out of Scope](#scope--out-of-scope)
3. [Architecture & Design](#architecture--design)
4. [Database Schema Changes](#database-schema-changes)
5. [Backend Implementation](#backend-implementation)
6. [Frontend Implementation](#frontend-implementation)
7. [AI Agent Logic](#ai-agent-logic)
8. [Implementation Sequence](#implementation-sequence)
9. [Testing Strategy](#testing-strategy)
10. [Success Criteria](#success-criteria)

---

## Feature Overview

### Manager Requirements

**As a manager:**

- Log in with credentials
- See a dashboard with:
  - ✅ List of pending PTO requests from direct reports
  - ✅ List of pending expense requests from direct reports
  - ✅ Request details (dates, amount, reason, escalation info)
- Approve or deny requests with optional reasoning
- View historical approval/denial decisions
- Receive counts of pending approvals

**Request Approval Flow:**

```
Employee Request (PTO/Expense)
  ↓
AI Agent Evaluates (Checks Policy)
  ↓
┌─────────────────────────────────┐
│ Decision Branch                 │
└─────────────────────────────────┘
  ├→ AUTO-APPROVE (Within limits)
  │   → Status: "approved" (final)
  │   → Employee sees approval in chat
  │
  ├→ AUTO-DENY (Policy violation)
  │   → Status: "denied" (final)
  │   → Denial reason recorded
  │   → Employee sees denial in chat
  │
  └→ ESCALATE (Exceeds limits but valid)
      → Status: "pending_approval"
      → Manager ID assigned
      → Manager sees in pending queue
      → Manager approves/denies
      → Employee notified in chat
```

### Employee Requirements

**As an employee:**

- Submit PTO/expense requests via chatbot
- Request escalation when hitting policy limits:
  - Taking PTO during blackout periods
  - Requesting PTO beyond available quota
  - Requesting high-value expense reimbursements
- Ask chatbot to check status of pending requests
- Receive real-time notifications in chat when manager approves/denies
- See denial reasons if request is denied

**Request Status Flow:**

```
Employee Query: "What's the status of my PTO request from last week?"
  ↓
Agent fetches request history from database
  ↓
Agent checks status and responds:
  • "Pending manager approval since Feb 10"
  • "Approved on Feb 11 by Manager"
  • "Denied on Feb 11 - Reason: Within blackout period (company closure)"
  • "Auto-approved on Feb 10"
```

---

## Scope & Out of Scope

### In Scope ✅

- Manager approval dashboard
- Approve/deny endpoints with reasoning
- Database schema for escalation tracking
- AI agent tools for checking request status
- Real-time notification integration in chat
- Escalation logic for policy violations
- Audit logging of all approval decisions
- Support for both PTO and Expense requests

### Out of Scope ❌

- Email notifications (real-time chat notifications only)
- Multi-level approval chains (single manager per employee)
- Delegation of approval authority
- Custom approval workflows per department
- Historical analytics/reporting dashboards
- Workflows SDK integration (use Durable Objects instead)

---

## Architecture & Design

### System Architecture Overview

```
┌─────────────────┐
│  React App      │
│  (Employee/     │
│   Manager)      │
└────────┬────────┘
         │ WS (useAgent)
         ↓
┌─────────────────────────────────────┐
│  Chat Durable Object                │
│  (src/server.ts - Chat Class)       │
│  • Message handling                 │
│  • Agent orchestration              │
│  • WebSocket management             │
└────────┬────────────────────────────┘
         │ HTTP
         ↓
┌─────────────────────────────────────┐
│  Hono Router (src/server.ts)        │
│  • /api/auth/*                      │
│  • /api/chat                        │
│  • /api/manager/requests            │
│  • /api/manager/decisions/:id       │
│  • /api/requests/status             │
└────────┬────────────────────────────┘
         │ SQL
         ↓
┌─────────────────────────────────────┐
│  D1 Database (SQLite)               │
│  • users, sessions                  │
│  • pto_requests                     │
│  • expense_requests                 │
│  • audit_log (new)                  │
└─────────────────────────────────────┘
```

### Manager Dashboard Architecture

**New Components:**

- `ManagerDashboard.tsx` - Main layout with tabs
- `PendingApprovalsTab.tsx` - PTO/Expense pending list
- `ApprovalModalDialog.tsx` - Approve/deny form
- `DecisionHistoryTab.tsx` - Past decisions

**Data Flow:**

```
1. Manager visits dashboard
2. useEffect → GET /api/manager/requests
3. Display:
   - Pending PTO requests
   - Pending expense requests
   - Request preview cards
4. Manager clicks "Approve" or "Deny"
5. ApprovalModalDialog shows
6. Manager enters decision + reason
7. POST /api/manager/decisions/:id
8. Immediately refresh list
9. Behind the scenes: Agent notifies employee in chat
```

### Chat Notification Flow

**When Manager Approves/Denies:**

```
1. POST /api/manager/decisions/:id (manager action)
   ↓
2. Backend updates request status + creates audit log
   ↓
3. Backend publishes "decision" event to employee's chat DO
   ↓
4. Employee's Chat DO receives event via internal DO communication
   ↓
5. Chat DO sends message to employee's WebSocket client:
   "Manager approved your PTO request for Feb 17-20. 🎉"
   ↓
6. Employee sees real-time notification in chat
```

---

## Database Schema Changes

### 1. Update PTO Requests Table

**Add columns for escalation and approval tracking:**

```sql
-- migrations/0009_add_escalation_to_pto_requests.sql
ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
-- Tracks why request was escalated (e.g., "Requested during blackout period", "Exceeds available balance")

ALTER TABLE pto_requests ADD COLUMN IF NOT EXISTS approval_notes TEXT;
-- Manager's approval/denial reason
```

### 2. Update Expense Requests Table

**Add columns for manager decisions:**

```sql
-- migrations/0010_add_manager_decision_to_expenses.sql
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS approval_notes TEXT;
-- Manager's approval/denial reason

ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS denied_at INTEGER;
-- Timestamp when request was denied
```

### 3. Audit Log Integration

**Use existing audit_log table** (created in `0006_create_audit_log_table.sql`)

The existing `audit_log` table already supports all approval/denial tracking:

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'pto_request', 'expense_request', etc.
  entity_id TEXT NOT NULL, -- ID of the request
  action TEXT NOT NULL, -- 'created', 'approved', 'denied', 'escalated'
  actor_id TEXT, -- Manager/system performing action
  actor_type TEXT NOT NULL DEFAULT 'user', -- 'user', 'ai_agent', 'system'
  details TEXT, -- JSON with approval_notes, denial_reason, etc.
  created_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);
```

When a manager approves/denies, insert into audit_log with details JSON:
```json
{
  "approval_notes": "...",
  "previous_status": "pending_approval",
  "new_status": "approved"
}
```

### Schema Reference

**pto_requests:**
```
id, employee_id, manager_id, start_date, end_date, total_days, reason, status,
approval_type, denial_reason, ai_validation_notes, balance_before, balance_after,
escalation_reason (NEW), approval_notes (NEW),
created_at, updated_at, approved_at
```

**expense_requests:**
```
id, employee_id, manager_id, category, amount, currency, description, status,
ai_validation_status, auto_approved, escalation_reason,
employee_level, submission_method,
approval_notes (NEW), denied_at (NEW),
created_at, approved_at
```

**audit_log (existing, used for all tracking):**
```
id, entity_type, entity_id, action, actor_id, actor_type, details, created_at
```

---

## Backend Implementation

### 1. New HTTP Endpoints

#### A. Get Manager's Pending Approvals

```typescript
// GET /api/manager/requests
// Get all pending requests for the authenticated manager

Request:
  Headers: {Authorization: session}
  Query: {type?: 'pto' | 'expense' | 'all', limit?: 50, offset?: 0}

Response 200:
  {
    pto_pending: [
      {
        id, employee_id, employee_name, start_date, end_date, total_days,
        reason, created_at, escalation_reason
      },
      ...
    ],
    expense_pending: [
      {
        id, employee_id, employee_name, category, amount, currency, description,
        created_at, escalation_reason
      },
      ...
    ],
    counts: {pto_pending: 2, expense_pending: 1}
  }

Response 401: Unauthenticated
Response 403: Not a manager (user.role !== 'manager')
```

#### B. Approve/Deny Request

```typescript
// POST /api/manager/decisions/:id
// Approve or deny a pending request

Request:
  Headers: {Authorization: session}
  Body: {
    request_type: 'pto' | 'expense',
    decision: 'approved' | 'denied',
    reason?: string // Optional approval/denial reason
  }

Response 200:
  {
    success: true,
    request: {...},
    audit_log_id: "...",
    notification_sent_to_employee: true
  }

Response 400: Invalid request_type or decision
Response 401: Unauthenticated
Response 403: Manager not assigned to request
Response 404: Request not found
```

#### C. Get Request Status (for employee chat)

```typescript
// GET /api/requests/:id/status
// Employee queries status of their own request

Request:
  Headers: {Authorization: session}
  Params: {id: request_id}

Response 200:
  {
    id, type: 'pto' | 'expense', status, created_at, updated_at,
    approval_notes, denial_reason, manager_name, approved_at,
    escalation_reason, auto_approved
  }

Response 404: Request not found
Response 403: Not the request owner
```

#### D. List Employee's Historical Requests

```typescript
// GET /api/requests/history
// Employee views all their past requests

Request:
  Query: {type?: 'pto' | 'expense' | 'all', status?: 'approved' | 'denied' | 'pending', limit?: 50}

Response 200:
  [
    {id, type, status, created_at, summary, ...},
    ...
  ]
```

### 2. AI Agent Tools (Extensions)

**New tools for the agent to use:**

#### Tool: `get_request_status`

```typescript
name: "get_request_status"
description: "Check the status of a PTO or expense request. Called when employee asks 'What's the status of my request?'"
parameters: {
  request_id?: string; // Specific request to check
  request_type?: "pto" | "expense"; // Type of request
  days_back?: number; // Or: check requests from last X days
}
returns: {
  requests: [
    {
      id, type, status, created_at, updated_at,
      approval_notes, denial_reason, manager_name,
      escalation_reason, auto_approved
    }
  ]
}
```

#### Tool: `list_pending_escalations`

```typescript
name: "list_pending_escalations"
description: "List all escalated requests pending manager approval. For use by managers."
parameters: {}
returns: {
  pto_pending: [
    {id, employee_id, employee_name, start_date, end_date, escalation_reason}
  ],
  expense_pending: [
    {id, employee_id, employee_name, amount, escalation_reason}
  ]
}
```

#### Tool: `escalate_request`

```typescript
name: "escalate_request"
description: "Escalate a PTO or expense request to the employee's manager. Called when policy violations detected (blackout period, quota exceeded, etc.)"
parameters: {
  request_id: string;
  request_type: "pto" | "expense";
  escalation_reason: string; // e.g., "Requested during blackout period"
}
returns: {
  success: boolean;
  manager_id: string;
  manager_name: string;
  message: string;
}
```

#### Tool: `get_employee_directs`

```typescript
name: "get_employee_directs"
description: "Get list of direct reports under a manager. For managers only."
parameters: {}
returns: {
  direct_reports: [
    {id, username, employee_level, department}
  ]
}
```

### 3. Decision WebSocket Notification

**Mechanism: Inter-Durable Object Communication**

When manager approves/denies, notify employee in real-time:

```typescript
// In server.ts - handling POST /api/manager/decisions/:id

async function approveRequest(requestId, managerDecision, requestType) {
  // 1. Update database
  if (requestType === 'pto') {
    await db.execute(
      "UPDATE pto_requests SET status = ?, approval_notes = ?, approved_at = ? WHERE id = ?",
      [managerDecision.decision, managerDecision.reason, Date.now(), requestId]
    );
  } else {
    await db.execute(
      "UPDATE expense_requests SET status = ?, approval_notes = ?, approved_at = ? WHERE id = ?",
      [managerDecision.decision, managerDecision.reason, Date.now(), requestId]
    );
  }

  // 2. Create audit log entry (use existing audit_log table)
  await db.execute(
    "INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, actor_type, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      generateId(),
      requestType === 'pto' ? 'pto_request' : 'expense_request',
      requestId,
      managerDecision.decision,
      managerId,
      'user',
      JSON.stringify({
        approval_notes: managerDecision.reason,
        previous_status: 'pending_approval',
        new_status: managerDecision.decision
      })
    ]
  );

  // 3. Get employee's Chat Durable Object instance
  const employeeId = result.employee_id;
  const chatDOId = env.CHAT.idFromName(`${employeeId}-chat`);
  const chatDO = env.CHAT.get(chatDOId);

  // 4. Send internal message to Chat DO to notify employee
  await chatDO.fetch("http://internal/notify", {
    method: "POST",
    body: JSON.stringify({
      event: "request_decided",
      requestType: requestType,
      status: managerDecision.decision,
      reason: managerDecision.reason,
      managerName: managerName
    })
  });

  return { success: true };
}
```

**In Chat Agent:**

```typescript
async fetch(request) {
  const url = new URL(request.url);
  
  if (url.pathname === "/notify") {
    const { event, requestType, status, reason, managerName } = await request.json();
    
    if (event === "request_decided") {
      // Send message to employee via WebSocket
      const message = status === "approved"
        ? `✅ Great news! Your ${requestType} request was approved by ${managerName}`
        : `❌ Your ${requestType} request was denied by ${managerName}. Reason: ${reason}`;
      
      this.sendToClient(message);
    }
  }
}
```

### 4. Chat Agent Enhancements

**Update agent prompt to handle:**

1. **Detection of policy violations:**
   - Parse dates for blackout periods
   - Check PTO balance
   - Flag for escalation automatically

2. **Recognition of escalation requests:**
   - "Can I escalate this to my manager?"
   - "Manager approval needed for this"
   - Automatically escalate flagged requests

3. **Status checking:**
   - "What's the status of my request from last week?"
   - Query database and present findings
   - Show approval/denial info if available

4. **Manager-specific prompts:**
   - If user.role === 'manager': offer different tools
   - Show pending approvals count in context
   - Offer quick-approve/deny actions

---

## Frontend Implementation

### 1. Manager Dashboard UI

**New Components:**

#### ManagerDashboard.tsx - Main Container

```typescript
// src/components/manager/ManagerDashboard.tsx
// Shows tabs: Pending Approvals | History
// Displays pending PTO and expense requests
// Currently authenticated manager only sees their direct reports

Features:
- Tab navigation (Pending | History)
- Real-time update of pending counts
- Request cards with quick info
- Click to open approval dialog
```

#### PendingApprovalsTab.tsx

```typescript
// Displays:
// - PTO Requests (due dates highlighted)
// - Expense Requests (amounts by category)
// - Employee info (name, department)
// - Escalation reason (if any)
// 
// Click card → Opens ApprovalModalDialog
```

#### ApprovalModalDialog.tsx

```typescript
// Modal shows:
// - Full request details
// - Current status
// - Escalation reason (if escalated)
// - Employee's reasoning
// - Two buttons: "Approve" and "Deny"
// - Text field for approval/denial reason (optional)
// - Submit button
//
// On submit:
// - POST /api/manager/decisions/:id
// - Close modal
// - Refresh pending list
```

#### DecisionHistoryTab.tsx

```typescript
// Shows past approval/denial decisions
// Filters by: Date range, Request type, Decision status
// Displays:
// - Request summary
// - Employee name
// - Decision date
// - Manager's reason
```

### 2. Chat UI Enhancements

**Updates to src/app.tsx:**

```typescript
// 1. Add "Request Status" quick action button
//    "Check status of my PTO/expense requests"
//
// 2. Auto-scroll to new messages (for real-time notifications)
//
// 3. Add success badge for approved requests:
//    "✅ Your PTO request (Feb 17-20) was approved!"
//
// 4. Add denial card for denied requests:
//    "❌ Your PTO request was denied"
//    "Reason: Within blackout period (company closure)"
//    [Request Reviewer] button to see details
```

### 3. Role-Based UI Routing

**Update app routing:**

```typescript
// src/app.tsx

if (userRole === "manager") {
  // Show:
  // - Chat interface (can still ask questions)
  // - Manager dashboard tab
  // - Navigation between chat and dashboard
} else {
  // Show:
  // - Chat interface
  // - Optional: "View my requests" sidebar
}
```

---

## AI Agent Logic

### 1. Enhanced Agent Prompt

**Add context to system prompt:**

```markdown
# Manager Approval Workflow

You are helping employees and managers with approval flow for PTO and Expense requests.

## For Employees:
- When employee submits PTO request, evaluate against policy
- If within auto-approve limits: APPROVE immediately
- If policy violation (blackout, quota exceeded): ESCALATE to manager
  - Use escalate_request tool with reason
  - Inform employee: "I'm escalating this to your manager for review"
  - Suggest: "Once your manager reviews, you'll see the decision here in chat"
- If employee asks status: Use get_request_status tool
  - Show clear status (pending/approved/denied)
  - Show manager name if escalated
  - Show denial reason if denied

## For Managers:
- If manager opens chat: Offer quick access to pending approvals
- Show count: "You have 2 pending approvals"
- Can use chat to check details or use dashboard
- When manager approves via dashboard, you'll receive notification
  - Alert: "Manager reviewed request [ID]: Approved"

## Special Cases:
- Blackout Period: Flag during AI validation
  - "This date (Dec 25) is a company blackout period. Escalating to manager."
- Quota Exceeded: Show math
  - "Your balance is 3 days, request is 5 days. Escalating to manager."
- Denied: Always provide reason
  - "Sorry, this request was denied. Reason: [from manager]"
```

### 2. Agent Decision Logic (Pseudocode)

```pseudocode
// Function: evaluatePTORequest(request)

1. Extract: start_date, end_date, reason
2. Validate dates: Parse and check format
3. Calculate: total_days = businessDaysBetween(start_date, end_date)
4. Fetch: employee balance, policy rules, blackout dates
5. Check blackout: if (request.dates OVERLAP blackout_dates) → ESCALATE
6. Check quota: if (request.total_days > employee.balance) → ESCALATE
7. Check threshold: if (employee.level === 'senior' && total_days > 10) → ESCALATE
8. Default: AUTO-APPROVE
9. Side-effect: Insert pto_request record
   - If escalating: status = "pending_approval", manager_id = employee.manager_id
   - If auto-approving: status = "approved", manager_id = NULL
   - If denying: status = "denied", denial_reason = "[reason]"

// Function: evaluateExpenseRequest(receipt_data, amount, category)

1. Validate: amount, currency, category
2. Fetch: policy limits for category and employee level
3. Check limit: if (amount > policy.[category].limit) → ESCALATE
4. Check approval required: if (category === 'travel' && amount > 500) → ESCALATE
5. Default: AUTO-APPROVE
6. Side-effect: Insert expense_request record
   - Similar status logic as PTO
```

### 3. Natural Language Handling

**Employee utterances to handle:**

```
"I want to take PTO from Feb 17 to Feb 20"
→ Create PTO request with dates

"Can you check if I can take PTO during blackout period?"
→ Check calendar, respond: "No, Dec 25 is blackout. Want to escalate?"

"What's the status of my PTO request from Feb 10?"
→ Use get_request_status, show status + dates + approval info

"My manager denied my request - can I appeal?"
→ Response: "I can help you submit again or escalate to HR. What would you like?"

"I need $2000 reimbursement for airfare"
→ Evaluate against policy, escalate if needed

"Show me all my requests"
→ Use get_request_history, list by status
```

**Manager utterances to handle:**

```
"Show me pending approvals"
→ Use list_pending_escalations, display in chat (or direct to dashboard)

"Who are my direct reports?"
→ Use get_employee_directs, list employees

"Ramya's PTO request details"
→ Use get_request_status with employee filter
```

---

## Implementation Sequence

### Phase 1: Database & Backend (Week 1-2)

**Tasks:**

1. ✅ Create migration files:
   - `0009_add_escalation_to_pto_requests.sql`
   - `0010_add_manager_decision_to_expenses.sql`
   - (audit_log table already exists in `0006_create_audit_log_table.sql`)

2. ✅ Implement HTTP endpoints in `src/server.ts`:
   - `GET /api/manager/requests`
   - `POST /api/manager/decisions/:id`
   - `GET /api/requests/:id/status`
   - `GET /api/requests/history`

3. ✅ Add AI agent tools:
   - `get_request_status`
   - `list_pending_escalations`
   - `escalate_request`
   - `get_employee_directs`

4. ✅ Implement inter-DO notification system
   - Chat DO receives approval decisions
   - Sends messages to WebSocket clients

5. ✅ Update agent prompt with new logic

### Phase 2: Frontend - Chat Enhancements (Week 2)

**Tasks:**

1. ✅ Update `src/app.tsx`:
   - Add status checking UI
   - Real-time notification display
   - Success/failure badges

2. ✅ Create new chat-related components:
   - `RequestStatusCard.tsx` - Shows pending/approved/denied status
   - `EscalationNotice.tsx` - "Request escalated to manager"
   - `ApprovalNotification.tsx` - "Request approved by manager"

3. ✅ Enhance message handling:
   - Detect approval/denial notifications from agent
   - Display with appropriate styling/icons
   - Auto-scroll to new messages

### Phase 3: Frontend - Manager Dashboard (Week 3)

**Tasks:**

1. ✅ Create manager components:
   - `ManagerDashboard.tsx`
   - `PendingApprovalsTab.tsx`
   - `ApprovalModalDialog.tsx`
   - `DecisionHistoryTab.tsx`

2. ✅ Implement role-based UI routing:
   - Check user.role in app context
   - Show manager dashboard if manager
   - Navigate between chat and dashboard

3. ✅ Styling & UX polish:
   - Pending approval badges
   - Status indicators (yellow/green/red)
   - Action buttons with confirmation

### Phase 4: Integration & Testing (Week 4)

**Tasks:**

1. ✅ End-to-end flow testing:
   - Employee submits PTO → Auto-approve
   - Employee submits blackout PTO → Escalate
   - Manager sees escalation → Approve → Employee notified
   - Employee checks status → Sees "approved by manager"

2. ✅ Edge case testing:
   - Duplicate requests
   - Concurrent approvals
   - Invalid dates
   - Missing manager assignment

3. ✅ Deployment & monitoring:
   - Deploy migrations
   - Run on staging
   - Validate data flow
   - Production deployment

---

## Testing Strategy

### Unit Tests

**Database layer:**

```typescript
// tests/database.test.ts
- Test escalation_reason storage
- Test audit_log insertion
- Test status transitions (pending → approved)
- Test concurrent request handling
```

**Agent logic:**

```typescript
// tests/agent.test.ts
- Test blackout period detection
- Test quota validation
- Test escalation trigger
- Test status checking tool
```

### Integration Tests

```typescript
// tests/integration.test.ts
- Employee submits PTO → Auto-approve flow
- Employee submits blackout PTO → Escalate flow
- Manager approves escalated request → Real-time notification
- Employee checks status → Sees approved status
- Manager views pending approvals → Dashboard updates
```

### Manual Testing Checklist

**Employee Flow:**
- [ ] Submit PTO within quota → Auto-approve message
- [ ] Submit PTO outside quota → Escalation to manager
- [ ] Ask "What's the status of my PTO?" → Correct status displayed
- [ ] Receive approval in chat → Real-time notification
- [ ] View approval notes from manager → Details visible
- [ ] Submit expense → Auto-approve or escalate correctly

**Manager Flow:**
- [ ] Log in as manager → See dashboard tab
- [ ] Click "Approvals" tab → See pending requests
- [ ] Click request card → See details modal
- [ ] Enter approval reason → Save decision
- [ ] Refresh → Approval reflected
- [ ] Switch to chat → Ask "Show pending approvals"

---

## Success Criteria

### Functional Requirements

- ✅ Managers can log in and see pending PTO/expense requests
- ✅ Managers can approve/deny requests with reasoning
- ✅ Employees receive real-time chat notifications of decisions
- ✅ Employees can ask chatbot for request status
- ✅ Requests violating policy are auto-escalated to managers
- ✅ Audit log tracks all approval/denial decisions
- ✅ Employees cannot approve their own requests

### Non-Functional Requirements

- ✅ End-to-end request flow completes in <100ms (DB query + notification)
- ✅ Dashboard loads in <500ms
- ✅ Chat notification appears within 1 second of manager action
- ✅ No data loss during request status transitions
- ✅ Audit trail complete for compliance

### User Experience

- ✅ Clear indication when request is escalated
- ✅ Approval/denial reasons visible to employee
- ✅ Manager dashboard is intuitive and quick
- ✅ Chat notifications are non-intrusive but visible
- ✅ No ambiguity in request status

---

## Future Enhancements (Out of Scope)

1. **Multi-level approval chains** - VP approval after manager
2. **Email notifications** - In addition to chat
3. **Approval templates** - Standard denial reasons
4. **Approval delegation** - Manager can delegate to team lead
5. **Advanced analytics** - Approval trends per manager/department
6. **Integration with calendar** - Block calendar on approval
7. **Bulk actions** - Approve multiple requests at once
8. **Custom workflows** - Different rules per department

---

## Document Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | Feb 2026 | Initial comprehensive plan |

---

## Contact & Questions

For questions about this implementation plan, contact the engineering team.
