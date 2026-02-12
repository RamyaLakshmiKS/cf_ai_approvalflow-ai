/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */

import type { UIMessage } from "@ai-sdk/react";
import { useAgentChat } from "agents/ai-react";
import { useAgent } from "agents/react";
import { isToolUIPart } from "ai";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { Login } from "@/components/auth/Login";
import { Avatar } from "@/components/avatar/Avatar";
// Component imports
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { DropdownMenu } from "@/components/dropdown/DropdownMenu";
import { Loader } from "@/components/loader/Loader";
import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { Textarea } from "@/components/textarea/Textarea";
import { Toggle } from "@/components/toggle/Toggle";
import { ToolInvocationCard } from "@/components/tool-invocation-card/ToolInvocationCard";
import { VoiceRecorder } from "@/components/input/VoiceRecorder";
import { ExpenseSubmissionDialog } from "@/components/expense/ExpenseSubmissionDialog";
import { useAuthContext } from "@/providers/AuthProvider";
import type { tools } from "./tools";
// Icon imports
import {
  Bug,
  Moon,
  PaperPlaneTilt,
  Robot,
  SignOut,
  Stop,
  Sun,
  Trash,
  User
} from "@phosphor-icons/react";

// List of tools that require human confirmation
// NOTE: this should match the tools that don't have execute functions in tools.ts
const toolsRequiringConfirmation: (keyof typeof tools)[] = [];

function ChatInterface() {
  const { logout, user } = useAuthContext();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    // Check localStorage first, default to dark if not found
    const savedTheme = localStorage.getItem("theme");
    return (savedTheme as "dark" | "light") || "dark";
  });
  const [showDebug, setShowDebug] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState("auto");
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const processedToolCalls = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    // Apply theme class on mount and when theme changes
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }

    // Save theme preference to localStorage
    console.log("[UI] Saving theme to localStorage:", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    console.log("[UI] Theme toggled to:", newTheme);
    setTheme(newTheme);
  };

  const agent = useAgent({
    agent: "chat",
    name: user?.id || "default"
  });

  const [agentInput, setAgentInput] = useState("");
  const handleAgentInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setAgentInput(e.target.value);
    console.log("[UI] Input changed, length:", e.target.value.length);
  };

  const handleVoiceTranscript = (transcript: string) => {
    console.log("[UI] Voice transcript received:", transcript);
    // Set the transcript in the textarea
    setAgentInput(transcript);
    // Clear any voice errors
    setVoiceError(null);
  };

  const handleVoiceError = (error: string) => {
    console.error("[UI] Voice error:", error);
    setVoiceError(error);
  };

  const handleAgentSubmit = async (
    e: React.FormEvent,
    extraData: Record<string, unknown> = {}
  ) => {
    e.preventDefault();
    if (!agentInput.trim()) return;

    const message = agentInput;
    console.log("[UI] User submitting message:", message);
    setAgentInput("");
    setVoiceError(null); // Clear any voice errors

    // Send message to agent
    await sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text: message }]
      },
      {
        body: { ...extraData, user }
      }
    );
    console.log("[UI] Message sent to agent");
  };

  const {
    messages: agentMessages,
    addToolResult,
    clearHistory,
    status,
    sendMessage,
    stop
  } = useAgentChat<unknown, UIMessage<{ createdAt: string }>>({
    agent
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    console.log("[UI] Message count:", agentMessages.length);
    agentMessages.length > 0 && scrollToBottom();
  }, [agentMessages, scrollToBottom]);

  // Detect UI actions from tool results
  useEffect(() => {
    try {
      // Check only the last assistant message for UI actions to avoid reopening on refresh
      const lastMessage = agentMessages[agentMessages.length - 1];

      if (
        lastMessage &&
        lastMessage.role === "assistant" &&
        lastMessage.parts
      ) {
        for (const part of lastMessage.parts) {
          if (isToolUIPart(part)) {
            // Check if this is the show_expense_dialog tool
            const toolName = part.type.replace("tool-", "");
            const toolCallId = part.toolCallId;

            if (toolName === "show_expense_dialog" && toolCallId) {
              // Check if we've already processed this tool call
              if (processedToolCalls.current.has(toolCallId)) {
                console.log("[UI] Tool call already processed:", toolCallId);
                continue;
              }

              console.log(
                "[UI] show_expense_dialog tool found, state:",
                part.state
              );

              // Open dialog - check for various valid states
              const validStates = [
                "input-available",
                "output-available",
                "input-streaming",
                "output-error"
              ];
              if (validStates.includes(part.state)) {
                console.log(
                  "[UI] Opening expense dialog for tool call:",
                  toolCallId
                );
                processedToolCalls.current.add(toolCallId);
                setShowExpenseDialog(true);
                return; // Stop after finding the first match
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("[UI] Error detecting UI actions:", error);
    }
  }, [agentMessages]);

  const pendingToolCallConfirmation = agentMessages.some((m: UIMessage) =>
    m.parts?.some(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        // Manual check inside the component
        toolsRequiringConfirmation.includes(
          part.type.replace("tool-", "") as keyof typeof tools
        )
    )
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleExpenseSubmit = async (expenseData: {
    amount: number;
    category: string;
    description: string;
    date: string;
    receiptId?: string;
  }) => {
    console.log("[UI] Expense submitted:", expenseData);

    try {
      // Send a message to the agent confirming the expense submission
      const message = `I've submitted an expense: $${expenseData.amount} for ${expenseData.category}. ${expenseData.description}. Receipt ID: ${expenseData.receiptId || "none"}`;

      await sendMessage(
        {
          role: "user",
          parts: [{ type: "text", text: message }]
        },
        {
          body: { user, expenseData }
        }
      );

      console.log("[UI] Expense message sent successfully");
      setShowExpenseDialog(false);
    } catch (error) {
      console.error("[UI] Error submitting expense:", error);
      // Still close the dialog even if message fails
      setShowExpenseDialog(false);
    }
  };

  return (
    <div className="h-[100vh] w-full p-4 flex justify-center items-center bg-fixed overflow-hidden">
      <HasAIProvider />
      <div className="h-[calc(100vh-2rem)] w-full mx-auto max-w-4xl flex flex-col shadow-xl rounded-md overflow-hidden relative border border-neutral-300 dark:border-neutral-800">
        <div className="px-4 py-3 border-b border-neutral-300 dark:border-neutral-800 flex items-center gap-3 sticky top-0 z-10">
          <div className="flex items-center justify-center h-8 w-8">
            <svg
              width="28px"
              height="28px"
              className="text-[#F48120]"
              data-icon="agents"
            >
              <title>Cloudflare Agents</title>
              <symbol id="ai:local:agents" viewBox="0 0 80 79">
                <path
                  fill="currentColor"
                  d="M69.3 39.7c-3.1 0-5.8 2.1-6.7 5H48.3V34h4.6l4.5-2.5c1.1.8 2.5 1.2 3.9 1.2 3.8 0 7-3.1 7-7s-3.1-7-7-7-7 3.1-7 7c0 .9.2 1.8.5 2.6L51.9 30h-3.5V18.8h-.1c-1.3-1-2.9-1.6-4.5-1.9h-.2c-1.9-.3-3.9-.1-5.8.6-.4.1-.8.3-1.2.5h-.1c-.1.1-.2.1-.3.2-1.7 1-3 2.4-4 4 0 .1-.1.2-.1.2l-.3.6c0 .1-.1.1-.1.2v.1h-.6c-2.9 0-5.7 1.2-7.7 3.2-2.1 2-3.2 4.8-3.2 7.7 0 .7.1 1.4.2 2.1-1.3.9-2.4 2.1-3.2 3.5s-1.2 2.9-1.4 4.5c-.1 1.6.1 3.2.7 4.7s1.5 2.9 2.6 4c-.8 1.8-1.2 3.7-1.1 5.6 0 1.9.5 3.8 1.4 5.6s2.1 3.2 3.6 4.4c1.3 1 2.7 1.7 4.3 2.2v-.1q2.25.75 4.8.6h.1c0 .1.1.1.1.1.9 1.7 2.3 3 4 4 .1.1.2.1.3.2h.1c.4.2.8.4 1.2.5 1.4.6 3 .8 4.5.7.4 0 .8-.1 1.3-.1h.1c1.6-.3 3.1-.9 4.5-1.9V62.9h3.5l3.1 1.7c-.3.8-.5 1.7-.5 2.6 0 3.8 3.1 7 7 7s7-3.1 7-7-3.1-7-7-7c-1.5 0-2.8.5-3.9 1.2l-4.6-2.5h-4.6V48.7h14.3c.9 2.9 3.5 5 6.7 5 3.8 0 7-3.1 7-7s-3.1-7-7-7m-7.9-16.9c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3m0 41.4c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3M44.3 72c-.4.2-.7.3-1.1.3-.2 0-.4.1-.5.1h-.2c-.9.1-1.7 0-2.6-.3-1-.3-1.9-.9-2.7-1.7-.7-.8-1.3-1.7-1.6-2.7l-.3-1.5v-.7q0-.75.3-1.5c.1-.2.1-.4.2-.7s.3-.6.5-.9c0-.1.1-.1.1-.2.1-.1.1-.2.2-.3s.1-.2.2-.3c0 0 0-.1.1-.1l.6-.6-2.7-3.5c-1.3 1.1-2.3 2.4-2.9 3.9-.2.4-.4.9-.5 1.3v.1c-.1.2-.1.4-.1.6-.3 1.1-.4 2.3-.3 3.4-.3 0-.7 0-1-.1-2.2-.4-4.2-1.5-5.5-3.2-1.4-1.7-2-3.9-1.8-6.1q.15-1.2.6-2.4l.3-.6c.1-.2.2-.4.3-.5 0 0 0-.1.1-.1.4-.7.9-1.3 1.5-1.9 1.6-1.5 3.8-2.3 6-2.3q1.05 0 2.1.3v-4.5c-.7-.1-1.4-.2-2.1-.2-1.8 0-3.5.4-5.2 1.1-.7.3-1.3.6-1.9 1s-1.1.8-1.7 1.3c-.3.2-.5.5-.8.8-.6-.8-1-1.6-1.3-2.6-.2-1-.2-2 0-2.9.2-1 .6-1.9 1.3-2.6.6-.8 1.4-1.4 2.3-1.8l1.8-.9-.7-1.9c-.4-1-.5-2.1-.4-3.1s.5-2.1 1.1-2.9q.9-1.35 2.4-2.1c.9-.5 2-.8 3-.7.5 0 1 .1 1.5.2 1 .2 1.8.7 2.6 1.3s1.4 1.4 1.8 2.3l4.1-1.5c-.9-2-2.3-3.7-4.2-4.9q-.6-.3-.9-.6c.4-.7 1-1.4 1.6-1.9.8-.7 1.8-1.1 2.9-1.3.9-.2 1.7-.1 2.6 0 .4.1.7.2 1.1.3V72zm25-22.3c-1.6 0-3-1.3-3-3 0-1.6 1.3-3 3-3s3 1.3 3 3c0 1.6-1.3 3-3 3"
                />
              </symbol>
              <use href="#ai:local:agents" />
            </svg>
          </div>

          <div className="flex-1">
            <h2 className="font-semibold text-base">ApprovalFlow AI</h2>
          </div>

          <div className="flex items-center gap-2 mr-2">
            <Bug size={16} />
            <Toggle
              toggled={showDebug}
              aria-label="Toggle debug mode"
              onClick={() => setShowDebug((prev) => !prev)}
            />
          </div>

          <Button
            variant="ghost"
            size="md"
            shape="square"
            className="rounded-full h-9 w-9"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </Button>

          <Button
            variant="ghost"
            size="md"
            shape="square"
            className="rounded-full h-9 w-9"
            onClick={clearHistory}
          >
            <Trash size={20} />
          </Button>
          <DropdownMenu
            align="end"
            side="bottom"
            MenuItems={[
              {
                type: "title",
                titleContent: (
                  <div className="flex flex-col gap-1">
                    <p className="font-medium">{user?.username}</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {user?.role}
                    </p>
                  </div>
                )
              },
              { type: "divider" },
              {
                type: "button",
                label: "Logout",
                icon: <SignOut size={16} />,
                onClick: () => {
                  console.log("[UI] User logging out:", user?.username);
                  logout();
                }
              }
            ]}
          >
            <User size={20} />
          </DropdownMenu>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24 max-h-[calc(100vh-10rem)]">
          {agentMessages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <Card className="p-6 max-w-lg mx-auto bg-neutral-100 dark:bg-neutral-900">
                <div className="text-center space-y-4">
                  <div className="bg-[#F48120]/10 text-[#F48120] rounded-full p-3 inline-flex">
                    <Robot size={24} />
                  </div>
                  <h3 className="font-semibold text-lg">
                    Welcome to ApprovalFlow AI
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    You can submit requests for PTO, expenses, and access
                    grants. Try asking:
                  </p>
                  <ul className="text-sm text-left space-y-2">
                    <li className="flex items-center gap-2">
                      <span className="text-[#F48120]">•</span>
                      <span>"What can you do?"</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-[#F48120]">•</span>
                      <span>"How many PTO days do I have left?"</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-[#F48120]">•</span>
                      <span>"I need to request 3 days of PTO"</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-[#F48120]">•</span>
                      <span>
                        "Submit an expense for $50 for a client lunch"
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-[#F48120]">•</span>
                      <span>
                        "What does the employee handbook say about taking time
                        offs?"
                      </span>
                    </li>
                  </ul>
                </div>
              </Card>
            </div>
          )}

          {agentMessages.map((m, index) => {
            const isUser = m.role === "user";
            const showAvatar =
              index === 0 || agentMessages[index - 1]?.role !== m.role;

            return (
              <div key={m.id}>
                {showDebug && (
                  <pre className="text-xs text-muted-foreground overflow-scroll">
                    {JSON.stringify(m, null, 2)}
                  </pre>
                )}
                <div
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex gap-2 max-w-[85%] ${
                      isUser ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {showAvatar && !isUser ? (
                      <Avatar username={"AI"} />
                    ) : (
                      !isUser && <div className="w-8" />
                    )}

                    <div>
                      <div>
                        {m.parts?.map((part, i) => {
                          if (part.type === "text") {
                            return (
                              // biome-ignore lint/suspicious/noArrayIndexKey: immutable index
                              <div key={i}>
                                <Card
                                  className={`p-3 rounded-md bg-neutral-100 dark:bg-neutral-900 ${
                                    isUser
                                      ? "rounded-br-none"
                                      : "rounded-bl-none border-assistant-border"
                                  } ${
                                    part.text.startsWith("scheduled message")
                                      ? "border-accent/50"
                                      : ""
                                  } relative`}
                                >
                                  {part.text.startsWith(
                                    "scheduled message"
                                  ) && (
                                    <span className="absolute -top-3 -left-2 text-base">
                                      🕒
                                    </span>
                                  )}
                                  <MemoizedMarkdown
                                    id={`${m.id}-${i}`}
                                    content={part.text.replace(
                                      /^scheduled message: /,
                                      ""
                                    )}
                                  />
                                </Card>
                                <p
                                  className={`text-xs text-muted-foreground mt-1 ${
                                    isUser ? "text-right" : "text-left"
                                  }`}
                                >
                                  {formatTime(
                                    m.metadata?.createdAt
                                      ? new Date(m.metadata.createdAt)
                                      : new Date()
                                  )}
                                </p>
                              </div>
                            );
                          }

                          if (
                            isToolUIPart(part) &&
                            m.id.startsWith("assistant")
                          ) {
                            const toolCallId = part.toolCallId;
                            const toolName = part.type.replace("tool-", "");
                            const needsConfirmation =
                              toolsRequiringConfirmation.includes(
                                toolName as keyof typeof tools
                              );

                            // Skip rendering the card in debug mode
                            if (showDebug) return null;

                            return (
                              <ToolInvocationCard
                                // biome-ignore lint/suspicious/noArrayIndexKey: using index is safe here as the array is static
                                key={`${toolCallId}-${i}`}
                                toolUIPart={part}
                                toolCallId={toolCallId}
                                needsConfirmation={needsConfirmation}
                                onSubmit={({ toolCallId, result }) => {
                                  addToolResult({
                                    tool: part.type.replace("tool-", ""),
                                    toolCallId,
                                    output: result
                                  });
                                }}
                                addToolResult={(toolCallId, result) => {
                                  addToolResult({
                                    tool: part.type.replace("tool-", ""),
                                    toolCallId,
                                    output: result
                                  });
                                }}
                              />
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAgentSubmit(e, {
              annotations: {
                hello: "world"
              }
            });
            setTextareaHeight("auto"); // Reset height after submission
          }}
          className="p-3 bg-neutral-50 absolute bottom-0 left-0 right-0 z-10 border-t border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Textarea
                disabled={pendingToolCallConfirmation}
                placeholder={
                  pendingToolCallConfirmation
                    ? "Please respond to the tool confirmation above..."
                    : "Send a message..."
                }
                className="flex w-full border border-neutral-200 dark:border-neutral-700 px-3 py-2  ring-offset-background placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-700 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl !text-base pb-10 dark:bg-neutral-900"
                value={agentInput}
                onChange={(e) => {
                  handleAgentInputChange(e);
                  // Auto-resize the textarea
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                  setTextareaHeight(`${e.target.scrollHeight}px`);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    handleAgentSubmit(e as unknown as React.FormEvent);
                    setTextareaHeight("auto"); // Reset height on Enter submission
                  }
                }}
                rows={2}
                style={{ height: textareaHeight }}
              />
              {voiceError && (
                <div className="text-xs text-red-500 mt-1 px-3">
                  {voiceError}
                </div>
              )}
              <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end gap-2">
                <VoiceRecorder
                  onTranscript={handleVoiceTranscript}
                  onError={handleVoiceError}
                  disabled={pendingToolCallConfirmation}
                />
                {status === "submitted" || status === "streaming" ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full p-1.5 h-fit border border-neutral-200 dark:border-neutral-800"
                    aria-label="Stop generation"
                  >
                    <Stop size={16} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full p-1.5 h-fit border border-neutral-200 dark:border-neutral-800"
                    disabled={pendingToolCallConfirmation || !agentInput.trim()}
                    aria-label="Send message"
                  >
                    <PaperPlaneTilt size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Expense Submission Dialog */}
      <ExpenseSubmissionDialog
        isOpen={showExpenseDialog}
        onClose={() => setShowExpenseDialog(false)}
        onSubmit={handleExpenseSubmit}
      />
    </div>
  );
}

export default function App() {
  const { status } = useAuthContext();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Login />;
  }

  return <ChatInterface />;
}

const hasAiProviderPromise = fetch("/check-ai-provider").then((res) =>
  res.json<{ success: boolean }>()
);

function HasAIProvider() {
  const hasAiProvider = use(hasAiProviderPromise);

  if (!hasAiProvider.success) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-500/10 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-lg border border-red-200 dark:border-red-900 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-labelledby="warningIcon"
                >
                  <title id="warningIcon">Warning Icon</title>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
                  AI Provider Not Configured
                </h3>
                <p className="text-neutral-600 dark:text-neutral-300 mb-1">
                  Requests to the API, including from the frontend UI, will not
                  work until an AI provider is configured and the `ai` binding
                  is attached.
                </p>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Please configure a Cloudflare Workers AI binding using the
                  `ai` binding in `wrangler.jsonc` and attach it to an AI
                  Gateway. For local development, use `wrangler dev --remote` or
                  configure an appropriate gateway binding.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
