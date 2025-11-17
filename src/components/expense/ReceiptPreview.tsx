import type React from "react";
import { Check, Warning } from "@phosphor-icons/react";

interface ExtractedReceiptData {
  amount: number;
  currency: string;
  date: string;
  merchant: string;
  line_items?: Array<{
    description: string;
    amount: number;
  }>;
}

interface ReceiptPreviewProps {
  data: ExtractedReceiptData;
  warnings?: string[];
  discrepancies?: string[];
  onConfirm: () => void;
  onEdit: () => void;
  isLoading?: boolean;
}

export const ReceiptPreview: React.FC<ReceiptPreviewProps> = ({
  data,
  warnings = [],
  discrepancies = [],
  onConfirm,
  onEdit,
  isLoading = false
}) => {
  const hasIssues = warnings.length > 0 || discrepancies.length > 0;

  return (
    <div className="w-full space-y-4">
      {/* Success banner */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
        <Check
          className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0"
          weight="bold"
        />
        <div>
          <p className="font-medium text-green-900">
            ✓ Receipt parsed successfully!
          </p>
          <p className="text-sm text-green-800 mt-1">
            Please verify the extracted data is correct before submitting.
          </p>
        </div>
      </div>

      {/* Warnings/Discrepancies */}
      {hasIssues && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-2">
          {discrepancies.map((disc) => (
            <div key={disc} className="flex items-start gap-3">
              <Warning
                className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0"
                weight="bold"
              />
              <p className="text-sm text-yellow-800">{disc}</p>
            </div>
          ))}
          {warnings.map((warn) => (
            <div key={warn} className="flex items-start gap-3">
              <Warning
                className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0"
                weight="bold"
              />
              <p className="text-sm text-yellow-800">{warn}</p>
            </div>
          ))}
        </div>
      )}

      {/* Receipt Data Display */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-2 gap-6">
          {/* Merchant & Date */}
          <div>
            <p className="text-sm font-medium text-gray-600">Merchant</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {data.merchant}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600">Date</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {new Date(data.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric"
              })}
            </p>
          </div>
        </div>

        {/* Line Items */}
        {data.line_items && data.line_items.length > 0 && (
          <div className="border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-600 mb-3">Items</p>
            <div className="space-y-2">
              {data.line_items.map((item) => (
                <div
                  key={`${item.description}-${item.amount}`}
                  className="flex justify-between items-start text-sm"
                >
                  <span className="text-gray-700">{item.description}</span>
                  <span className="text-gray-900 font-medium">
                    ${item.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Total Amount */}
        <div className="border-t border-gray-200 pt-4">
          <div className="flex justify-between items-center">
            <p className="text-base font-semibold text-gray-900">Total</p>
            <p className="text-2xl font-bold text-blue-600">
              {data.currency === "USD" ? "$" : `${data.currency} `}
              {data.amount.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onEdit}
          disabled={isLoading}
          className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          Edit Information
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Check weight="bold" className="w-5 h-5" />
              Confirm & Continue
            </>
          )}
        </button>
      </div>

      {/* Debug info */}
      <details className="bg-gray-50 border border-gray-200 rounded p-3">
        <summary className="text-sm font-medium text-gray-700 cursor-pointer">
          View extracted JSON
        </summary>
        <pre className="mt-2 text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-auto max-h-32">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
};
