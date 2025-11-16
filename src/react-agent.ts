/**
 * ReAct Agent Implementation
 * 
 * This agent implements the Thought-Action-Observation loop:
 * 1. THOUGHT: LLM reasons about what to do
 * 2. ACTION: Execute a tool
 * 3. OBSERVATION: Receive tool results
 * 4. LOOP: Repeat until task is complete
 * 5. FINAL ANSWER: Provide response to user
 */

import { tools, getToolDescriptions, type ToolContext } from "./tools";

/**
 * Maximum number of reasoning iterations to prevent infinite loops
 */
const MAX_ITERATIONS = 10;

/**
 * Step in the ReAct loop
 */
interface ReActStep {
  iteration: number;
  thought: string;
  action: string;
  action_input: Record<string, any>;
  observation: any;
}

/**
 * System prompt for the ReAct agent
 */
function getSystemPrompt(): string {
  return `You are ApprovalFlow AI, an intelligent agent that helps employees with PTO requests and expense reimbursements.

## Your Capabilities

You have access to the following tools:

${getToolDescriptions()}

## How You Work (ReAct Framework)

You operate in a **Thought-Action-Observation** loop:

### 1. THOUGHT
Analyze the user's request and plan your approach step-by-step. Think out loud about:
- What information you need
- Which tools to use
- What you've learned so far

### 2. ACTION
Execute ONE tool at a time using this EXACT JSON format:
\`\`\`json
{
  "thought": "Your reasoning about what to do next",
  "action": "tool_name",
  "action_input": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

### 3. OBSERVATION
After each tool call, you'll receive results. Use them to update your thinking.

### 4. LOOP
Continue the cycle until you have all the information needed.

### 5. FINAL ANSWER
When you're ready to respond to the user, use:
\`\`\`json
{
  "thought": "I have all the information I need to respond",
  "action": "final_answer",
  "action_input": {
    "response": "Your friendly, helpful response to the user"
  }
}
\`\`\`

## Important Rules

1. **Always start by getting the current user** with \`get_current_user\` tool
2. **Search the handbook** for any policy questions using \`search_employee_handbook\`
3. **For PTO requests:**
   - Calculate business days first
   - Check PTO balance
   - Search handbook for auto-approval limits
   - Check blackout periods
   - Validate with \`validate_pto_policy\`
   - Submit with \`submit_pto_request\` if valid
   - Log audit event

4. **Be thorough** - Don't skip validation steps
5. **Be accurate** - Use tools, don't guess or hallucinate data
6. **Be friendly** - Provide clear, helpful responses
7. **Explain rejections** - If denying a request, explain why clearly

## Example Flow for PTO Request

User: "I need 3 days off next week"

Step 1:
\`\`\`json
{
  "thought": "I need to help with a PTO request. First, I should get the current user's information to know who is requesting.",
  "action": "get_current_user",
  "action_input": {}
}
\`\`\`

OBSERVATION: {"id": "user123", "username": "alice", "employee_level": "junior", ...}

Step 2:
\`\`\`json
{
  "thought": "Alice is a junior employee. Now I need to understand the auto-approval limits from the handbook.",
  "action": "search_employee_handbook",
  "action_input": {
    "query": "What are the PTO auto-approval limits for junior employees?"
  }
}
\`\`\`

OBSERVATION: {"answer": "Junior employees can have PTO requests up to 3 business days auto-approved...", ...}

Step 3:
\`\`\`json
{
  "thought": "Junior employees can auto-approve up to 3 days. Now I need to calculate the exact business days for 'next week'. I'll need specific dates. Let me ask the user.",
  "action": "final_answer",
  "action_input": {
    "response": "I'd be happy to help you request 3 days off! Could you please provide the specific dates? For example: 'November 18-20, 2025'"
  }
}
\`\`\`

## Your Behavior

- Think step-by-step
- Use tools to get accurate data
- Don't skip validation
- Be helpful and friendly
- Explain policy violations clearly
- Always log important actions

Now, help the user with their request!`;
}

/**
 * Parse the LLM response to extract thought and action
 */
function parseAgentResponse(response: string): { thought: string; action: string; action_input: Record<string, any> } | null {
  try {
    // Extract JSON from code blocks
    const jsonMatch = response.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (!jsonMatch) {
      console.error("No JSON found in response:", response);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[1]);
    
    if (!parsed.action) {
      console.error("No action found in parsed response:", parsed);
      return null;
    }

    return {
      thought: parsed.thought || "No thought provided",
      action: parsed.action,
      action_input: parsed.action_input || {}
    };
  } catch (error) {
    console.error("Error parsing agent response:", error, response);
    return null;
  }
}

/**
 * Execute the ReAct agent loop
 */
export async function runReActAgent(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  context: ToolContext
): Promise<{ response: string; steps: ReActStep[] }> {
  const steps: ReActStep[] = [];
  const messages = [...conversationHistory, { role: "user", content: userMessage }];
  
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Generate next action from LLM
    const llmResponse = await context.env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
      messages: [
        { role: "system", content: getSystemPrompt() },
        ...messages
      ],
      max_tokens: 1000,
      temperature: 0.1 // Low temperature for more consistent reasoning
    }) as any;

    const responseText = (llmResponse.response || String(llmResponse)) as string;
    
    // Parse the response
    const parsed = parseAgentResponse(responseText);
    if (!parsed) {
      // LLM didn't follow format, provide error
      return {
        response: "I apologize, but I'm having trouble processing your request. Could you please rephrase it?",
        steps
      };
    }

    const { thought, action, action_input } = parsed;

    // Check if this is the final answer
    if (action === "final_answer") {
      steps.push({
        iteration,
        thought,
        action,
        action_input,
        observation: "Completed"
      });

      return {
        response: action_input.response || "I've completed your request.",
        steps
      };
    }

    // Execute the tool
    const tool = tools[action];
    if (!tool) {
      const errorMsg = `Unknown tool: ${action}. Available tools: ${Object.keys(tools).join(", ")}`;
      steps.push({
        iteration,
        thought,
        action,
        action_input,
        observation: { error: errorMsg }
      });

      // Add error to conversation and continue
      messages.push(
        { role: "assistant", content: responseText },
        { role: "user", content: `Error: ${errorMsg}. Please use a valid tool.` }
      );
      continue;
    }

    try {
      // Execute the tool
      const observation = await tool.execute(action_input, context);
      
      steps.push({
        iteration,
        thought,
        action,
        action_input,
        observation
      });

      // Add to conversation history
      messages.push(
        { role: "assistant", content: responseText },
        { role: "user", content: `OBSERVATION: ${JSON.stringify(observation, null, 2)}` }
      );

    } catch (error) {
      const errorMsg = `Tool execution error: ${error instanceof Error ? error.message : String(error)}`;
      
      steps.push({
        iteration,
        thought,
        action,
        action_input,
        observation: { error: errorMsg }
      });

      // Add error to conversation
      messages.push(
        { role: "assistant", content: responseText },
        { role: "user", content: `Error executing tool: ${errorMsg}` }
      );
    }
  }

  // Max iterations reached
  return {
    response: "I apologize, but I wasn't able to complete your request within the allowed time. Please try breaking down your request into smaller parts.",
    steps
  };
}
