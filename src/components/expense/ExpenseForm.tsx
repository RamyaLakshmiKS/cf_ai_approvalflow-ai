import type React from "react";
import { useState } from "react";
import { FileUploadInput } from "./FileUploadInput";
import { ReceiptPreview } from "./ReceiptPreview";
import { Select } from "@/components/select/Select";
import { Textarea } from "@/components/textarea/Textarea";
import { Button } from "@/components/button/Button";

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

interface ExpenseFormProps {
  onSubmit: (data: {
    file_data: string;
    file_name: string;
    file_type: string;
    category: string;
    description: string;
    amount: number;
    extracted_data: ExtractedReceiptData;
  }) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  error?: string;
}

const EXPENSE_CATEGORIES = [
  { label: "Meals", value: "meals" },
  { label: "Travel", value: "travel" },
  { label: "Training", value: "training" },
  { label: "Software", value: "software" },
  { label: "Supplies", value: "supplies" },
  { label: "Home Office", value: "home_office" }
];

type FormStep = "upload" | "extract" | "details" | "submitting";

export const ExpenseForm: React.FC<ExpenseFormProps> = ({
  onSubmit,
  onCancel,
  isLoading = false,
  error
}) => {
  const [step, setStep] = useState<FormStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>("");
  const [extractedData, setExtractedData] =
    useState<ExtractedReceiptData | null>(null);
  const [category, setCategory] = useState<string>("meals");
  const [description, setDescription] = useState<string>("");
  const [uploadError, setUploadError] = useState<string>("");

  const handleFileSelect = (file: File, base64: string) => {
    setSelectedFile(file);
    setFileBase64(base64);
    setUploadError("");
    
    // Simulate OCR extraction (in production, this would call the AI backend)
    // Mock OCR extraction - in real app, would call process_receipt_ocr tool
    setTimeout(() => {
      // Parse amount from user's message if available, otherwise use mock
      setExtractedData({
        amount: 75, // This will be dynamically extracted in production
        currency: "USD",
        date: new Date().toISOString().split("T")[0],
        merchant: "Example Merchant",
        line_items: [
          { description: "Main Item", amount: 65 },
          { description: "Tax", amount: 10 }
        ]
      });
      setStep("extract");
    }, 1500);
  };

  const handleReceiptConfirm = () => {
    setStep("details");
  };

  const handleDetailsSubmit = async () => {
    if (!selectedFile || !fileBase64 || !extractedData) {
      setUploadError("Missing required information");
      return;
    }

    if (!category) {
      setUploadError("Please select a category");
      return;
    }

    if (!description.trim()) {
      setUploadError("Please provide a description");
      return;
    }

    try {
      setStep("submitting");
      await onSubmit({
        file_data: fileBase64.split(",")[1], // Remove data URL prefix
        file_name: selectedFile.name,
        file_type: selectedFile.type,
        category,
        description,
        amount: extractedData.amount,
        extracted_data: extractedData
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Submission failed");
      setStep("details");
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        <div
          className={`flex flex-col items-center ${step === "upload" ? "text-blue-600" : "text-gray-600"}`}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
              step === "upload"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            1
          </div>
          <p className="text-xs mt-1">Upload Receipt</p>
        </div>
        <div className="flex-1 border-t-2 border-gray-200 mx-2 mb-6" />
        <div
          className={`flex flex-col items-center ${step === "extract" ? "text-blue-600" : "text-gray-600"}`}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
              step === "extract"
                ? "bg-blue-600 text-white"
                : ["extract", "details"].includes(step)
                  ? "bg-gray-300 text-white"
                  : "bg-gray-200 text-gray-700"
            }`}
          >
            2
          </div>
          <p className="text-xs mt-1">Verify Data</p>
        </div>
        <div className="flex-1 border-t-2 border-gray-200 mx-2 mb-6" />
        <div
          className={`flex flex-col items-center ${step === "details" ? "text-blue-600" : "text-gray-600"}`}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
              step === "details"
                ? "bg-blue-600 text-white"
                : step !== "upload"
                  ? "bg-gray-300 text-white"
                  : "bg-gray-200 text-gray-700"
            }`}
          >
            3
          </div>
          <p className="text-xs mt-1">Add Details</p>
        </div>
      </div>

      {/* Error Message */}
      {(error || uploadError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || uploadError}
        </div>
      )}

      {/* Step Content */}
      {step === "upload" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Upload Receipt
          </h2>
          <p className="text-gray-600 text-sm">
            Start by uploading your receipt. We'll automatically extract the
            amount, date, and merchant information.
          </p>
          <FileUploadInput
            onFileSelect={handleFileSelect}
            onError={(err) => setUploadError(err)}
            disabled={isLoading || step === "submitting"}
          />
        </div>
      )}

      {step === "extract" && extractedData && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Verify Receipt Information
          </h2>
          <p className="text-gray-600 text-sm">
            Please review the extracted receipt data. If anything looks
            incorrect, click "Edit Information" to make changes.
          </p>
          <ReceiptPreview
            data={extractedData}
            onConfirm={handleReceiptConfirm}
            onEdit={() => {
              // In real app, would show edit modal
              setStep("details");
            }}
            isLoading={isLoading || step === "submitting"}
          />
        </div>
      )}

      {step === "details" && extractedData && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Expense Details
          </h2>
          <p className="text-gray-600 text-sm">
            Provide the category and business reason for this expense.
          </p>

          <div className="space-y-4">
            {/* Category Selection */}
            <div>
              <label
                htmlFor="category"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Category *
              </label>
              <Select
                value={category}
                setValue={setCategory}
                options={EXPENSE_CATEGORIES}
              />
            </div>

            {/* Extracted Amount (Read-only) */}
            <div>
              <label
                htmlFor="amount"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Amount
              </label>
              <div
                id="amount"
                className="bg-gray-50 border border-gray-300 rounded p-3 text-gray-900 font-semibold"
              >
                ${extractedData.amount.toFixed(2)}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Extracted from receipt. Update category selection if this is
                incorrect.
              </p>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Business Reason *
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Client lunch meeting with Product team to discuss Q4 roadmap"
                disabled={isLoading}
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">
                Explain the business purpose of this expense
              </p>
            </div>

            {/* Merchant Info */}
            {extractedData.merchant && (
              <div>
                <label
                  htmlFor="merchant"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Merchant
                </label>
                <input
                  id="merchant"
                  value={extractedData.merchant}
                  disabled
                  type="text"
                  className="w-full bg-gray-50 border border-gray-300 rounded p-2 text-gray-900"
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="secondary"
                onClick={() => setStep("extract")}
                disabled={isLoading || step === "submitting"}
              >
                Back
              </Button>
              <Button
                onClick={handleDetailsSubmit}
                disabled={isLoading || step === "submitting" || !category || !description.trim()}
              >
                {(isLoading || step === "submitting") ? "Submitting..." : "Submit Expense"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Submitting State */}
      {step === "submitting" && (
        <div className="space-y-4 text-center py-8">
          <div className="w-16 h-16 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="text-lg font-medium text-gray-900">Processing your expense request...</p>
          <p className="text-sm text-gray-600">Please wait while we validate and submit your expense.</p>
        </div>
      )}

      {/* Cancel Button (visible on all steps except submitting) */}
      {step !== "submitting" && onCancel && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading || step === "submitting"}
            className="text-sm text-gray-600 hover:text-gray-900 underline disabled:opacity-50"
          >
            Cancel and return to chat
          </button>
        </div>
      )}
    </div>
  );
};
