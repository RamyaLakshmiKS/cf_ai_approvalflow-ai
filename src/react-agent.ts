/**
 * AI SDK Agent Implementation
 *
 * Uses the Vercel AI SDK with Workers AI provider for streaming responses
 * with pattern-based tool triggering for expense dialogs
 */

import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { getSystemPrompt } from "./prompts";
import { tools } from "./tools";

/**
 * Tool context containing environment and user info
 */
export type ToolContext = {
  env: Env;
  userId: string;
};

/**
 * Execute the AI agent with streaming and tool support
 */
export async function runReActAgent(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  context: ToolContext
): Promise<{
  response: string;
  toolCalls: Array<{
    toolName: string;
    toolCallId: string;
    args: unknown;
    result: unknown;
  }>;
  steps: Array<{
    iteration: number;
    thought: string;
    action: string;
    observation: unknown;
  }>;
}> {
  console.log("[AGENT] Starting AI SDK agent with message:", userMessage);

  const steps: Array<{
    iteration: number;
    thought: string;
    action: string;
    observation: unknown;
  }> = [];

  // Create Workers AI instance
  const workersai = createWorkersAI({ binding: context.env.AI });
  // Use explicit model identifier. Types for the provider's model union are not exported,
  // so cast the factory to a permissive function type using `unknown` to avoid `any`.
  const model = (workersai as unknown as (m: string) => LanguageModel)(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  );

  // Limit conversation history to last 4 messages (2 turns)
  const recentHistory = conversationHistory.slice(-4);
  console.log(
    "[AGENT] Using",
    recentHistory.length,
    "recent messages from history"
  );

  // Convert history to AI SDK format
  const messages = recentHistory.map((msg) => ({
    role: msg.role as "user" | "assistant" | "system",
    content: msg.content
  }));

  // Add current user message
  messages.push({
    role: "user" as const,
    content: userMessage
  });

  // Check if user wants to submit an expense (pattern matching)
  const expenseKeywords = [
    "submit an expense",
    "expense reimbursement",
    "submit expense",
    "reimburse",
    "reimbursement",
    "upload receipt",
    "submit receipt",
    "expense for"
  ];
  const isExpenseRequest = expenseKeywords.some(keyword =>
    userMessage.toLowerCase().includes(keyword)
  );

  // Check if this is a submission confirmation from the dialog
  const isExpenseSubmission = userMessage.includes("I've submitted an expense:") &&
                              userMessage.includes("Receipt ID:");

  // If expense request detected, trigger the dialog tool
  if (isExpenseRequest && !isExpenseSubmission) {
    console.log("[AGENT] Expense request detected, calling show_expense_dialog");

    const toolResult = await tools.show_expense_dialog.execute({}, context);

    return {
      response: "Perfect! I'm opening the expense submission form for you. You'll be able to upload your receipt and the system will automatically extract the details.",
      toolCalls: [
        {
          toolName: "show_expense_dialog",
          toolCallId: crypto.randomUUID(),
          args: {},
          result: toolResult
        }
      ],
      steps: []
    };
  }

  // If this is an expense submission, let the agent handle it with tools
  // The system prompt will guide the agent to call validate_expense_policy and submit_expense_request

  try {
    // Manual ReAct loop for tool calling (since Workers AI doesn't support AI SDK tools well)
    const maxIterations = 5;
    let currentMessages = [...messages];
    let finalResponse = "";
    const toolCallsExecuted: Array<{
      toolName: string;
      toolCallId: string;
      args: unknown;
      result: unknown;
    }> = [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      console.log(`[AGENT] ReAct iteration ${iteration + 1}/${maxIterations}`);

      // Get AI response
      const result = await streamText({
        model,
        system: getSystemPrompt() + `\n\nIMPORTANT: When you need to call a tool, respond with EXACTLY this format:
TOOL_CALL: tool_name
PARAMETERS: {json parameters}
---

When you have all the information you need, provide your final response without any tool calls.`,
        messages: currentMessages,
        temperature: 0.2
      });

      // Collect response
      let responseText = "";
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          responseText += chunk.text;
        }
      }

      console.log(`[AGENT] Iteration ${iteration + 1} response:`, responseText.substring(0, 200));

      // Check if agent wants to call a tool
      const toolCallMatch = responseText.match(/TOOL_CALL:\s*(\w+)/);
      const parametersMatch = responseText.match(/PARAMETERS:\s*(\{[\s\S]*?\})\s*---/);

      if (toolCallMatch && parametersMatch) {
        const toolName = toolCallMatch[1];
        const tool = tools[toolName];

        if (!tool) {
          console.error(`[AGENT] Unknown tool: ${toolName}`);
          finalResponse = `I tried to call a tool that doesn't exist: ${toolName}`;
          break;
        }

        console.log(`[AGENT] Agent calling tool: ${toolName}`);

        try {
          const params = JSON.parse(parametersMatch[1]);
          const toolResult = await tool.execute(params, context);

          console.log(`[AGENT] Tool ${toolName} result:`, toolResult);

          const toolCallId = crypto.randomUUID();
          toolCallsExecuted.push({
            toolName,
            toolCallId,
            args: params,
            result: toolResult
          });

          // Add tool result to conversation
          currentMessages.push({
            role: "assistant",
            content: `TOOL_CALL: ${toolName}\nPARAMETERS: ${JSON.stringify(params)}\n---`
          });
          currentMessages.push({
            role: "user",
            content: `TOOL_RESULT: ${JSON.stringify(toolResult)}`
          });

          steps.push({
            iteration: iteration + 1,
            thought: `Calling ${toolName}`,
            action: toolName,
            observation: toolResult
          });
        } catch (error) {
          console.error(`[AGENT] Tool ${toolName} error:`, error);
          currentMessages.push({
            role: "user",
            content: `TOOL_ERROR: ${error instanceof Error ? error.message : "Tool execution failed"}`
          });
        }
      } else {
        // No more tool calls, this is the final response
        finalResponse = responseText;
        console.log("[AGENT] Final response generated");
        break;
      }
    }

    console.log(
      "[AGENT] Agent completed with response length:",
      finalResponse.length,
      "tool calls:",
      toolCallsExecuted.length
    );

    return {
      response:
        finalResponse.trim() ||
        "I apologize, but I wasn't able to generate a proper response. Please try again.",
      toolCalls: toolCallsExecuted,
      steps
    };
  } catch (error) {
    console.error("[AGENT] Error in runReActAgent:", error);
    return {
      response:
        "I encountered an error processing your request. Please try again.",
      toolCalls: [],
      steps
    };
  }
}
