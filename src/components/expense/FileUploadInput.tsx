import type React from "react";
import { useRef, useState } from "react";
import { UploadSimple, X } from "@phosphor-icons/react";

interface FileUploadInputProps {
  onFileSelect: (file: File, base64: string) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

export const FileUploadInput: React.FC<FileUploadInputProps> = ({
  onFileSelect,
  onError,
  disabled = false
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File size exceeds 5MB limit. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB.`;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "File type not supported. Please upload JPG, PNG, or PDF.";
    }
    return null;
  };

  const handleFileRead = (file: File) => {
    setIsLoading(true);
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const base64String = reader.result as string;
        setSelectedFile(file);
        onFileSelect(file, base64String);
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Failed to read file";
        onError?.(errorMsg);
      } finally {
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      onError?.("Failed to read file");
      setIsLoading(false);
    };

    reader.readAsDataURL(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files && files.length > 0) {
      const file = files[0];
      const error = validateFile(file);
      if (error) {
        onError?.(error);
      } else {
        handleFileRead(file);
      }
    }
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const error = validateFile(file);
      if (error) {
        onError?.(error);
      } else {
        handleFileRead(file);
      }
    }
  };

  const handleClick = () => {
    if (!disabled && !isLoading) {
      fileInputRef.current?.click();
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="w-full">
      {/* biome-ignore lint/a11y/useSemanticElements: drag-drop requires div for events */}
      <div
        role="button"
        tabIndex={0}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleClick();
          }
        }}
        className={`relative border-2 border-dashed rounded-lg p-8 transition-all cursor-pointer ${
          disabled || isLoading
            ? "opacity-50 cursor-not-allowed bg-gray-100"
            : isDragActive
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 hover:border-gray-400 bg-white"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          accept=".jpg,.jpeg,.png,.pdf"
          disabled={disabled || isLoading}
          className="hidden"
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          {isLoading ? (
            <>
              <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-sm text-gray-600 font-medium">
                Processing receipt...
              </p>
            </>
          ) : selectedFile ? (
            <>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <UploadSimple className="w-6 h-6 text-green-600" />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-900">{selectedFile.name}</p>
                <p className="text-sm text-gray-600">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClear();
                }}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <X className="w-4 h-4" />
                Change file
              </button>
            </>
          ) : (
            <>
              <UploadSimple className="w-12 h-12 text-gray-400" />
              <div className="text-center">
                <p className="text-base font-medium text-gray-900">
                  Drag receipt here or click to browse
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  JPG, PNG, or PDF • Max 5MB
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {selectedFile && !isLoading && (
        <p className="mt-2 text-sm text-green-600 flex items-center gap-1">
          ✓ Receipt ready to submit
        </p>
      )}
    </div>
  );
};
