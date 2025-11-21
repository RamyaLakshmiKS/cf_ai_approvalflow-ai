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
 * Tool streaming update callback
 */
export type ToolStreamCallback = (update: {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result?: unknown;
  state: "input-available" | "output-available" | "output-error";
  error?: string;
}) => Promise<void>;

/**
 * Execute the AI agent with streaming and tool support
 */
export async function runReActAgent(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  context: ToolContext,
  onToolUpdate?: ToolStreamCallback
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
    // Manual ReAct loop for tool calling (since Workers AI doesn't support AI SDK tools well)
    const maxIterations = 15; // Increased to handle complex multi-tool requests
    const currentMessages = [...messages];
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
        system:
          getSystemPrompt() +
          `\n\nIMPORTANT: When you need to call a tool, respond with ONLY the tool call - NO other text before or after:

TOOL_CALL: tool_name
PARAMETERS: {json parameters}
---

DO NOT add any conversational text before the TOOL_CALL line. Just output the tool call.

CRITICAL: For tools with optional parameters (like get_pto_balance, get_pto_history, show_expense_dialog), use an empty object {} if you want to use the default values (current user).
Example - get_pto_balance for current user:
TOOL_CALL: get_pto_balance
PARAMETERS: {}
---

Example - show_expense_dialog to open expense form:
TOOL_CALL: show_expense_dialog
PARAMETERS: {}
---

CRITICAL: When copying UUIDs (like receipt_id or employee_id) from user messages:
- UUIDs are EXACTLY 36 characters long (e.g., "49973e8b-f4d6-4bd0-b448-60ec2187e5eb")
- Copy the ENTIRE UUID character-by-character without truncating or modifying
- Check that you have all 36 characters before using the UUID

When you have all the information you need and NO MORE TOOLS are needed, provide your final response without any tool calls.`,
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

      console.log(
        `[AGENT] Iteration ${iteration + 1} response:`,
        responseText.substring(0, 200)
      );

      // Check if agent wants to call a tool
      const toolCallMatch = responseText.match(/TOOL_CALL:\s*(\w+)/);
      const parametersMatch = responseText.match(
        /PARAMETERS:\s*(\{[\s\S]*?\})\s*---/
      );

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
          // Clean up the JSON before parsing - fix common LLM JSON errors
          let paramsStr = parametersMatch[1];
          console.log(`[AGENT] Raw params JSON:`, paramsStr.substring(0, 200));

          // Fix malformed property names where closing quote is missing before colon
          // Pattern: "propertyName:value" -> "propertyName":"value"
          // Example: "validation_notes:Valid text" -> "validation_notes":"Valid text"
          paramsStr = paramsStr.replace(
            /"([a-zA-Z_][a-zA-Z0-9_]*):([^"]+)"/g,
            (_match, prop, value) => {
              return '"' + prop + '":"' + value + '"';
            }
          );

          // Fix missing values after colons (e.g., "amount":, -> "amount": null,)
          paramsStr = paramsStr.replace(/:\s*,/g, ": null,");
          // Fix trailing commas before closing braces
          paramsStr = paramsStr.replace(/,\s*}/g, "}");
          // Fix missing values at end (e.g., "amount":})
          paramsStr = paramsStr.replace(/:\s*}/g, ": null}");

          if (paramsStr !== parametersMatch[1]) {
            console.log(
              `[AGENT] Cleaned params JSON:`,
              paramsStr.substring(0, 200)
            );
          }

          const params = JSON.parse(paramsStr);
          const toolCallId = crypto.randomUUID();

          // Stream tool input (before execution)
          if (onToolUpdate) {
            await onToolUpdate({
              toolName,
              toolCallId,
              args: params,
              state: "input-available"
            });
          }

          // Execute the tool
          const toolResult = await tool.execute(params, context);

          console.log(`[AGENT] Tool ${toolName} result:`, toolResult);

          toolCallsExecuted.push({
            toolName,
            toolCallId,
            args: params,
            result: toolResult
          });

          // Stream tool output (after execution)
          if (onToolUpdate) {
            await onToolUpdate({
              toolName,
              toolCallId,
              args: params,
              result: toolResult,
              state: "output-available"
            });
          }

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

          // Provide helpful error message to help AI recover
          let errorMsg =
            error instanceof Error ? error.message : "Tool execution failed";

          // If it's a JSON parse error, give specific guidance
          if (errorMsg.includes("JSON")) {
            errorMsg = `Invalid JSON format in PARAMETERS. Make sure all values are properly formatted. For numbers, use: "amount": 23.75 (not "amount":,). For strings, use quotes: "category": "meals"`;
          }

          // Stream tool error
          if (onToolUpdate && toolCallMatch) {
            const toolCallId = crypto.randomUUID();
            await onToolUpdate({
              toolName: toolCallMatch[1],
              toolCallId,
              args: parametersMatch ? JSON.parse(parametersMatch[1]) : {},
              state: "output-error",
              error: errorMsg
            });
          }

          currentMessages.push({
            role: "user",
            content: `TOOL_ERROR: ${errorMsg}. Please try again with correct parameters.`
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

    // If we have no final response, generate a helpful default
    if (!finalResponse.trim()) {
      if (toolCallsExecuted.length > 0) {
        finalResponse =
          "I've gathered the information you requested. Let me know if you need anything else!";
      } else {
        finalResponse =
          "I apologize, but I wasn't able to generate a proper response. Please try again.";
      }
    }

    return {
      response: finalResponse.trim(),
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
