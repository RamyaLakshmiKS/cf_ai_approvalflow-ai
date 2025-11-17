import { CheckCircle, Clock, CloudWarning } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Loader } from "@/components/loader/Loader";
import { ExpenseForm } from "./ExpenseForm";

interface ExpenseSubmissionUIProps {
  toolCallId?: string;
  onSubmit: (result: {
    status: string;
    message: string;
    expenseId?: string;
    data?: unknown;
  }) => void;
  isLoading?: boolean;
}

interface ExpenseResult {
  status: "success" | "error" | "pending";
  message: string;
  expenseId?: string;
  data?: Record<string, unknown>;
}

export function ExpenseSubmissionUI({
  onSubmit,
  isLoading: externalLoading = false
}: ExpenseSubmissionUIProps) {
  const [result, setResult] = useState<ExpenseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleExpenseSubmit = async (formData: {
    file_data: string;
    file_name: string;
    file_type: string;
    category: string;
    description: string;
    amount: number;
  }) => {
    setIsLoading(true);
    try {
      // Call the backend API to submit the expense
      const response = await fetch("/api/expenses/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formData)
      });

      const data = (await response.json()) as ExpenseResult;

      if (response.ok && data.status === "success") {
        setResult({
          status: "success",
          message: data.message,
          expenseId: data.expenseId,
          data: data.data
        });

        // Notify parent component
        onSubmit({
          status: "success",
          message: data.message,
          expenseId: data.expenseId,
          data: data.data
        });
      } else {
        setResult({
          status: "error",
          message: data.message || "Failed to submit expense"
        });

        onSubmit({
          status: "error",
          message: data.message || "Failed to submit expense"
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      setResult({
        status: "error",
        message: errorMessage
      });

      onSubmit({
        status: "error",
        message: errorMessage
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewHistory = () => {
    // This could be expanded to show a modal with expense history
    console.log("Viewing expense history");
  };

  // Show loading state
  if (externalLoading || isLoading) {
    return (
      <Card className="p-4 my-3 w-full rounded-md bg-neutral-100 dark:bg-neutral-900">
        <div className="flex items-center gap-3">
          <Loader />
          <div>
            <p className="font-medium text-sm">Processing expense...</p>
            <p className="text-xs text-muted-foreground">
              Extracting receipt data and validating against policy
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // Show success result
  if (result?.status === "success") {
    return (
      <Card className="p-4 my-3 w-full rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-1.5 bg-green-100 dark:bg-green-900/30 rounded-full">
            <CheckCircle
              size={20}
              className="text-green-600 dark:text-green-400"
            />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-green-800 dark:text-green-200">
              Expense Submitted Successfully
            </h4>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              {result.message}
            </p>
            {result.expenseId && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                Expense ID: {result.expenseId}
              </p>
            )}
            {result.data &&
              (() => {
                const data = result.data as Record<string, unknown>;
                return (
                  <div className="mt-3 bg-white dark:bg-neutral-900 p-2 rounded text-xs">
                    <p className="text-muted-foreground mb-1">
                      <strong>Auto-Approval Status:</strong>{" "}
                      {data.auto_approved
                        ? "✓ Approved"
                        : "⏳ Pending Manager Review"}
                    </p>
                    {data.violations ? (
                      <p className="text-muted-foreground">
                        <strong>Policy Violations:</strong>{" "}
                        {JSON.stringify(data.violations)}
                      </p>
                    ) : null}
                  </div>
                );
              })()}
          </div>
        </div>
      </Card>
    );
  }

  // Show error result
  if (result?.status === "error") {
    return (
      <Card className="p-4 my-3 w-full rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 p-1.5 bg-red-100 dark:bg-red-900/30 rounded-full">
            <CloudWarning
              size={20}
              className="text-red-600 dark:text-red-400"
            />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-red-800 dark:text-red-200">
              Expense Submission Failed
            </h4>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {result.message}
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              onClick={() => setResult(null)}
            >
              Try Again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // Show form input
  return (
    <div className="my-3 w-full">
      <Card className="p-4 rounded-md bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
        <div className="mb-4">
          <h3 className="font-medium text-base flex items-center gap-2">
            <Clock size={18} className="text-[#F48120]" />
            Submit Expense Request
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Upload your receipt and provide details for reimbursement
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-900 rounded-md p-4">
          <ExpenseForm
            onSubmit={handleExpenseSubmit}
            isLoading={isLoading}
            error=""
          />
        </div>

        <div className="mt-4 pt-4 border-t border-neutral-300 dark:border-neutral-700">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleViewHistory}
            className="text-xs"
          >
            View Past Expenses
          </Button>
        </div>
      </Card>
    </div>
  );
}
