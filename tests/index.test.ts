import {
  env,
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
// Could import any other source file/function here
import worker, { hashPassword, generateSalt } from "../src/server";

declare module "cloudflare:test" {
  // Controls the type of `import("cloudflare:test").env`
  interface ProvidedEnv extends Env {}
}

describe("Chat worker", () => {
  it("responds with Not found", async () => {
    const request = new Request("http://example.com");
    // Create an empty context to pass to `worker.fetch()`
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toBe("Not found");
    expect(response.status).toBe(404);
  });

  it("logs missing credentials on login", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const request = new Request("http://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice" }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
    expect(warnSpy).toHaveBeenCalled();
    const callsFlatten = warnSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    // It should include the logged reason and username but not the password
    expect(callsFlatten).toContain("missing_credentials");
    expect(callsFlatten).toContain("username=alice");
    expect(callsFlatten).not.toContain("password");

    warnSpy.mockRestore();
  });

  it("logs user not found on login", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Create users table to avoid D1 error in test environment
    await env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, salt TEXT);").run();
    const request = new Request("http://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nonexistent", password: "fakepw" }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(warnSpy).toHaveBeenCalled();
    const callsFlatten = warnSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    expect(callsFlatten).toContain("user_not_found");
    expect(callsFlatten).toContain("username=nonexistent");
    // Ensure we don't log the plaintext password
    expect(callsFlatten).not.toContain("fakepw");

    warnSpy.mockRestore();
  });

  it("logs invalid password on login", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Create users table and insert a user with a known password hash
    await env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, salt TEXT);").run();
    const salt = generateSalt();
    const passwordHash = await hashPassword("correctpw", salt);
    await env.APP_DB.prepare("INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)").bind(
      "user-bob",
      "bob",
      passwordHash,
      salt
    ).run();

    const request = new Request("http://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "wrongpw" }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(warnSpy).toHaveBeenCalled();
    const callsFlatten = warnSpy.mock.calls.map((c: any) => c.join(" ")).join("\n");
    expect(callsFlatten).toContain("invalid_password");
    expect(callsFlatten).toContain("username=bob");
    expect(callsFlatten).not.toContain("wrongpw");

    warnSpy.mockRestore();
  });
});
