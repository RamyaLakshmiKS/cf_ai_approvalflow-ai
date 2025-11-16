# Test Scenarios for Agent Behavior Fix

## Scenario 1: Simple Greeting (Should NOT hallucinate)

### Input

```
User: "hello"
```

### Expected Behavior

- Agent recognizes this as a greeting
- No tools are called
- Agent responds conversationally
- Agent asks what the user needs

### Expected Output

```
{
  "response": "Hi! I'm ApprovalFlow AI. I can help you with:\n- **PTO Requests**: Submit time off requests\n- **Expense Reimbursements**: Request reimbursement for work expenses\n\nWhat can I help you with today?",
  "steps": []
}
```

### Tool Calls

None (0 tools called)

---

## Scenario 2: Vague Request (Should Ask for Clarification)

### Input

```
User: "I need some time off"
```

### Expected Behavior

- Agent recognizes PTO intent but no specific dates provided
- Agent asks for clarification
- No tools are called
- Agent helps guide the user to provide required information

### Expected Output

```
{
  "response": "I'd be happy to help! To process your PTO request, I need a few details:\n- What dates are you requesting off? (e.g., November 18-20, 2025)\n- What's the reason? (optional but helpful)\n\nPlease provide the dates and I'll check your balance and policy limits.",
  "steps": []
}
```

### Tool Calls

None (0 tools called)

---

## Scenario 3: Complete Request (Should Process Normally)

### Input

```
User: "I need PTO from December 1-5, 2025 for a holiday vacation"
```

### Expected Behavior

- Agent recognizes complete PTO request with dates
- Agent calls get_current_user to identify requester
- Agent calls calculate_business_days to compute days requested
- Agent calls get_pto_balance to check available balance
- Agent calls search_employee_handbook for policy info
- Agent calls check_blackout_periods to verify no conflicts
- Agent calls validate_pto_policy to validate request
- Agent calls submit_pto_request to create the request
- Agent provides response about status (auto-approved, escalated, or denied)

### Expected Output

```
{
  "response": "Your PTO request for December 1-5, 2025 (5 business days) has been successfully submitted. Since this exceeds the auto-approval limit for your level, it has been escalated to your manager for review. You should expect a response within 1-2 business days.",
  "steps": [
    { iteration: 0, action: "get_current_user", ... },
    { iteration: 1, action: "calculate_business_days", ... },
    { iteration: 2, action: "get_pto_balance", ... },
    { iteration: 3, action: "search_employee_handbook", ... },
    { iteration: 4, action: "check_blackout_periods", ... },
    { iteration: 5, action: "validate_pto_policy", ... },
    { iteration: 6, action: "submit_pto_request", ... },
    { iteration: 7, action: "final_answer", ... }
  ]
}
```

### Tool Calls

7-8 tools called (typical for complete PTO request)

---

## Scenario 4: Question About Policy (Should Use Handbook Search Only)

### Input

```
User: "What's the maximum PTO I can take without manager approval?"
```

### Expected Behavior

- Agent recognizes this as a policy question
- Agent searches the employee handbook
- Agent responds with policy information
- Agent does NOT call get_current_user or other tools

### Expected Output

```
{
  "response": "Based on the employee handbook, the maximum PTO that can be auto-approved depends on your employee level:\n- Junior employees: up to 3 business days\n- Senior employees: up to 10 business days\n\nRequests exceeding these limits require manager approval.",
  "steps": [
    { iteration: 0, action: "search_employee_handbook", ... },
    { iteration: 1, action: "final_answer", ... }
  ]
}
```

### Tool Calls

1 tool called (search_employee_handbook only)

---

## Scenario 5: Incomplete with Partial Info (Should Ask for More)

### Input

```
User: "I need PTO next week"
```

### Expected Behavior

- Agent recognizes "next week" is not specific enough
- Agent asks for exact dates
- No tools are called
- Agent explains why specific dates are needed

### Expected Output

```
{
  "response": "I'd be happy to help you request PTO for next week! However, I need the specific dates to process your request. Could you please provide:\n- Start date (e.g., November 18, 2025)\n- End date (e.g., November 22, 2025)\n\nOnce I have the exact dates, I can check your balance, validate against company policies, and submit your request.",
  "steps": []
}
```

### Tool Calls

None (0 tools called)

---

## Verification Checklist

Use this checklist when testing the agent:

- [ ] Scenario 1: "hello" → No tools called, conversational response
- [ ] Scenario 2: "I need time off" → No tools called, asks for dates
- [ ] Scenario 3: "I need PTO from Dec 1-5" → Tools called, processes request
- [ ] Scenario 4: Policy question → Only handbook search used
- [ ] Scenario 5: "next week" → No tools called, asks for specific dates

## Debug Mode

When testing, check the agent debug output for:

1. **Iteration count** - Should be 1 for simple responses, 7+ for full requests
2. **Tool calls** - Verify only appropriate tools are called
3. **Dates in messages** - Ensure no hallucinated dates in responses
4. **Final answer action** - Agent should reach this without errors

Enable debug mode in the UI (toggle the bug icon) to see:

- Raw message JSON
- Tool invocation details
- LLM reasoning steps
