import type React from "react";
import { useEffect, useState } from "react";
import { Card } from "@/components/card/Card";
import { CheckCircle, Clock, XCircle } from "@phosphor-icons/react";

interface Expense {
  id: string;
  category: string;
  amount: number;
  currency: string;
  description: string;
  status: "pending" | "approved" | "denied" | "auto_approved";
  created_at: number;
  receipt_url?: string;
  ai_validation_notes?: string;
}

interface ExpenseHistoryProps {
  onExpenseClick?: (expense: Expense) => void;
  isLoading?: boolean;
}

type FilterStatus = "all" | "pending" | "approved" | "denied";

export const ExpenseHistory: React.FC<ExpenseHistoryProps> = ({
  onExpenseClick,
  isLoading = false
}) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  // Mock data - in real app, would fetch from API
  useEffect(() => {
    setExpenses([
      {
        id: "1",
        category: "meals",
        amount: 150,
        currency: "USD",
        description: "Client lunch meeting",
        status: "auto_approved",
        created_at: Date.now() / 1000 - 86400 * 2
      },
      {
        id: "2",
        category: "software",
        amount: 500,
        currency: "USD",
        description: "Adobe Creative Cloud license",
        status: "pending",
        created_at: Date.now() / 1000 - 86400
      },
      {
        id: "3",
        category: "travel",
        amount: 250,
        currency: "USD",
        description: "Flight to SF conference",
        status: "approved",
        created_at: Date.now() / 1000 - 86400 * 5
      }
    ]);
  }, []);

  const filteredExpenses = expenses.filter((exp) => {
    if (filterStatus === "all") return true;
    if (filterStatus === "approved")
      return ["approved", "auto_approved"].includes(exp.status);
    return exp.status === filterStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
      case "auto_approved":
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">
            <CheckCircle className="w-4 h-4" weight="fill" />
            {status === "auto_approved" ? "Auto-Approved" : "Approved"}
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm font-medium">
            <Clock className="w-4 h-4" weight="fill" />
            Pending
          </span>
        );
      case "denied":
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium">
            <XCircle className="w-4 h-4" weight="fill" />
            Denied
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  };

  return (
    <div className="w-full space-y-6">
      {/* Filter Buttons */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "approved", "denied"] as const).map((status) => (
          <button
            type="button"
            key={status}
            onClick={() => setFilterStatus(status)}
            disabled={isLoading}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              filterStatus === status
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Expenses List */}
      {filteredExpenses.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-gray-600">
            {isLoading ? "Loading expenses..." : "No expenses found"}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredExpenses.map((expense) => (
            <button
              type="button"
              key={expense.id}
              onClick={() => onExpenseClick?.(expense)}
              className="w-full text-left cursor-pointer"
            >
              <Card className="p-4 hover:bg-gray-50 transition">
                <div className="flex justify-between items-start gap-4">
                  {/* Left side - Details */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <p className="font-semibold text-gray-900 capitalize">
                        {expense.category.replace("_", " ")}
                      </p>
                      {getStatusBadge(expense.status)}
                    </div>
                    <p className="text-sm text-gray-600 mb-2">
                      {expense.description}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDate(expense.created_at)}
                    </p>
                  </div>

                  {/* Right side - Amount */}
                  <div className="text-right">
                    <p className="text-xl font-bold text-gray-900">
                      ${expense.amount.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">USD</p>
                  </div>
                </div>

                {/* AI Notes if available */}
                {expense.ai_validation_notes && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">AI Notes:</span>{" "}
                      {expense.ai_validation_notes}
                    </p>
                  </div>
                )}
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      {filteredExpenses.length > 0 && (
        <Card className="p-4 bg-blue-50 border border-blue-200">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-blue-600 font-medium">Total Amount</p>
              <p className="text-lg font-bold text-blue-900 mt-1">
                $
                {filteredExpenses
                  .reduce((sum, exp) => sum + exp.amount, 0)
                  .toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-blue-600 font-medium">Approved</p>
              <p className="text-lg font-bold text-blue-900 mt-1">
                {
                  filteredExpenses.filter((exp) =>
                    ["approved", "auto_approved"].includes(exp.status)
                  ).length
                }
              </p>
            </div>
            <div>
              <p className="text-xs text-blue-600 font-medium">Pending</p>
              <p className="text-lg font-bold text-blue-900 mt-1">
                {
                  filteredExpenses.filter((exp) => exp.status === "pending")
                    .length
                }
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
