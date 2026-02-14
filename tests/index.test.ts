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
      body: JSON.stringify({ username: "alice" })
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
    expect(warnSpy).toHaveBeenCalled();
    const callsFlatten = warnSpy.mock.calls
      .map((c: any) => c.join(" "))
      .join("\n");
    // It should include the logged reason and username but not the password
    expect(callsFlatten).toContain("missing_credentials");
    expect(callsFlatten).toContain("username=alice");
    expect(callsFlatten).not.toContain("password");

    warnSpy.mockRestore();
  });

  it("logs user not found on login", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Create users table to avoid D1 error in test environment
    await env.APP_DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, salt TEXT);"
    ).run();
    const request = new Request("http://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nonexistent", password: "fakepw" })
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(warnSpy).toHaveBeenCalled();
    const callsFlatten = warnSpy.mock.calls
      .map((c: any) => c.join(" "))
      .join("\n");
    expect(callsFlatten).toContain("user_not_found");
    expect(callsFlatten).toContain("username=nonexistent");
    // Ensure we don't log the plaintext password
    expect(callsFlatten).not.toContain("fakepw");

    warnSpy.mockRestore();
  });

  it("logs invalid password on login", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Create users table and insert a user with a known password hash
    await env.APP_DB.prepare(
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT, salt TEXT);"
    ).run();
    const salt = generateSalt();
    const passwordHash = await hashPassword("correctpw", salt);
    await env.APP_DB.prepare(
      "INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)"
    )
      .bind("user-bob", "bob", passwordHash, salt)
      .run();

    const request = new Request("http://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "wrongpw" })
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(warnSpy).toHaveBeenCalled();
    const callsFlatten = warnSpy.mock.calls
      .map((c: any) => c.join(" "))
      .join("\n");
    expect(callsFlatten).toContain("invalid_password");
    expect(callsFlatten).toContain("username=bob");
    expect(callsFlatten).not.toContain("wrongpw");

    warnSpy.mockRestore();
  });

  describe("Manager approval tools", () => {
    it("get_request_status returns PTO request for owner", async () => {
      // ensure tables
      await env.APP_DB.prepare(
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, role TEXT, manager_id TEXT);"
      ).run();
      await env.APP_DB.prepare(
        `CREATE TABLE IF NOT EXISTS pto_requests (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          manager_id TEXT,
          start_date TEXT,
          end_date TEXT,
          total_days REAL,
          reason TEXT,
          status TEXT,
          created_at INTEGER
        )`
      ).run();

      // insert user + pto
      await env.APP_DB.prepare(
        "INSERT INTO users (id, username, role) VALUES (?, ?, ?)"
      )
        .bind("emp-1", "alice", "employee")
        .run();

      const now = Math.floor(Date.now() / 1000);
      await env.APP_DB.prepare(
        "INSERT INTO pto_requests (id, employee_id, start_date, end_date, total_days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind("pto-1", "emp-1", "2026-02-20", "2026-02-22", 3, "vacation", "pending", now)
        .run();

      const { get_request_status } = (await import("../src/tools")).tools as any;
      const res = await get_request_status.execute({ request_id: "pto-1" }, { env, userId: "emp-1" });
      expect(res.requests.length).toBe(1);
      expect(res.requests[0].status).toBe("pending");
    });

    it("list_pending_escalations returns pending items for manager", async () => {
      // ensure tables
      await env.APP_DB.prepare(
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, role TEXT, manager_id TEXT);"
      ).run();
      await env.APP_DB.prepare(
        `CREATE TABLE IF NOT EXISTS pto_requests (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          manager_id TEXT,
          start_date TEXT,
          end_date TEXT,
          total_days REAL,
          reason TEXT,
          status TEXT,
          escalation_reason TEXT,
          created_at INTEGER
        )`
      ).run();

      // Also create a minimal expense_requests table since list_pending_escalations queries it
      await env.APP_DB.prepare(
        `CREATE TABLE IF NOT EXISTS expense_requests (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          manager_id TEXT,
          category TEXT,
          amount REAL,
          currency TEXT,
          description TEXT,
          status TEXT,
          escalation_reason TEXT,
          created_at INTEGER
        )`
      ).run();

      // insert manager and employee
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO users (id, username, role) VALUES (?, ?, ?)"
      )
        .bind("mgr-1", "manager", "manager")
        .run();
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO users (id, username, role, manager_id) VALUES (?, ?, ?, ?)"
      )
        .bind("emp-2", "bob", "employee", "mgr-1")
        .run();

      const now = Math.floor(Date.now() / 1000);
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO pto_requests (id, employee_id, manager_id, start_date, end_date, total_days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind("pto-2", "emp-2", "mgr-1", "2026-03-01", "2026-03-02", 2, "conference", "pending", now)
        .run();

      const { list_pending_escalations } = (await import("../src/tools")).tools as any;
      const res = await list_pending_escalations.execute({}, { env, userId: "mgr-1" });
      expect(res.pto_pending.length).toBeGreaterThanOrEqual(1);
      expect(res.pto_pending[0].employee_name).toBe("bob");
    });

    it("escalate_request updates status and assigns manager", async () => {
      // ensure tables
      await env.APP_DB.prepare(
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, role TEXT, manager_id TEXT);"
      ).run();
      await env.APP_DB.prepare(
        `CREATE TABLE IF NOT EXISTS pto_requests (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          manager_id TEXT,
          start_date TEXT,
          end_date TEXT,
          total_days REAL,
          reason TEXT,
          status TEXT,
          created_at INTEGER,
          escalation_reason TEXT
        )`
      ).run();

      // Ensure audit_log exists for tools that log audit events
      await env.APP_DB.prepare(
        `CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT NOT NULL DEFAULT 'user',
          details TEXT,
          created_at INTEGER
        )`
      ).run();

      // insert manager and employee
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO users (id, username, role, manager_id) VALUES (?, ?, ?, ?)"
      )
        .bind("mgr-2", "manager2", "manager", null)
        .run();
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO users (id, username, role, manager_id) VALUES (?, ?, ?, ?)"
      )
        .bind("emp-3", "charlie", "employee", "mgr-2")
        .run();

      const now = Math.floor(Date.now() / 1000);
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO pto_requests (id, employee_id, manager_id, start_date, end_date, total_days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind("pto-3", "emp-3", null, "2026-04-01", "2026-04-03", 3, "family", "pending", now)
        .run();

      const { escalate_request } = (await import("../src/tools")).tools as any;

      // Mock Chat Durable Object in test env to avoid hitting DO storage during unit tests
      // The mock provides idFromName() and get().fetch() used by escalate_request
      (env as any).Chat = {
        idFromName: (name: string) => name,
        get: (_id: string) => ({ fetch: async () => new Response(null, { status: 200 }) })
      };

      const res = await escalate_request.execute({ request_id: "pto-3", request_type: "pto", escalation_reason: "Blackout overlap" }, { env, userId: "emp-3" });

      // Clean up mock
      delete (env as any).Chat;
      expect(res.success).toBe(true);
      expect(res.manager_id).toBe("mgr-2");

      const updated = await env.APP_DB.prepare("SELECT * FROM pto_requests WHERE id = ?").bind("pto-3").first<any>();
      expect(updated.status).toBe("pending");
      expect(updated.escalation_reason).toBe("Blackout overlap");
    });

    it("escalate_request falls back to most-recent request when id missing", async () => {
      // ensure tables
      await env.APP_DB.prepare(
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, role TEXT, manager_id TEXT);"
      ).run();
      await env.APP_DB.prepare(
        `CREATE TABLE IF NOT EXISTS pto_requests (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          manager_id TEXT,
          start_date TEXT,
          end_date TEXT,
          total_days REAL,
          reason TEXT,
          status TEXT,
          created_at INTEGER,
          escalation_reason TEXT
        )`
      ).run();

      // Ensure audit_log exists for tools that log audit events
      await env.APP_DB.prepare(
        `CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT NOT NULL DEFAULT 'user',
          details TEXT,
          created_at INTEGER
        )`
      ).run();

      // insert manager and employee + a PTO request
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO users (id, username, role, manager_id) VALUES (?, ?, ?, ?)"
      )
        .bind("mgr-3", "manager3", "manager", null)
        .run();
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO users (id, username, role, manager_id) VALUES (?, ?, ?, ?)"
      )
        .bind("emp-4", "dana", "employee", "mgr-3")
        .run();

      const now = Math.floor(Date.now() / 1000);
      await env.APP_DB.prepare(
        "INSERT OR REPLACE INTO pto_requests (id, employee_id, manager_id, start_date, end_date, total_days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind("pto-4", "emp-4", null, "2026-05-01", "2026-05-02", 2, "training", "pending", now)
        .run();

      const { escalate_request } = (await import("../src/tools")).tools as any;

      // Mock Chat Durable Object to avoid touching real DO storage in tests
      (env as any).Chat = {
        idFromName: (name: string) => name,
        get: (_id: string) => ({ fetch: async () => new Response(null, { status: 200 }) })
      };

      const res = await escalate_request.execute({ request_id: "nonexistent-id", request_type: "pto", escalation_reason: "Please review" }, { env, userId: "emp-4" });

      // Clean up mock
      delete (env as any).Chat;
      expect(res.success).toBe(true);
      expect(res.message).toContain("fallback to request pto-4");

      const updated = await env.APP_DB.prepare("SELECT * FROM pto_requests WHERE id = ?").bind("pto-4").first<any>();
      expect(updated.status).toBe("pending");
      expect(updated.escalation_reason).toBe("Please review");
    });
  });
});
