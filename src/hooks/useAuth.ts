import { useCallback, useEffect, useState } from "react";

interface User {
  id: string;
  username: string;
  role: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");

  const fetchUser = useCallback(async () => {
    try {
      console.log("[HOOK] useAuth - Fetching current user");
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const userData = (await response.json()) as User;
        console.log("[HOOK] useAuth - User authenticated:", userData.username);
        setUser(userData);
        setStatus("authenticated");
      } else {
        console.log("[HOOK] useAuth - User not authenticated");
        setUser(null);
        setStatus("unauthenticated");
      }
    } catch (error) {
      console.error("[HOOK] useAuth - Failed to fetch user:", error);
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (username: string, password: string): Promise<void> => {
    console.log("[HOOK] useAuth - Login attempt for user:", username);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    if (response.ok) {
      console.log("[HOOK] useAuth - Login successful, fetching user");
      await fetchUser();
    } else {
      console.error(
        "[HOOK] useAuth - Login failed with status:",
        response.status
      );
      throw new Error("Login failed");
    }
  };

  const logout = async () => {
    console.log("[HOOK] useAuth - Logging out");
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setStatus("unauthenticated");
    console.log("[HOOK] useAuth - Logged out successfully");
  };

  const register = async (
    username: string,
    password: string
  ): Promise<void> => {
    console.log("[HOOK] useAuth - Registration attempt for user:", username);
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      console.error(
        "[HOOK] useAuth - Registration failed with status:",
        response.status
      );
      throw new Error("Registration failed");
    }
    console.log("[HOOK] useAuth - Registration successful");
  };

  return { user, status, login, logout, register };
}
