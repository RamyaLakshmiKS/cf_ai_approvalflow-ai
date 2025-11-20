import {
  CaretDown,
  Robot,
  Spinner,
  CheckCircle,
  XCircle
} from "@phosphor-icons/react";
import type { ToolUIPart } from "ai";
import { useState } from "react";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { APPROVAL } from "@/shared";

interface ToolResultWithContent {
  content: Array<{ type: string; text: string }>;
}

function isToolResultWithContent(
  result: unknown
): result is ToolResultWithContent {
  return (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as ToolResultWithContent).content)
  );
}

interface ToolInvocationCardProps {
  toolUIPart: ToolUIPart;
  toolCallId: string;
  needsConfirmation: boolean;
  onSubmit: ({
    toolCallId,
    result
  }: {
    toolCallId: string;
    result: string;
  }) => void;
  addToolResult: (toolCallId: string, result: string) => void;
}

export function ToolInvocationCard({
  toolUIPart,
  toolCallId,
  needsConfirmation,
  onSubmit
  // addToolResult
}: ToolInvocationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className="p-4 my-3 w-full max-w-[500px] rounded-md bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 cursor-pointer"
      >
        <div
          className={`${needsConfirmation ? "bg-[#F48120]/10" : "bg-[#F48120]/5"} p-1.5 rounded-full flex-shrink-0`}
        >
          <Robot size={16} className="text-[#F48120]" />
        </div>
        <h4 className="font-medium flex items-center gap-2 flex-1 text-left">
          {toolUIPart.type}
          {!needsConfirmation && toolUIPart.state === "input-available" && (
            <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <Spinner size={12} className="animate-spin" />
              Executing...
            </span>
          )}
          {!needsConfirmation && toolUIPart.state === "output-available" && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle size={12} weight="fill" />
              Completed
            </span>
          )}
          {!needsConfirmation && toolUIPart.state === "output-error" && (
            <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <XCircle size={12} weight="fill" />
              Error
            </span>
          )}
        </h4>
        <CaretDown
          size={16}
          className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      <div
        className={`transition-all duration-200 ${isExpanded ? "max-h-[200px] opacity-100 mt-3" : "max-h-0 opacity-0 overflow-hidden"}`}
      >
        <div
          className="overflow-y-auto"
          style={{ maxHeight: isExpanded ? "180px" : "0px" }}
        >
          <div className="mb-3">
            <h5 className="text-xs font-medium mb-1 text-muted-foreground">
              Arguments:
            </h5>
            <pre className="bg-background/80 p-2 rounded-md text-xs overflow-auto whitespace-pre-wrap break-words max-w-[450px]">
              {JSON.stringify(toolUIPart.input, null, 2)}
            </pre>
          </div>

          {needsConfirmation && toolUIPart.state === "input-available" && (
            <div className="flex gap-2 justify-end">
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSubmit({ toolCallId, result: APPROVAL.NO })}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSubmit({ toolCallId, result: APPROVAL.YES })}
              >
                Approve
              </Button>
            </div>
          )}

          {!needsConfirmation && toolUIPart.state === "output-available" && (
            <div className="mt-3 border-t border-[#F48120]/10 pt-3">
              <h5 className="text-xs font-medium mb-1 text-muted-foreground">
                Result:
              </h5>
              <pre className="bg-background/80 p-2 rounded-md text-xs overflow-auto whitespace-pre-wrap break-words max-w-[450px]">
                {(() => {
                  const result = toolUIPart.output;
                  if (isToolResultWithContent(result)) {
                    return result.content
                      .map((item: { type: string; text: string }) => {
                        if (
                          item.type === "text" &&
                          item.text.startsWith("\n~ Page URL:")
                        ) {
                          const lines = item.text.split("\n").filter(Boolean);
                          return lines
                            .map(
                              (line: string) => `- ${line.replace("\n~ ", "")}`
                            )
                            .join("\n");
                        }
                        return item.text;
                      })
                      .join("\n");
                  }
                  return JSON.stringify(result, null, 2);
                })()}
              </pre>
            </div>
          )}

          {!needsConfirmation && toolUIPart.state === "output-error" && (
            <div className="mt-3 border-t border-red-200 dark:border-red-800 pt-3">
              <h5 className="text-xs font-medium mb-1 text-red-600 dark:text-red-400">
                Error:
              </h5>
              <pre className="bg-red-50 dark:bg-red-950/30 p-2 rounded-md text-xs overflow-auto whitespace-pre-wrap break-words max-w-[450px] text-red-700 dark:text-red-300">
                {toolUIPart.errorText || "Tool execution failed"}
              </pre>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
