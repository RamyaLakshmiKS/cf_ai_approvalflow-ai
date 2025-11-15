import { routeAgentRequest, type Schedule } from "agents";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, deleteCookie } from "hono/cookie";

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
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions: {}
        });

        const workersai = createWorkersAI({ binding: this.env.AI });
        const modelName =
          (this.env as unknown as { MODEL?: string }).MODEL || DEFAULT_CF_MODEL;
        // The provider exposes a constrained model id union type; to avoid
        // brittle type-level coupling with the provider package we pass the
        // runtime string and ignore TypeScript here. The runtime model (e.g.
        // '@cf/meta/llama-2-7b-chat-int8') must be a valid Workers AI model id.
        // @ts-expect-error (modelId is a provider-specific union type; we pass a runtime string)
        const model = workersai(modelName);

        const result = streamText({
          system: `You are an assistant for an approval workflow application.
You can help users with tasks related to approvals, such as creating, reviewing, and managing approval requests.
You can also schedule tasks and reminders.

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
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

    const salt = generateSalt();
    const password_hash = await hashPassword(password, salt);

    await c.env.APP_DB.prepare(
      "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)"
    )
      .bind(username, password_hash, salt)
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

    await c.env.APP_DB.prepare(
      "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)"
    )
      .bind(user.id, sessionToken, expires_at.getTime())
      .run();

    c.cookie("session_token", sessionToken, {
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
