/**
 * AI SDK Agent Implementation
 *
 * Uses the Vercel AI SDK with Workers AI provider for streaming responses
 * with tool support for expense dialogs and other actions
 */

import { streamText, tool } from "ai";
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
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

  try {
    // Create AI SDK compatible tools
    const aiTools = {
      show_expense_dialog: tool({
        description: "Shows the expense submission dialog to the user when they want to submit an expense reimbursement request. Use this when the user mentions wanting to submit an expense, get reimbursed, or upload a receipt.",
        parameters: z.object({}),
        execute: async () => {
          console.log("[TOOL] show_expense_dialog called from AI SDK");
          return await tools.show_expense_dialog.execute({}, context);
        }
      })
    };

    // Use streamText WITH tools
    const result = await streamText({
      model,
      system: getSystemPrompt(),
      messages,
      temperature: 0.2,
      tools: aiTools,
      maxToolRoundtrips: 5
    });

    // Collect the full response and tool calls
    let fullResponse = "";
    const toolCalls: Array<{
      toolName: string;
      toolCallId: string;
      args: unknown;
      result: unknown
    }> = [];

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        fullResponse += chunk.text;
      } else if (chunk.type === "tool-call") {
        console.log("[AGENT] Tool called:", chunk.toolName, "id:", chunk.toolCallId);
        // Store the tool call info
        const existingCall = toolCalls.find(tc => tc.toolCallId === chunk.toolCallId);
        if (!existingCall) {
          toolCalls.push({
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            args: (chunk as any).input || {},
            result: null
          });
        }
      } else if (chunk.type === "tool-result") {
        console.log("[AGENT] Tool result:", chunk.toolName, (chunk as any).output);
        // Update the tool call with the result
        const call = toolCalls.find(tc => tc.toolCallId === chunk.toolCallId);
        if (call) {
          call.result = (chunk as any).output;
        }
      } else if (chunk.type === "error") {
        console.error("[AGENT] Stream error:", chunk.error);
        throw chunk.error;
      }
    }

    console.log(
      "[AGENT] Agent completed with response length:",
      fullResponse.length,
      "tool calls:",
      toolCalls.length
    );

    return {
      response:
        fullResponse.trim() ||
        "I apologize, but I wasn't able to generate a proper response. Please try again.",
      toolCalls,
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
