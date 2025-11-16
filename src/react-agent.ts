/**
 * AI SDK Agent Implementation
 *
 * Uses the Vercel AI SDK with Workers AI provider for streaming responses
 * Note: Currently using manual tool execution due to ai-sdk v5 API compatibility
 */

import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { getSystemPrompt } from "./prompts";

/**
 * Tool context containing environment and user info
 */
export type ToolContext = {
  env: Env;
  userId: string;
};

/**
 * Execute the AI agent with streaming - SIMPLIFIED VERSION without tools for now
 * TODO: Add tool support once ai-sdk v5 tool() API is properly configured
 */
export async function runReActAgent(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  context: ToolContext
): Promise<{
  response: string;
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
    // Use streamText WITHOUT tools for now (simpler, working approach)
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
      steps
    };
  } catch (error) {
    console.error("[AGENT] Error in runReActAgent:", error);
    return {
      response:
        "I encountered an error processing your request. Please try again.",
      steps
    };
  }
}
