import { createContext, useContext } from "react";
import { useAuth } from "@/hooks/useAuth";

const AuthContext = createContext<ReturnType<typeof useAuth> | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  console.log("[PROVIDER] AuthProvider - Initializing");
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    console.error("[PROVIDER] AuthProvider - Context not found, must be used within AuthProvider");
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  console.log("[PROVIDER] useAuthContext - Context accessed");
  return context;
}
