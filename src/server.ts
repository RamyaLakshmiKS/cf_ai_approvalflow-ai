import { routeAgentRequest, type Schedule } from "agents";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, deleteCookie, setCookie } from "hono/cookie";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools } from "./tools";

const DEFAULT_CF_MODEL = "@cf/meta/llama-3.1-8b-instruct";
// Cloudflare AI Gateway

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // Collect all tools
    const allTools = {
      ...tools
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const workersai = createWorkersAI({ binding: this.env.AI });
        const modelName =
          (this.env as unknown as { MODEL?: string }).MODEL || DEFAULT_CF_MODEL;
        // @ts-expect-error (modelId is a provider-specific union type; we pass a runtime string)
        const model = workersai(modelName);

        let messages = cleanupMessages(this.messages);

        for (let i = 0; i < 10; i++) {
          const result = await streamText({
            system: `You are ApprovalFlow AI, an intelligent agent that helps employees with PTO requests and expense reimbursements.

## Your Capabilities

You have access to the following tools:
${JSON.stringify(allTools, null, 2)}

## How You Work (ReAct Framework)

You operate in a Thought-Action-Observation loop:

1. **THOUGHT**: Analyze the user's request and plan your approach step-by-step.
   - Break down complex tasks into smaller steps
   - Identify what information you need
   - Decide which tools to use

2. **ACTION**: Execute one tool at a time using this format:
   \`\`\`json
   {
     "action": "tool_name",
     "action_input": {
       "param1": "value1",
       "param2": "value2"
     }
   }
   \`\`\`

3. **OBSERVATION**: After each tool call, you'll receive results. Use them to update your thinking.

4. **LOOP**: Continue the cycle until you have all the information needed to provide a final answer.

5. **FINAL ANSWER**: When ready, provide your response using:
   \`\`\`json
   {
     "action": "final_answer",
     "action_input": {
       "response": "Your friendly, helpful response to the user"
     }
   }
   \`\`\`

## Policy Information

**IMPORTANT**: Do not use hardcoded policies. Always search the employee handbook using the \`search_employee_handbook\` tool to get current, accurate policy information. The handbook contains the authoritative rules for PTO, expenses, benefits, and all company policies.

## Your Behavior

- Always think step-by-step before acting
- Use tools to gather accurate, real-time data (don't guess)
- For any policy questions or validations, first search the employee handbook
- Validate against policies using the validation tools
- Be friendly, professional, and concise
- If a request violates policy, explain why clearly
- If escalating, explain the reason to both employee and manager
- Always log audit events for compliance
`,
            messages: convertToModelMessages(messages),
            model,
          });

          let fullResponse = "";
          for await (const delta of result.textStream) {
            fullResponse += delta;
          }

          const actionRegex = /```json\s*(\{[\s\S]*?\})\s*```/;
          const match = fullResponse.match(actionRegex);

          if (!match) {
            writer.write([
              {
                type: 'ui',
                props: {
                  role: 'assistant',
                  parts: [{ type: 'text', text: "I'm sorry, I'm having trouble understanding. Could you please rephrase?" }]
                }
              }
            ]);
            break;
          }

          const jsonAction = JSON.parse(match[1]);

          if (jsonAction.action === 'final_answer') {
            writer.write([
              {
                type: 'ui',
                props: {
                  role: 'assistant',
                  parts: [{ type: 'text', text: jsonAction.action_input.response }]
                }
              }
            ]);
            break;
          }

          const tool = allTools[jsonAction.action];
          if (!tool) {
            writer.write([
              {
                type: 'ui',
                props: {
                  role: 'assistant',
                  parts: [{ type: 'text', text: `Unknown tool: ${jsonAction.action}` }]
                }
              }
            ]);
            break;
          }

          const toolResult = await tool.execute(jsonAction.action_input);

          messages = [
            ...messages,
            {
              role: 'assistant',
              parts: [{ type: 'text', text: fullResponse }]
            },
            {
              role: 'tool',
              parts: [{ type: 'tool-result', toolName: jsonAction.action, result: toolResult }]
            }
          ];
        }
        onFinish({} as any);
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// Helper functions for password hashing
async function hashPassword(password: string, salt: string) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  return btoa(String.fromCharCode.apply(null, hashArray));
}

function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, Array.from(array)));
}

async function verifyPassword(password: string, salt: string, hash: string) {
  const hashToVerify = await hashPassword(password, salt);
  return hashToVerify === hash;
}

// Auth routes
app.post("/api/auth/register", async (c) => {
  try {
    const { username, password } = await c.req.json();

    if (!username || !password) {
      return c.json({ error: "Username and password are required" }, 400);
    }

    // Check if user already exists
    const existingUser = await c.env.APP_DB.prepare(
      "SELECT id FROM users WHERE username = ?"
    )
      .bind(username)
      .first();

    if (existingUser) {
      return c.json({ error: "Username already taken" }, 409);
    }

    const salt = generateSalt();
    const password_hash = await hashPassword(password, salt);
    const id = crypto.randomUUID();

    await c.env.APP_DB.prepare(
      "INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)"
    )
      .bind(id, username, password_hash, salt)
      .run();

    return c.json({ message: "User registered successfully" }, 201);
  } catch (error) {
    console.error("Registration error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/api/auth/login", async (c) => {
  try {
    const { username, password } = await c.req.json();

    if (!username || !password) {
      return c.json({ error: "Username and password are required" }, 400);
    }

    const user = await c.env.APP_DB.prepare(
      "SELECT * FROM users WHERE username = ?"
    )
      .bind(username)
      .first<{ id: string; password_hash: string; salt: string }>();

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const passwordIsValid = await verifyPassword(
      password,
      user.salt,
      user.password_hash
    );

    if (!passwordIsValid) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const sessionToken = generateSalt(); // Re-using salt generation for a random token
    const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
    const sessionId = crypto.randomUUID();

    await c.env.APP_DB.prepare(
      "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
    )
      .bind(sessionId, user.id, sessionToken, expires_at.getTime())
      .run();

    setCookie(c, "session_token", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      expires: expires_at
    });

    return c.json({ message: "Logged in successfully" });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/api/auth/logout", async (c) => {
  try {
    const sessionToken = getCookie(c, "session_token");

    if (sessionToken) {
      await c.env.APP_DB.prepare("DELETE FROM sessions WHERE token = ?")
        .bind(sessionToken)
        .run();
    }

    deleteCookie(c, "session_token");

    return c.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/api/auth/me", async (c) => {
  try {
    const sessionToken = getCookie(c, "session_token");

    if (!sessionToken) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const session = await c.env.APP_DB.prepare(
      "SELECT * FROM sessions WHERE token = ?"
    )
      .bind(sessionToken)
      .first<{ user_id: string; expires_at: number }>();

    if (!session || new Date(session.expires_at) < new Date()) {
      // Clean up expired cookie
      if (session) {
        deleteCookie(c, "session_token");
      }
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    const user = await c.env.APP_DB.prepare(
      "SELECT id, username, role FROM users WHERE id = ?"
    )
      .bind(session.user_id)
      .first();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json(user);
  } catch (error) {
    console.error("Me error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/check-ai-provider", (c) => {
  const hasAI = !!c.env.AI;
  if (!hasAI) {
    console.error(
      "AI binding is not configured (env.AI). Please configure the `ai` binding in wrangler.jsonc and ensure an AI Gateway is attached."
    );
  }
  return c.json({ success: hasAI });
});

// Fallback route for agent requests
app.all("*", async (c) => {
  return (
    (await routeAgentRequest(c.req.raw, c.env)) ||
    new Response("Not found", { status: 404 })
  );
});

export default app;
