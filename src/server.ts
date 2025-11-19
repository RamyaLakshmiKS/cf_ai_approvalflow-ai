import { routeAgentRequest, Agent } from "agents";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { tools } from "./tools";
import { getSystemPrompt } from "./prompts";

/**
 * Chat Agent State Interface
 * Defines the typed state managed by the Agent SDK
 */
interface ChatState {
  userId?: string;
  username?: string;
  employeeLevel?: "junior" | "senior";
  managerId?: string;
  lastActivity?: number;
  conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}

type AiTextGenerationOutput = {
  response?: string;
  tool_calls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
};

/**
 * Chat Agent implementation using Cloudflare Agents SDK
 * with native Workers AI tool calling
 */
export class Chat extends Agent<Env, ChatState> {
  /**
   * Initial state definition for the agent
   */
  initialState: ChatState = {
    conversationHistory: []
  };

  /**
   * Handle HTTP requests to the agent
   */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract user ID from headers set by middleware
    const userId = request.headers.get("X-User-Id");
    const username = request.headers.get("X-Username");

    console.log("[CHAT] Request:", {
      method: request.method,
      path: url.pathname,
      userId,
      username
    });

    // Persist userId in Agent state
    if (userId && userId !== this.state.userId) {
      this.setState({
        ...this.state,
        userId,
        username: username || undefined,
        lastActivity: Date.now()
      });
      console.log("[CHAT] User authenticated:", username);
    }

    // Handle chat messages
    if (request.method === "POST" && url.pathname.includes("/chat")) {
      return await this.handleChatMessage(request);
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Handle incoming chat messages with native Workers AI tool calling
   */
  private async handleChatMessage(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { message: string };
      const userMessage = body.message;

      if (!userMessage) {
        return Response.json({ error: "Message is required" }, { status: 400 });
      }

      const userId = this.state.userId;
      if (!userId) {
        return Response.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      console.log("[CHAT] Processing message:", userMessage);

      // Add user message to history
      const conversationHistory = [
        ...this.state.conversationHistory.slice(-4), // Keep last 4 messages
        { role: "user" as const, content: userMessage }
      ];

      // Build messages for Workers AI
      const messages = [
        { role: "system", content: getSystemPrompt() },
        ...conversationHistory
      ];

      // Convert tools to Workers AI format
      const workersAiTools = Object.values(tools).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters.shape,
          required: Object.keys(tool.parameters.shape).filter(
            (key) => !tool.parameters.shape[key].isOptional()
          )
        }
      }));

      console.log("[CHAT] Configured", workersAiTools.length, "tools");

      // ReAct loop with tool calling
      let maxIterations = 10;
      let currentMessages = [...messages];
      let finalResponse = "";
      const toolExecutions: Array<{ tool: string; result: unknown }> = [];

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`[CHAT] Iteration ${iteration + 1}`);

        const result = (await this.env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages: currentMessages,
            tools: workersAiTools,
            temperature: 0.2
          }
        )) as AiTextGenerationOutput;

        console.log("[CHAT] AI response:", {
          hasResponse: !!result.response,
          toolCallCount: result.tool_calls?.length || 0
        });

        // Execute tool calls
        if (result.tool_calls && result.tool_calls.length > 0) {
          for (const toolCall of result.tool_calls) {
            const tool = tools[toolCall.name];
            if (!tool) {
              console.warn(`[CHAT] Unknown tool: ${toolCall.name}`);
              continue;
            }

            try {
              console.log(`[TOOL] Executing ${toolCall.name}`);
              const toolResult = await tool.execute(toolCall.arguments, {
                env: this.env,
                userId
              });
              console.log(`[TOOL] ${toolCall.name} completed`);

              toolExecutions.push({
                tool: toolCall.name,
                result: toolResult
              });

              // Add tool result to conversation
              currentMessages.push({
                role: "assistant",
                content: `Used tool ${toolCall.name}`
              });
              currentMessages.push({
                role: "user",
                content: `Tool result: ${JSON.stringify(toolResult)}`
              });
            } catch (error) {
              console.error(`[TOOL] Error in ${toolCall.name}:`, error);
              currentMessages.push({
                role: "user",
                content: `Tool error: ${error instanceof Error ? error.message : "Unknown error"}`
              });
            }
          }
          continue;
        }

        // Got final response
        if (result.response) {
          finalResponse = result.response;
          break;
        }

        console.warn("[CHAT] No response or tool calls");
        break;
      }

      // Update conversation history in state
      this.setState({
        ...this.state,
        conversationHistory: [
          ...conversationHistory,
          { role: "assistant", content: finalResponse }
        ],
        lastActivity: Date.now()
      });

      console.log(
        "[CHAT] Response generated with",
        toolExecutions.length,
        "tool executions"
      );

      return Response.json({
        response:
          finalResponse || "I apologize, but I couldn't generate a response.",
        toolExecutions
      });
    } catch (error) {
      console.error("[CHAT] Error:", error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// Helper functions for password hashing
export async function hashPassword(password: string, salt: string) {
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

export function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, Array.from(array)));
}

async function verifyPassword(password: string, salt: string, hash: string) {
  const hashToVerify = await hashPassword(password, salt);
  if (hashToVerify === hash) return true;

  try {
    const decodedSaltBinaryString =
      typeof atob === "function"
        ? atob(salt)
        : Buffer.from(salt, "base64").toString("binary");
    const decodedSaltArray = new Uint8Array(
      Array.from(decodedSaltBinaryString).map((c: string) => c.charCodeAt(0))
    );

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
        salt: decodedSaltArray,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );
    const hashArray = Array.from(new Uint8Array(derivedBits));
    const altHash = btoa(String.fromCharCode.apply(null, hashArray));
    return altHash === hash;
  } catch (_e) {
    return false;
  }
}

// Auth routes
app.post("/api/auth/register", async (c) => {
  try {
    const { username, password } = await c.req.json();
    console.log("[AUTH] Register attempt for username:", username);

    if (!username || !password) {
      console.warn("[AUTH] Register failed - missing credentials");
      return c.json({ error: "Username and password are required" }, 400);
    }

    const existingUser = await c.env.APP_DB.prepare(
      "SELECT id FROM users WHERE username = ?"
    )
      .bind(username)
      .first();

    if (existingUser) {
      console.warn(
        "[AUTH] Register failed - username already taken:",
        username
      );
      return c.json({ error: "Username already taken" }, 409);
    }

    const salt = generateSalt();
    const password_hash = await hashPassword(password, salt);
    const id = crypto.randomUUID();
    console.log("[AUTH] Creating new user:", { id, username });

    await c.env.APP_DB.prepare(
      "INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)"
    )
      .bind(id, username, password_hash, salt)
      .run();

    console.log("[AUTH] User registered successfully:", { id, username });
    return c.json({ message: "User registered successfully" }, 201);
  } catch (error) {
    console.error("[AUTH] Registration error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

function logInvalidLoginAttempt(
  c: Context<{ Bindings: Env }>,
  reason: string,
  username?: string | null
) {
  try {
    const headers: Headers | undefined = c.req.raw.headers;

    const headerGet = (name: string) => {
      try {
        if (!headers) return undefined;
        return headers.get(name);
      } catch (_e) {
        return undefined;
      }
    };

    const ip =
      headerGet("cf-connecting-ip") ||
      headerGet("x-forwarded-for") ||
      headerGet("x-real-ip") ||
      "unknown";
    const ua = headerGet("user-agent") || "unknown";
    const timestamp = new Date().toISOString();
    const usernameDisplay = username ? username : "<unknown>";
    const logMsg = `[Auth] Invalid login attempt: reason=${reason} username=${usernameDisplay} ip=${ip} ua="${ua}" timestamp=${timestamp}`;
    console.warn(logMsg);
  } catch (e) {
    console.warn("[Auth] Failed to log invalid login attempt", e);
  }
}

app.post("/api/auth/login", async (c) => {
  try {
    const { username, password } = await c.req.json();
    console.log("[AUTH] Login attempt for username:", username);

    if (!username || !password) {
      console.warn("[AUTH] Login failed - missing credentials");
      logInvalidLoginAttempt(c, "missing_credentials", username || null);
      return c.json({ error: "Username and password are required" }, 400);
    }

    const user = await c.env.APP_DB.prepare(
      "SELECT * FROM users WHERE username = ?"
    )
      .bind(username)
      .first<{ id: string; password_hash: string; salt: string }>();

    if (!user) {
      console.warn("[AUTH] Login failed - user not found:", username);
      logInvalidLoginAttempt(c, "user_not_found", username);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const passwordIsValid = await verifyPassword(
      password,
      user.salt,
      user.password_hash
    );

    if (!passwordIsValid) {
      console.warn(
        "[AUTH] Login failed - invalid password for user:",
        username
      );
      logInvalidLoginAttempt(c, "invalid_password", username);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const sessionToken = generateSalt();
    const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const sessionId = crypto.randomUUID();
    const expiresAtMillis = expires_at.getTime();

    await c.env.APP_DB.prepare(
      "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
    )
      .bind(sessionId, user.id, sessionToken, expiresAtMillis)
      .run();

    setCookie(c, "session_token", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      expires: expires_at
    });

    console.log("[AUTH] Login successful for user:", {
      userId: user.id,
      username
    });
    return c.json({ message: "Logged in successfully" });
  } catch (error) {
    console.error("[AUTH] Login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/api/auth/logout", async (c) => {
  try {
    const sessionToken = getCookie(c, "session_token");
    console.log("[AUTH] Logout attempt");

    if (sessionToken) {
      console.log("[AUTH] Deleting session from database");
      await c.env.APP_DB.prepare("DELETE FROM sessions WHERE token = ?")
        .bind(sessionToken)
        .run();
    }

    deleteCookie(c, "session_token");
    console.log("[AUTH] Logout successful");

    return c.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("[AUTH] Logout error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/api/auth/me", async (c) => {
  try {
    const sessionToken = getCookie(c, "session_token");
    console.log("[AUTH] Fetching current user info");

    if (!sessionToken) {
      console.warn("[AUTH] No session token found");
      return c.json({ error: "Not authenticated" }, 401);
    }

    const session = await c.env.APP_DB.prepare(
      "SELECT * FROM sessions WHERE token = ?"
    )
      .bind(sessionToken)
      .first<{ user_id: string; expires_at: number }>();

    if (!session || new Date(session.expires_at) < new Date()) {
      console.warn("[AUTH] Invalid or expired session");
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
      console.warn("[AUTH] User not found for session:", session.user_id);
      return c.json({ error: "User not found" }, 404);
    }

    console.log("[AUTH] Current user fetched successfully:", {
      userId: user.id,
      username: user.username
    });
    return c.json(user);
  } catch (error) {
    console.error("[AUTH] Me endpoint error:", error);
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

// Middleware to extract user from session for agent requests
async function getUserFromSession(
  request: Request,
  env: Env
): Promise<{ id: string; username: string } | null> {
  try {
    const cookieHeader = request.headers.get("Cookie");
    if (!cookieHeader) {
      console.log("[MIDDLEWARE] No cookie header found");
      return null;
    }

    let sessionToken = cookieHeader
      .split(";")
      .find((c) => c.trim().startsWith("session_token="))
      ?.split("=")[1]
      ?.trim();

    if (!sessionToken) {
      console.log("[MIDDLEWARE] No session token in cookies");
      return null;
    }

    try {
      sessionToken = decodeURIComponent(sessionToken);
    } catch (e) {
      console.warn("[MIDDLEWARE] Failed to decode token:", e);
      return null;
    }

    const session = await env.APP_DB.prepare(
      "SELECT user_id, expires_at FROM sessions WHERE token = ?"
    )
      .bind(sessionToken)
      .first<{ user_id: string; expires_at: number }>();

    if (!session) {
      console.warn("[MIDDLEWARE] Session not found");
      return null;
    }

    const sessionExpired = (session.expires_at as number) < Date.now();
    if (sessionExpired) {
      console.warn("[MIDDLEWARE] Session expired");
      return null;
    }

    const user = await env.APP_DB.prepare(
      "SELECT id, username FROM users WHERE id = ?"
    )
      .bind(session.user_id)
      .first<{ id: string; username: string }>();

    if (user) {
      console.log("[MIDDLEWARE] User authenticated:", user.username);
    }
    return user || null;
  } catch (error) {
    console.error("[MIDDLEWARE] Error getting user from session:", error);
    return null;
  }
}

// Fallback route for agent requests
app.all("*", async (c) => {
  const path = c.req.path;
  console.log("[ROUTER] Incoming request:", { method: c.req.method, path });

  // Get user from session
  const user = await getUserFromSession(c.req.raw, c.env);

  if (!user) {
    if (path.includes("/agents/")) {
      console.warn("[ROUTER] Agent request without authentication");
      return c.json({ error: "Authentication required" }, 401);
    }
  }

  if (user) {
    console.log("[ROUTER] User authenticated:", user.username);
  }

  // Store user in custom headers for the agent
  const requestWithUser = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: new Headers(c.req.raw.headers),
    body: c.req.raw.body
  });

  if (user) {
    requestWithUser.headers.set("X-User-Id", user.id);
    requestWithUser.headers.set("X-Username", user.username);
  }

  console.log("[ROUTER] Routing request to agent handler");
  const response = await routeAgentRequest(requestWithUser, c.env);

  if (!response) {
    console.warn("[ROUTER] No response from agent, returning 404");
    return new Response("Not found", { status: 404 });
  }

  console.log("[ROUTER] Request handled successfully");
  return response;
});

export default app;
