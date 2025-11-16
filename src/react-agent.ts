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

import { getSystemPrompt } from "./prompts";
import { type ToolContext, tools } from "./tools";

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
  action_input: Record<string, unknown>;
  observation: unknown;
}

/**
 * Parse the LLM response to extract thought and action
 */
function parseAgentResponse(response: string): {
  thought: string;
  action: string;
  action_input: Record<string, unknown>;
} | null {
  try {
    console.log("[REACT-AGENT] Parsing LLM response");
    // Extract JSON from code blocks
    const jsonMatch = response.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (!jsonMatch) {
      console.error("[REACT-AGENT] No JSON found in response:", response);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[1]);

    if (!parsed.action) {
      console.error(
        "[REACT-AGENT] No action found in parsed response:",
        parsed
      );
      return null;
    }

    console.log("[REACT-AGENT] Successfully parsed action:", parsed.action);
    return {
      thought: parsed.thought || "No thought provided",
      action: parsed.action,
      action_input: parsed.action_input || {}
    };
  } catch (error) {
    console.error(
      "[REACT-AGENT] Error parsing agent response:",
      error,
      response
    );
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
  console.log("[REACT-AGENT] Starting agent with message:", userMessage);

  const steps: ReActStep[] = [];

  // Limit conversation history to last 4 messages (2 turns) to prevent context overflow
  const recentHistory = conversationHistory.slice(-4);
  console.log(
    "[REACT-AGENT] Using",
    recentHistory.length,
    "recent messages from history"
  );

  const messages = [...recentHistory, { role: "user", content: userMessage }];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    console.log("[REACT-AGENT] Iteration", iteration + 1, "of", MAX_ITERATIONS);

    // Generate next action from LLM
    const llmResponse = (await context.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as keyof AiModels,
      {
        messages: [{ role: "system", content: getSystemPrompt() }, ...messages],
        max_tokens: 1500,
        temperature: 0.2 // Slightly higher for better reasoning
      }
    )) as unknown;

    const responseText = ((llmResponse as { response?: string }).response ||
      String(llmResponse)) as string;
    console.log("[REACT-AGENT] LLM response received, parsing...");

    // Parse the response
    const parsed = parseAgentResponse(responseText);
    if (!parsed) {
      console.warn(
        "[REACT-AGENT] Failed to parse response, checking if it's a direct answer"
      );

      // Only allow direct responses for simple greetings
      // Check if user message is a greeting
      const userGreetings = [
        "hello",
        "hi",
        "hey",
        "good morning",
        "good afternoon",
        "good evening"
      ];
      const isGreeting = userGreetings.some(
        (greeting) =>
          userMessage.toLowerCase().trim() === greeting ||
          userMessage.toLowerCase().trim().startsWith(`${greeting} `)
      );

      if (isGreeting && responseText.length < 300) {
        console.log(
          "[REACT-AGENT] User sent greeting, allowing plain text response"
        );
        return {
          response: responseText.trim(),
          steps
        };
      }

      // For non-greetings, this is a genuine error - LLM should have used JSON format
      console.error(
        "[REACT-AGENT] LLM failed to use required JSON format for non-greeting interaction"
      );

      // Add the malformed response to context and retry with explicit instruction
      messages.push(
        { role: "assistant", content: responseText },
        {
          role: "user",
          content: `ERROR: You must respond using the JSON format with action and action_input. Do not respond with plain text except for simple greetings. Please try again using the correct JSON format.`
        }
      );
      continue; // Retry the iteration
    }

    const { thought, action, action_input } = parsed;
    console.log("[REACT-AGENT] Parsed action:", action);

    // Check if this is the final answer
    if (action === "final_answer") {
      console.log("[REACT-AGENT] Final answer reached");
      steps.push({
        iteration,
        thought,
        action,
        action_input,
        observation: "Completed"
      });

      return {
        response:
          (action_input as { response?: string }).response ||
          "I've completed your request.",
        steps
      };
    }

    // Execute the tool
    const tool = tools[action];
    if (!tool) {
      const errorMsg = `Unknown tool: ${action}. Available tools: ${Object.keys(tools).join(", ")}`;
      console.error("[REACT-AGENT] Tool not found:", action);
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
        {
          role: "user",
          content: `Error: ${errorMsg}. Please use a valid tool.`
        }
      );
      continue;
    }

    try {
      // Execute the tool
      console.log("[REACT-AGENT] Executing tool:", action);
      const observation = await tool.execute(action_input, context);
      console.log("[REACT-AGENT] Tool execution completed");

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
        {
          role: "user",
          content: `OBSERVATION: ${JSON.stringify(observation, null, 2)}`
        }
      );
    } catch (error) {
      const errorMsg = `Tool execution error: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[REACT-AGENT] Error executing tool:", errorMsg);

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
  console.warn("[REACT-AGENT] Max iterations reached without completion");
  return {
    response:
      "I apologize, but I wasn't able to complete your request within the allowed time. Please try breaking down your request into smaller parts.",
    steps
  };
}
