import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Input } from "@/components/input/Input";
import { Label } from "@/components/label/Label";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { login, register } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isRegistering) {
        await register(username, password);
        // Automatically log in after successful registration
        await login(username, password);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-neutral-100 dark:bg-neutral-900">
      <Card className="w-full max-w-sm p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">
            {isRegistering ? "Register" : "Welcome Back"}
          </h1>
          <p className="text-muted-foreground">
            {isRegistering
              ? "Create an account to get started"
              : "Sign in to continue"}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button type="submit" className="w-full">
            {isRegistering ? "Register" : "Login"}
          </Button>
        </form>
        <div className="text-center">
          <button
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-sm text-blue-500 hover:underline"
          >
            {isRegistering
              ? "Already have an account? Login"
              : "Don't have an account? Register"}
          </button>
        </div>
      </Card>
    </div>
  );
}
