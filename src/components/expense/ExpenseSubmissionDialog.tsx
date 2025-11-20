import React, { useState, useRef } from "react";
import { Modal } from "@/components/modal/Modal";
import { Button } from "@/components/button/Button";
import { Input } from "@/components/input/Input";
import { Label } from "@/components/label/Label";
import { Select } from "@/components/select/Select";
import { Textarea } from "@/components/textarea/Textarea";
import { Loader } from "@/components/loader/Loader";
import {
  UploadSimple,
  CheckCircle,
  WarningCircle
} from "@phosphor-icons/react";

interface ExtractedData {
  amount: number;
  currency: string;
  date: string;
  merchant: string;
  items?: Array<{ description: string; amount: number }>;
}

interface ExpenseSubmissionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    amount: number;
    category: string;
    description: string;
    date: string;
    receiptId?: string;
  }) => void;
}

export const ExpenseSubmissionDialog = ({
  isOpen,
  onClose,
  onSubmit
}: ExpenseSubmissionDialogProps) => {
  const [step, setStep] = useState<"upload" | "review" | "submitting">(
    "upload"
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(
    null
  );
  const [ocrStatus, setOcrStatus] = useState<
    "pending" | "completed" | "failed" | null
  >(null);

  const [formData, setFormData] = useState({
    amount: "",
    currency: "USD",
    date: new Date().toISOString().split("T")[0],
    merchant: "",
    category: "meals",
    description: ""
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "application/pdf"
      ];
      if (!allowedTypes.includes(file.type)) {
        setUploadError(
          "Invalid file type. Please upload a JPEG, PNG, or PDF file."
        );
        return;
      }

      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        setUploadError("File size exceeds 5MB limit.");
        return;
      }

      setSelectedFile(file);
      setUploadError(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadError(null);

    try {
      const formDataUpload = new FormData();
      formDataUpload.append("receipt", selectedFile);

      const response = await fetch("/api/receipts/upload", {
        method: "POST",
        body: formDataUpload,
        credentials: "include"
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          (result as { error?: string }).error || "Upload failed"
        );
      }

      console.log("[ExpenseDialog] Upload successful:", result);

      setReceiptId((result as { receipt_id: string }).receipt_id);
      setOcrStatus(
        (result as { ocr_status: string }).ocr_status as
          | "pending"
          | "completed"
          | "failed"
      );

      // Pre-fill form with extracted data
      const typedResult = result as { extracted_data?: ExtractedData };
      if (typedResult.extracted_data) {
        setExtractedData(typedResult.extracted_data);
        setFormData((prev) => ({
          ...prev,
          amount: typedResult.extracted_data?.amount?.toString() || "",
          currency: typedResult.extracted_data?.currency || "USD",
          date: typedResult.extracted_data?.date || prev.date,
          merchant: typedResult.extracted_data?.merchant || ""
        }));
      }

      setStep("review");
    } catch (error) {
      console.error("[ExpenseDialog] Upload error:", error);
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    console.log("[ExpenseDialog] Submitting expense...");

    try {
      // Call the onSubmit callback with the form data (this will close the dialog)
      onSubmit({
        amount: parseFloat(formData.amount),
        category: formData.category,
        description:
          formData.description || `${formData.merchant} - ${formData.category}`,
        date: formData.date,
        receiptId: receiptId || undefined
      });

      // Close immediately (the parent component will handle the async submission)
      handleClose();
    } catch (error) {
      console.error("[ExpenseDialog] Submission error:", error);
      // Reset to review step on error
      setStep("review");
      setUploadError("Failed to submit expense. Please try again.");
    }
  };

  const handleClose = () => {
    // Reset state immediately
    setStep("upload");
    setSelectedFile(null);
    setUploading(false);
    setUploadError(null);
    setReceiptId(null);
    setExtractedData(null);
    setOcrStatus(null);
    setFormData({
      amount: "",
      currency: "USD",
      date: new Date().toISOString().split("T")[0],
      merchant: "",
      category: "meals",
      description: ""
    });

    // Call parent onClose to actually close the dialog
    onClose();
  };

  // Reset form when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setStep("upload");
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="max-w-2xl">
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">
          Submit Expense Reimbursement
        </h2>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,application/pdf"
                onChange={handleFileSelect}
                className="hidden"
              />

              {!selectedFile ? (
                <div className="space-y-4">
                  <UploadSimple size={48} className="mx-auto text-gray-400" />
                  <div>
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      Choose Receipt File
                    </Button>
                    <p className="text-sm text-gray-500 mt-2">
                      or drag and drop here
                    </p>
                  </div>
                  <p className="text-xs text-gray-400">
                    Supported: JPEG, PNG, PDF (max 5MB)
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <CheckCircle size={48} className="mx-auto text-green-500" />
                  <div>
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="secondary"
                    >
                      Change File
                    </Button>
                    <Button onClick={handleUpload} disabled={uploading}>
                      {uploading ? "Processing..." : "Upload & Extract Data"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {uploading && (
              <div className="flex items-center justify-center gap-2 text-blue-600">
                <Loader size={20} />
                <span>Processing receipt with AI...</span>
              </div>
            )}

            {uploadError && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded">
                <WarningCircle size={20} />
                <span>{uploadError}</span>
              </div>
            )}
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            {ocrStatus === "completed" && extractedData && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-2">
                  <CheckCircle size={20} className="text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-green-900">
                      Receipt Processed Successfully!
                    </h3>
                    <p className="text-sm text-green-700 mt-1">
                      AI extracted the following data. Please verify and adjust
                      if needed:
                    </p>
                  </div>
                </div>
              </div>
            )}

            {ocrStatus === "failed" && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-2">
                  <WarningCircle size={20} className="text-yellow-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-yellow-900">
                      OCR Processing Failed
                    </h3>
                    <p className="text-sm text-yellow-700 mt-1">
                      Please enter the expense details manually.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Label title="Amount" htmlFor="amount" required>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  initialValue={formData.amount}
                  onValueChange={(value: string) =>
                    setFormData((prev) => ({ ...prev, amount: value }))
                  }
                  placeholder="0.00"
                  required
                />
              </Label>

              <Label title="Currency" htmlFor="currency">
                <Select
                  value={formData.currency}
                  setValue={(value: string) =>
                    setFormData((prev) => ({ ...prev, currency: value }))
                  }
                  options={[
                    { value: "USD" },
                    { value: "EUR" },
                    { value: "GBP" }
                  ]}
                />
              </Label>
            </div>

            <Label title="Date" htmlFor="date" required>
              <Input
                id="date"
                type="date"
                initialValue={formData.date}
                onValueChange={(value: string) =>
                  setFormData((prev) => ({ ...prev, date: value }))
                }
                required
              />
            </Label>

            <Label title="Merchant" htmlFor="merchant">
              <Input
                id="merchant"
                type="text"
                initialValue={formData.merchant}
                onValueChange={(value: string) =>
                  setFormData((prev) => ({ ...prev, merchant: value }))
                }
                placeholder="e.g., Restaurant Name"
              />
            </Label>

            <Label title="Category" htmlFor="category" required>
              <Select
                value={formData.category}
                setValue={(value: string) =>
                  setFormData((prev) => ({ ...prev, category: value }))
                }
                options={[
                  { value: "meals" },
                  { value: "travel" },
                  { value: "home_office" },
                  { value: "training" },
                  { value: "software" },
                  { value: "supplies" }
                ]}
              />
            </Label>

            <Label title="Description" htmlFor="description">
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value
                  }))
                }
                placeholder="e.g., Client lunch meeting"
                rows={3}
              />
            </Label>

            <div className="flex gap-2 justify-end mt-6">
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!formData.amount || !formData.category}
              >
                Submit Expense
              </Button>
            </div>
          </div>
        )}

        {step === "submitting" && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader size={48} />
            <p className="mt-4 text-gray-600">Submitting your expense...</p>
          </div>
        )}
      </div>
    </Modal>
  );
};
