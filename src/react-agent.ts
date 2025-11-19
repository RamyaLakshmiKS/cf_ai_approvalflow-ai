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

  // If expense request detected, trigger the dialog tool
  if (isExpenseRequest) {
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

  try {
    // Use streamText WITHOUT tools (Workers AI doesn't support tool calling well)
    const result = await streamText({
      model,
      system: getSystemPrompt(),
      messages,
      temperature: 0.2
    });

    // Collect the full response
    let fullResponse = "";

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        fullResponse += chunk.text;
      } else if (chunk.type === "error") {
        console.error("[AGENT] Stream error:", chunk.error);
        throw chunk.error;
      }
    }

    console.log(
      "[AGENT] Agent completed with response length:",
      fullResponse.length
    );

    return {
      response:
        fullResponse.trim() ||
        "I apologize, but I wasn't able to generate a proper response. Please try again.",
      toolCalls: [],
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
