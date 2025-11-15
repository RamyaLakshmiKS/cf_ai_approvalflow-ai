# MVP Plan: Password-based Authentication & Login Screen

## Goal
Implement a simple, secure password-based authentication system (register/login/logout/me) and a minimal login screen for the frontend. Persist users and credentials in D1. Provide clear API endpoints and a small integration plan so we can iterate quickly and safely.

## Principles
- Use D1 as the single source of truth for user records and sessions where possible.
- Store password-derived secrets using Web Crypto (PBKDF2 or equivalent) with a per-user salt; never store plaintext passwords.
- Use HTTP-only, Secure cookies for session tokens (avoid localStorage for tokens by default).
- Keep the first iteration small and auditable: registration, login, logout, protected `GET /api/auth/me`.

## Deliverables
- D1 schema/migration for `users` and `sessions` tables (SQL migration file to be added later).
- Cloudflare Worker endpoints:
  - `POST /api/auth/register` — create user (username/email + password), return 201.
  - `POST /api/auth/login` — verify credentials, set `__session` cookie, return user summary.
  - `POST /api/auth/logout` — clear session cookie and invalidate server session.
  - `GET /api/auth/me` — returns authenticated user's profile or 401.
- Frontend components/hooks:
  - `src/components/auth/Login.tsx` — Login form (email/username + password).
  - `src/components/auth/Register.tsx` (optional for MVP) — Register form.
  - `src/hooks/useAuth.ts` — client auth helper to call `/api/auth/*`, hold auth state.

## D1 Schema (suggested)
-- `users` table
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(random_bytes(16)))),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'employee',
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- `sessions` table (optional; you can also use JWTs)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(random_bytes(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

Note: If you prefer stateless JWTs, store a short-lived refresh token in `sessions` and sign JWTs using an env secret.

## Security Notes
- Use `crypto.subtle` (Web Crypto) in Workers to derive a password hash via PBKDF2 with 100k+ iterations or a recommended KDF supported by the runtime.
- Salt per user, stored in `users.salt`.
- Set cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=...`.
- Rate-limit login attempts (Workers-level or application-level) to mitigate brute force.
- Validate & sanitize input on all endpoints.

## Environment & Bindings (Worker)
- D1 binding: `APP_DB` (D1 database) — used by Worker to run migrations and queries.
- KV or Durable Object not required for MVP but may be used later for realtime sessions.
- Env variables:
  - `SESSION_SECRET` — used to sign or derive session tokens (do not commit).
  - `COOKIE_NAME` — optional, default `__session`.

## Frontend Integration Notes
- On successful login, Worker sets the `__session` cookie with a secure session token.
- Frontend `useAuth` fetches `GET /api/auth/me` to populate user state on app load.
- Provide a `logout()` that calls `POST /api/auth/logout` and clears client state.

## Minimal Acceptance Criteria
- Users can register with username and password (or a pre-seeded user exists for MVP).
- Users can log in and receive a session cookie.
- `GET /api/auth/me` returns authenticated user profile when session is valid.
- Invalid credentials or missing session return 401.

## API Examples (curl)
- Register (example):
```
curl -X POST https://example.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"s3cret"}'
```

- Login (example):
```
curl -i -X POST https://example.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"s3cret"}'
```

- Me (example):
```
curl -i -X GET https://example.com/api/auth/me \
  --cookie "__session=<token>"
```

## Timeline & Next Steps
1. Add this plan file to `docs/` (done).
2. Create D1 migration SQL and add to `migrations/` or repo root (1-2 hours).
3. Scaffold Worker `src/auth_worker.ts` with endpoints (2-4 hours).
4. Implement frontend `Login.tsx` + `useAuth` (1-2 hours).
5. Add simple tests & curl examples (1 hour).

Estimated total: 6-10 hours to reach a minimally usable auth MVP.

---
File created: `docs/auth_mvp_plan.md`
