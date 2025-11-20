import { routeAgentRequest, type Schedule } from "agents";
import { AIChatAgent } from "agents/ai-chat-agent";
import {
  type DynamicToolCall,
  type DynamicToolResult,
  type FinishReason,
  type GeneratedFile,
  generateId,
  type LanguageModelRequestMetadata,
  type LanguageModelUsage,
  type StaticToolCall,
  type StaticToolResult,
  type StepResult,
  type StreamTextOnFinishCallback,
  type TextUIPart,
  type ToolSet,
  type TypedToolCall,
  type TypedToolResult,
  type UIMessage
} from "ai";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";

function createFinishEvent(responseText: string) {
  const now = new Date();
  const baseStep: StepResult<ToolSet> = {
    content: [],
    text: responseText,
    reasoning: [],
    reasoningText: undefined,
    files: [] as GeneratedFile[],
    sources: [],
    toolCalls: [] as TypedToolCall<ToolSet>[],
    staticToolCalls: [] as StaticToolCall<ToolSet>[],
    dynamicToolCalls: [] as DynamicToolCall[],
    toolResults: [] as TypedToolResult<ToolSet>[],
    staticToolResults: [] as StaticToolResult<ToolSet>[],
    dynamicToolResults: [] as DynamicToolResult[],
    finishReason: "stop" as FinishReason,
    usage: ZERO_USAGE,
    warnings: undefined,
    request: {} as LanguageModelRequestMetadata,
    response: {
      id: generateId(),
      timestamp: now,
      modelId: "approvalflow",
      messages: []
    },
    providerMetadata: undefined
  };

  return {
    ...baseStep,
    steps: [baseStep],
    totalUsage: ZERO_USAGE
  } satisfies StepResult<ToolSet> & {
    steps: StepResult<ToolSet>[];
    totalUsage: LanguageModelUsage;
  };
}

import { runReActAgent } from "./react-agent";
import type { ToolContext } from "./tools";

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0
};

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 * using the ReAct (Reasoning + Acting) framework
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Override fetch to capture user ID from headers and persist it
   */
  async fetch(request: Request) {
    console.log("[CHAT] fetch() called");
    console.log("[CHAT] Request URL:", request.url);
    console.log("[CHAT] Request method:", request.method);

    // Extract user ID from headers set by middleware
    const userId = request.headers.get("X-User-Id");
    const username = request.headers.get("X-Username");
    console.log(
      "[CHAT] Headers: X-User-Id =",
      userId,
      ", X-Username =",
      username
    );

    // Persist userId in Durable Object storage so it survives across messages
    if (userId) {
      await this.ctx.storage.put("userId", userId);
      console.log("[CHAT] userId persisted to storage:", userId);
    }

    return super.fetch(request);
  }

  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ): Promise<Response | undefined> {
    const finishStream = (text: string) => {
      const event = createFinishEvent(text);
      onFinish(event);
      return event;
    };

    try {
      console.log("[AGENT] Processing chat message");
      console.log("[AGENT] this.messages length:", this.messages.length);
      console.log(
        "[AGENT] this.messages roles:",
        this.messages.map((m) => m.role)
      );

      // Get the user message (last message in the array)
      const userMessage = this.messages[this.messages.length - 1];
      if (
        !userMessage ||
        !userMessage.parts ||
        userMessage.parts.length === 0
      ) {
        console.warn("[AGENT] Empty user message received");
        finishStream("");
        // Save empty assistant message
        await this.saveMessages([
          ...this.messages,
          {
            id: generateId(),
            role: "assistant",
            parts: [{ type: "text", text: "" }],
            metadata: { createdAt: new Date().toISOString() }
          }
        ]);
        return;
      }

      // Safety check: only process user messages, not assistant responses
      if (userMessage.role !== "user") {
        console.log(
          "[AGENT] Last message is from",
          userMessage.role,
          "- skipping to prevent infinite loops"
        );
        console.log("[AGENT] Total messages:", this.messages.length);
        console.log(
          "[AGENT] Last 2 messages:",
          this.messages.slice(-2).map((m) => m.role)
        );
        finishStream("");
        return;
      }

      const isTextPart = (part: { type: string }): part is TextUIPart =>
        part.type === "text";

      // Extract text from the message
      const textPart = userMessage.parts.find(isTextPart);
      if (!textPart) {
        console.warn("[AGENT] No text part found in message");
        finishStream("");
        await this.saveMessages([
          ...this.messages,
          {
            id: generateId(),
            role: "assistant",
            parts: [{ type: "text", text: "" }],
            metadata: { createdAt: new Date().toISOString() }
          }
        ]);
        return;
      }

      console.log("[AGENT] User message:", textPart.text);

      // Retrieve userId from Durable Object storage (persisted in fetch())
      const userId = await this.ctx.storage.get<string>("userId");
      console.log("[AGENT] Retrieved userId from storage:", userId);

      // If userId not available, the user needs to refresh
      if (!userId) {
        console.error(
          "[AGENT] No userId available in storage - user needs to refresh the page"
        );
        const errorMsg = "Authentication required. Please refresh the page.";
        finishStream(errorMsg);
        await this.saveMessages([
          ...this.messages,
          {
            id: generateId(),
            role: "assistant",
            parts: [{ type: "text", text: errorMsg }],
            metadata: { createdAt: new Date().toISOString() }
          }
        ]);
        return;
      }

      // Build conversation history (exclude the current user message)
      const conversationHistory: Array<{
        role: UIMessage["role"];
        content: string;
      }> = this.messages.slice(0, -1).map((msg) => {
        const text = msg.parts.find(isTextPart)?.text || "";
        return {
          role: msg.role === "user" ? "user" : "assistant",
          content: text
        };
      });

      console.log(
        "[AGENT] Conversation history length:",
        conversationHistory.length
      );

      // Create tool context
      const toolContext: ToolContext = {
        env: this.env,
        userId: userId
      };

      // Track streamed tool calls
      const streamedToolCalls = new Map<
        string,
        {
          toolName: string;
          toolCallId: string;
          args: unknown;
          result?: unknown;
          state: string;
          error?: string;
        }
      >();

      // Create a single streaming message ID that will be updated
      // Use "assistant-" prefix so frontend renders tool cards (app.tsx line 432)
      const streamingMessageId = `assistant-${generateId()}`;

      // Run the ReAct agent with streaming callback
      console.log("[AGENT] Starting ReAct agent");
      const result = await runReActAgent(
        textPart.text,
        conversationHistory,
        toolContext,
        // Stream tool updates in real-time
        async (toolUpdate) => {
          console.log(
            "[AGENT] Streaming tool update:",
            toolUpdate.toolName,
            toolUpdate.state
          );

          // Update or add to tracked calls
          streamedToolCalls.set(toolUpdate.toolCallId, {
            toolName: toolUpdate.toolName,
            toolCallId: toolUpdate.toolCallId,
            args: toolUpdate.args,
            result: toolUpdate.result,
            state: toolUpdate.state,
            error: toolUpdate.error
          });

          // Build parts array with ALL tool calls so far
          const parts: any[] = [];

          // Add all tracked tool calls as parts
          for (const toolCall of streamedToolCalls.values()) {
            parts.push({
              type: `tool-${toolCall.toolName}` as const,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.args,
              output: toolCall.result,
              state: toolCall.state,
              errorText: toolCall.error
            });
          }

          // Update the SAME message with all parts
          const existingMessages = this.messages.filter(
            (m: any) => m.id !== streamingMessageId
          );

          await this.saveMessages([
            ...existingMessages,
            {
              id: streamingMessageId,
              role: "assistant",
              parts: parts as any,
              metadata: {
                createdAt: new Date().toISOString(),
                streaming: true
              }
            } as any
          ]);
        }
      );

      console.log(
        "[AGENT] ReAct agent completed with",
        result.steps.length,
        "steps"
      );
      console.log("[AGENT] Response text length:", result.response.length);
      console.log("[AGENT] Tool calls:", result.toolCalls?.length || 0);
      console.log(
        "[AGENT] ReAct Steps:",
        JSON.stringify(result.steps, null, 2)
      );

      // Build final message parts including tool calls and response
      const parts: any[] = [];

      // Add tool call parts first
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const toolCall of result.toolCalls) {
          console.log("[AGENT] Adding tool part:", toolCall.toolName);
          parts.push({
            type: `tool-${toolCall.toolName}` as const,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.args,
            output: toolCall.result,
            state: "output-available" as const
          });
        }
      }

      // Add text response
      parts.push({
        type: "text",
        text: result.response
      });

      // Replace the streaming message with final message
      const existingMessages = this.messages.filter(
        (m: any) => m.id !== streamingMessageId
      );

      await this.saveMessages([
        ...existingMessages,
        {
          id: streamingMessageId, // Reuse same ID to replace streaming message
          role: "assistant",
          parts: parts as any,
          metadata: {
            createdAt: new Date().toISOString(),
            streaming: false // Mark as complete
          }
        } as any
      ]);

      console.log(
        "[AGENT] Response saved with",
        parts.length,
        "parts and returning to client"
      );
      finishStream(result.response);
    } catch (error) {
      console.error("[AGENT] Error in onChatMessage:", error);
      const errorMsg =
        "I encountered an error processing your request. Please try again.";
      finishStream(errorMsg);
      await this.saveMessages([
        ...this.messages,
        {
          id: generateId(),
          role: "assistant",
          parts: [{ type: "text", text: errorMsg }],
          metadata: { createdAt: new Date().toISOString() }
        }
      ]);
    }
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
  // First, verify with the current behavior (salt is used as-is: ascii/base64 string encoded)
  const hashToVerify = await hashPassword(password, salt);
  if (hashToVerify === hash) return true;

  // If that fails, try interpreting 'salt' as a base64-encoded raw salt and use those bytes as the salt.
  try {
    const decodedSaltBinaryString =
      typeof atob === "function"
        ? atob(salt)
        : Buffer.from(salt, "base64").toString("binary");
    const decodedSaltArray = new Uint8Array(
      Array.from(decodedSaltBinaryString).map((c: string) => c.charCodeAt(0))
    );

    // Hash using raw salt bytes
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
    // If anything goes wrong (atob not available, invalid base64) just return false
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

    // Check if user already exists
    console.log("[AUTH] Checking if user already exists:", username);
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

// Helper to log invalid login attempts without exposing sensitive info
function logInvalidLoginAttempt(
  c: Context<{ Bindings: Env }>,
  reason: string,
  username?: string | null
) {
  try {
    // Hono context may wrap headers differently in tests/edge runtimes; accept multiple fallbacks
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
    // Don't log the password or any secrets
    const usernameDisplay = username ? username : "<unknown>";
    const logMsg = `[Auth] Invalid login attempt: reason=${reason} username=${usernameDisplay} ip=${ip} ua="${ua}" timestamp=${timestamp}`;
    console.warn(logMsg);
  } catch (e) {
    // Swallow errors from logging to avoid affecting the auth flow
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
      // Log user not found without revealing password
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
      // Log invalid password attempts but avoid logging the password itself
      console.warn(
        "[AUTH] Login failed - invalid password for user:",
        username
      );
      logInvalidLoginAttempt(c, "invalid_password", username);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const sessionToken = generateSalt(); // Re-using salt generation for a random token
    const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
    const sessionId = crypto.randomUUID();
    const expiresAtMillis = expires_at.getTime();
    console.log("[AUTH] Creating session for user:", {
      userId: user.id,
      sessionId,
      expiresAtISO: expires_at.toISOString(),
      expiresAtMillis,
      nowMillis: Date.now(),
      tokenLength: sessionToken.length,
      tokenFirstChars: sessionToken.substring(0, 10)
    });

    await c.env.APP_DB.prepare(
      "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
    )
      .bind(sessionId, user.id, sessionToken, expiresAtMillis)
      .run();

    console.log("[AUTH] Session inserted into database:", {
      sessionId,
      tokenLength: sessionToken.length,
      tokenFirstChars: sessionToken.substring(0, 10)
    });

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
      // Clean up expired cookie
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
    // Extract session token from cookie header
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
      console.log(
        "[MIDDLEWARE] No session token in cookies. Cookies:",
        cookieHeader
      );
      return null;
    }

    // Decode URL-encoded token
    try {
      sessionToken = decodeURIComponent(sessionToken);
    } catch (e) {
      console.warn("[MIDDLEWARE] Failed to decode token:", e);
      return null;
    }

    console.log(
      "[MIDDLEWARE] Found session token, decoded length:",
      sessionToken.length,
      "decoded first 10 chars:",
      sessionToken.substring(0, 10),
      "looking up session"
    );

    // Get session from database
    console.log(
      "[MIDDLEWARE] Querying database for token (first 10 chars):",
      sessionToken.substring(0, 10)
    );
    const session = await env.APP_DB.prepare(
      "SELECT user_id, expires_at FROM sessions WHERE token = ?"
    )
      .bind(sessionToken)
      .first<{ user_id: string; expires_at: number }>();

    console.log("[MIDDLEWARE] Session lookup result:", {
      found: !!session,
      expiresAt: session?.expires_at,
      now: Date.now(),
      tokenSearched: sessionToken.substring(0, 10)
    });

    if (!session) {
      console.warn("[MIDDLEWARE] Session not found");
      return null;
    }

    // expires_at is stored as milliseconds (Integer), compare directly
    const sessionExpired = (session.expires_at as number) < Date.now();
    if (sessionExpired) {
      console.warn("[MIDDLEWARE] Session expired:", {
        expiresAt: session.expires_at,
        now: Date.now()
      });
      return null;
    }
    console.log("[MIDDLEWARE] Session is valid");

    console.log(
      "[MIDDLEWARE] Session found, looking up user:",
      session.user_id
    );

    // Get user
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

// Receipt upload endpoint
app.post("/api/receipts/upload", async (c) => {
  try {
    console.log("[RECEIPT] Receipt upload request received");

    // Get user from session
    const user = await getUserFromSession(c.req.raw, c.env);
    if (!user) {
      console.warn("[RECEIPT] Unauthorized upload attempt");
      return c.json({ error: "Authentication required" }, 401);
    }

    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get("receipt") as File;
    const expenseRequestId = formData.get("expense_request_id") as string;

    if (!file) {
      console.warn("[RECEIPT] No file provided");
      return c.json({ error: "Receipt file is required" }, 400);
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf"
    ];
    if (!allowedTypes.includes(file.type)) {
      console.warn("[RECEIPT] Invalid file type:", file.type);
      return c.json(
        {
          error: `Invalid file type. Allowed types: ${allowedTypes.join(", ")}`
        },
        400
      );
    }

    // Validate file size (5MB limit for MVP)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      console.warn("[RECEIPT] File too large:", file.size);
      return c.json(
        {
          error: `File size exceeds maximum of ${maxSize / 1024 / 1024}MB`
        },
        400
      );
    }

    console.log("[RECEIPT] Processing file:", {
      name: file.name,
      type: file.type,
      size: file.size,
      user: user.username
    });

    // Read file as buffer and convert to base64
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    // Convert to base64 in chunks to avoid call stack size exceeded
    let base64Data = "";
    const chunkSize = 0x8000; // 32KB chunks
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      base64Data += String.fromCharCode(...chunk);
    }
    base64Data = btoa(base64Data);

    // Generate receipt ID
    const receiptId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    // Create expense request if not provided
    let finalExpenseRequestId = expenseRequestId;
    if (!finalExpenseRequestId) {
      finalExpenseRequestId = crypto.randomUUID();
      console.log(
        "[RECEIPT] Creating placeholder expense request:",
        finalExpenseRequestId
      );

      await c.env.APP_DB.prepare(
        `
        INSERT INTO expense_requests (
          id, employee_id, category, amount, currency, description, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
        .bind(
          finalExpenseRequestId,
          user.id,
          "pending_receipt_processing",
          0,
          "USD",
          "Receipt uploaded, pending OCR processing",
          "pending"
        )
        .run();
    }

    // Insert receipt record
    console.log("[RECEIPT] Storing receipt in database:", receiptId);
    await c.env.APP_DB.prepare(
      `
      INSERT INTO receipt_uploads (
        id, expense_request_id, file_name, file_type, file_size,
        file_data, upload_date, ocr_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        receiptId,
        finalExpenseRequestId,
        file.name,
        file.type,
        file.size,
        base64Data,
        now,
        "pending"
      )
      .run();

    console.log("[RECEIPT] Receipt stored successfully:", receiptId);

    // Process OCR using Workers AI Vision
    let ocrResult = null;
    let ocrStatus = "pending";
    let processingErrors = null;

    try {
      console.log("[RECEIPT] Processing OCR with Workers AI Vision");

      // Use @cf/llava-hf/llava-1.5-7b-hf model for image understanding
      const ocrPrompt = `You are a receipt data extraction expert. Analyze this receipt image and extract the following information in JSON format:
{
  "amount": <total amount as a number>,
  "currency": "<currency code like USD, EUR, etc.>",
  "date": "<date in YYYY-MM-DD format>",
  "merchant": "<merchant/vendor name>",
  "items": [
    {"description": "<item name>", "amount": <item price>}
  ]
}

Only return valid JSON. If you cannot extract a field, use null. Focus on the total amount at the bottom of the receipt.`;

      // Prepare image data in the correct format for Workers AI
      // The model expects image as an array of Uint8Array
      const aiResponse = await c.env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
        prompt: ocrPrompt,
        image: Array.from(uint8Array),
        max_tokens: 512
      });

      console.log("[RECEIPT] AI Response:", aiResponse);

      // Parse the response
      if (aiResponse && aiResponse.description) {
        // Try to extract JSON from the response
        const jsonMatch = aiResponse.description.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          ocrResult = JSON.parse(jsonMatch[0]);
          ocrStatus = "completed";
          console.log("[RECEIPT] OCR extraction successful:", ocrResult);
        } else {
          throw new Error("No JSON found in AI response");
        }
      } else {
        throw new Error("Invalid AI response format");
      }

      // Update receipt with extracted data
      await c.env.APP_DB.prepare(
        `
        UPDATE receipt_uploads
        SET ocr_status = ?, extracted_data = ?
        WHERE id = ?
      `
      )
        .bind(ocrStatus, JSON.stringify(ocrResult), receiptId)
        .run();
    } catch (error) {
      console.error("[RECEIPT] OCR processing error:", error);
      processingErrors =
        error instanceof Error ? error.message : "OCR processing failed";
      ocrStatus = "failed";

      // Update receipt with error status
      await c.env.APP_DB.prepare(
        `
        UPDATE receipt_uploads
        SET ocr_status = ?, processing_errors = ?
        WHERE id = ?
      `
      )
        .bind(ocrStatus, processingErrors, receiptId)
        .run();
    }

    return c.json({
      success: true,
      receipt_id: receiptId,
      expense_request_id: finalExpenseRequestId,
      message:
        ocrStatus === "completed"
          ? "Receipt uploaded and processed successfully!"
          : "Receipt uploaded but OCR processing failed. You can manually enter the details.",
      file_name: file.name,
      file_size: file.size,
      ocr_status: ocrStatus,
      extracted_data: ocrResult,
      processing_errors: processingErrors
    });
  } catch (error) {
    console.error("[RECEIPT] Upload error:", error);
    return c.json({ error: "Failed to upload receipt" }, 500);
  }
});

// Get receipt by ID
app.get("/api/receipts/:id", async (c) => {
  try {
    const receiptId = c.req.param("id");
    console.log("[RECEIPT] Fetching receipt:", receiptId);

    // Get user from session
    const user = await getUserFromSession(c.req.raw, c.env);
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const receipt = await c.env.APP_DB.prepare(
      `
      SELECT r.*, e.employee_id
      FROM receipt_uploads r
      JOIN expense_requests e ON r.expense_request_id = e.id
      WHERE r.id = ?
    `
    )
      .bind(receiptId)
      .first<{
        id: string;
        expense_request_id: string;
        file_name: string;
        file_type: string;
        file_size: number;
        file_data: string;
        ocr_status: string;
        extracted_data: string | null;
        processing_errors: string | null;
        employee_id: string;
      }>();

    if (!receipt) {
      console.warn("[RECEIPT] Receipt not found:", receiptId);
      return c.json({ error: "Receipt not found" }, 404);
    }

    // Check authorization - only owner can view
    if (receipt.employee_id !== user.id) {
      console.warn("[RECEIPT] Unauthorized access attempt:", {
        receiptId,
        userId: user.id,
        ownerId: receipt.employee_id
      });
      return c.json({ error: "Unauthorized" }, 403);
    }

    return c.json({
      id: receipt.id,
      expense_request_id: receipt.expense_request_id,
      file_name: receipt.file_name,
      file_type: receipt.file_type,
      file_size: receipt.file_size,
      ocr_status: receipt.ocr_status,
      extracted_data: receipt.extracted_data
        ? JSON.parse(receipt.extracted_data)
        : null,
      processing_errors: receipt.processing_errors
    });
  } catch (error) {
    console.error("[RECEIPT] Fetch error:", error);
    return c.json({ error: "Failed to fetch receipt" }, 500);
  }
});

// Fallback route for agent requests
app.all("*", async (c) => {
  const path = c.req.path;
  console.log("[ROUTER] Incoming request:", { method: c.req.method, path });

  // Get user from session
  const user = await getUserFromSession(c.req.raw, c.env);

  if (!user) {
    // For agent routes, require authentication
    if (path.includes("/agents/")) {
      console.warn(
        "[ROUTER] Agent request without authentication for path:",
        path
      );
      return c.json({ error: "Authentication required" }, 401);
    }
  }

  if (user) {
    console.log("[ROUTER] User authenticated:", user.username);
  }

  // Store user in a custom header that the agent can read
  const requestWithUser = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: new Headers(c.req.raw.headers),
    body: c.req.raw.body
  });

  if (user) {
    requestWithUser.headers.set("X-User-Id", user.id);
    requestWithUser.headers.set("X-Username", user.username);
    console.log("[ROUTER] Added user headers to request");
  }

  console.log("[ROUTER] Routing request to agent handler");
  const response = await routeAgentRequest(requestWithUser, c.env);

  if (!response) {
    console.warn(
      "[ROUTER] No response from agent, returning 404 for path:",
      path
    );
    return new Response("Not found", { status: 404 });
  }

  console.log("[ROUTER] Request handled successfully");
  return response;
});

app.get("/api/debug/sessions", async (c) => {
  try {
    const sessions = await c.env.APP_DB.prepare(
      "SELECT id, user_id, token, expires_at FROM sessions LIMIT 5"
    ).all<{ id: string; user_id: string; token: string; expires_at: number }>();

    console.log("[DEBUG] Sessions in database:", sessions.results?.length || 0);

    const sessionData =
      sessions.results?.map((s) => ({
        id: s.id,
        user_id: s.user_id,
        tokenLength: s.token.length,
        tokenFirstChars: s.token.substring(0, 10),
        expiresAt: s.expires_at,
        expiresAtDate: new Date(s.expires_at).toISOString()
      })) || [];

    return c.json({
      sessions: sessionData,
      now: Date.now(),
      nowISO: new Date().toISOString()
    });
  } catch (error) {
    console.error("[DEBUG] Error fetching sessions:", error);
    return c.json({ error: "Failed to fetch sessions" }, 500);
  }
});

app.post("/api/debug/clear-sessions", async (c) => {
  try {
    const result = await c.env.APP_DB.prepare("DELETE FROM sessions").run();
    console.log("[DEBUG] Cleared all sessions");
    return c.json({ deleted: result.meta.changes });
  } catch (error) {
    console.error("[DEBUG] Error clearing sessions:", error);
    return c.json({ error: "Failed to clear sessions" }, 500);
  }
});

export default app;
