import { useState } from "react";
import { useAuthContext } from "@/providers/AuthProvider";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Input } from "@/components/input/Input";
import { Label } from "@/components/label/Label";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const { login, register } = useAuthContext();
  const [isRegistering, setIsRegistering] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRegistrationSuccess(false); // Clear any previous success message
    try {
      if (isRegistering) {
        await register(username, password);
        setRegistrationSuccess(true);
        setIsRegistering(false); // Switch to login form
        setUsername(""); // Clear form
        setPassword(""); // Clear form
      } else {
        await login(username, password);
      }
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-950 px-6">
      <Card className="w-full max-w-md p-8 space-y-6 rounded-2xl shadow-lg">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-center h-14 w-14 rounded-full bg-[#F48120]/10 text-[#F48120]">
            <svg width="26" height="26" viewBox="0 0 80 79" aria-hidden>
              <path fill="currentColor" d="M69.3 39.7c-3.1 0-5.8 2.1-6.7 5H48.3V34h4.6l4.5-2.5c1.1.8 2.5 1.2 3.9 1.2 3.8 0 7-3.1 7-7s-3.1-7-7-7-7 3.1-7 7c0 .9.2 1.8.5 2.6L51.9 30h-3.5V18.8h-.1c-1.3-1-2.9-1.6-4.5-1.9h-.2c-1.9-.3-3.9-.1-5.8.6-.4.1-.8.3-1.2.5h-.1c-.1.1-.2.1-.3.2-1.7 1-3 2.4-4 4 0 .1-.1.2-.1.2l-.3.6c0 .1-.1.1-.1.2v.1h-.6c-2.9 0-5.7 1.2-7.7 3.2-2.1 2-3.2 4.8-3.2 7.7 0 .7.1 1.4.2 2.1-1.3.9-2.4 2.1-3.2 3.5s-1.2 2.9-1.4 4.5c-.1 1.6.1 3.2.7 4.7s1.5 2.9 2.6 4c-.8 1.8-1.2 3.7-1.1 5.6 0 1.9.5 3.8 1.4 5.6s2.1 3.2 3.6 4.4c1.3 1 2.7 1.7 4.3 2.2v-.1q2.25.75 4.8.6h.1c0 .1.1.1.1.1.9 1.7 2.3 3 4 4 .1.1.2.1.3.2h.1c.4.2.8.4 1.2.5 1.4.6 3 .8 4.5.7.4 0 .8-.1 1.3-.1h.1c1.6-.3 3.1-.9 4.5-1.9V62.9h3.5l3.1 1.7c-.3.8-.5 1.7-.5 2.6 0 3.8 3.1 7 7 7s7-3.1 7-7-3.1-7-7-7c-1.5 0-2.8.5-3.9 1.2l-4.6-2.5h-4.6V48.7h14.3c.9 2.9 3.5 5 6.7 5 3.8 0 7-3.1 7-7s-3.1-7-7-7m-7.9-16.9c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3m0 41.4c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3M44.3 72c-.4.2-.7.3-1.1.3-.2 0-.4.1-.5.1h-.2c-.9.1-1.7 0-2.6-.3-1-.3-1.9-.9-2.7-1.7-.7-.8-1.3-1.7-1.6-2.7l-.3-1.5v-.7q0-.75.3-1.5c.1-.2.1-.4.2-.7s.3-.6.5-.9c0-.1.1-.1.1-.2.1-.1.1-.2.2-.3s.1-.2.2-.3c0 0 0-.1.1-.1l.6-.6-2.7-3.5c-1.3 1.1-2.3 2.4-2.9 3.9-.2.4-.4.9-.5 1.3v.1c-.1.2-.1.4-.1.6-.3 1.1-.4 2.3-.3 3.4-.3 0-.7 0-1-.1-2.2-.4-4.2-1.5-5.5-3.2-1.4-1.7-2-3.9-1.8-6.1q.15-1.2.6-2.4l.3-.6c.1-.2.2-.4.3-.5 0 0 0-.1.1-.1.4-.7.9-1.3 1.5-1.9 1.6-1.5 3.8-2.3 6-2.3q1.05 0 2.1.3v-4.5c-.7-.1-1.4-.2-2.1-.2-1.8 0-3.5.4-5.2 1.1-.7.3-1.3.6-1.9 1s-1.1.8-1.7 1.3c-.3.2-.5.5-.8.8-.6-.8-1-1.6-1.3-2.6-.2-1-.2-2 0-2.9.2-1 .6-1.9 1.3-2.6.6-.8 1.4-1.4 2.3-1.8l1.8-.9-.7-1.9c-.4-1-.5-2.1-.4-3.1s.5-2.1 1.1-2.9q.9-1.35 2.4-2.1c.9-.5 2-.8 3-.7.5 0 1 .1 1.5.2 1 .2 1.8.7 2.6 1.3s1.4 1.4 1.8 2.3l4.1-1.5c-.9-2-2.3-3.7-4.2-4.9q-.6-.3-.9-.6c.4-.7 1-1.4 1.6-1.9.8-.7 1.8-1.1 2.9-1.3.9-.2 1.7-.1 2.6 0 .4.1.7.2 1.1.3V72zm25-22.3c-1.6 0-3-1.3-3-3 0-1.6 1.3-3 3-3s3 1.3 3 3c0 1.6-1.3 3-3 3"/>
            </svg>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold leading-tight text-neutral-900 dark:text-white">ApprovalFlow AI</h1>
          <p className="text-sm md:text-base text-muted-foreground text-center max-w-prose">Get your expenses reimbursed & PTOs approved in seconds</p>
        </div>

        {registrationSuccess && (
          <div className="rounded-md bg-green-50 p-2 text-green-700 text-sm text-center">
            Registration successful! You can now log in.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="mx-auto w-full max-w-sm space-y-4">
            <div>
              <Label htmlFor="username" title={""}>Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="mt-2 rounded-lg px-4 py-3 border border-neutral-200 bg-white dark:bg-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F48120]/20 w-full"
                placeholder="your.username" onValueChange={undefined}              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password" title={""}>Password</Label>
                {!isRegistering && null}
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-2 rounded-lg px-4 py-3 border border-neutral-200 bg-white dark:bg-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F48120]/20 w-full"
                placeholder="••••••••" onValueChange={undefined}              />
            </div>

            {error && <p className="text-red-600 text-sm text-center">{error}</p>}

            <Button
              type="submit"
              variant="primary"
              className="w-full py-3 rounded-lg justify-center text-center brand-btn"
            >
              {isRegistering ? "Create account" : "Sign in"}
            </Button>
          </div>
        </form>

        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="text-neutral-500">{isRegistering ? "Already have an account?" : "New here?"}</span>
          <button
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError(null);
              setRegistrationSuccess(false);
            }}
            className="text-sm font-medium text-primary hover:underline"
          >
            {isRegistering ? "Sign in" : "Create an account"}
          </button>
        </div>
      </Card>
    </div>
  );
}
