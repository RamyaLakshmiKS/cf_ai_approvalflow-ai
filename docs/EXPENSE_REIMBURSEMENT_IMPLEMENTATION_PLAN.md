# Expense Reimbursement Feature Implementation Plan

**Last Updated:** November 2025  
**Status:** Design & Planning  
**Owner:** Engineering Team  
**Related:** PTO Feature, ApprovalFlow AI MVP

---

## Executive Summary

This document outlines the complete implementation plan for the **Expense Reimbursement** feature in ApprovalFlow AI. The feature is **receipt-first**: employees upload receipts first, the AI agent extracts and parses receipt data (amount, date, merchant, items), verifies the details with the employee, then submits for validation against company policy with auto-approval or escalation.

**Key Components:**
- **Receipt-first workflow**: Upload receipt → AI parses → User confirms → Validation
- Database schema for receipt storage and extraction results
- AI-powered OCR for receipt data extraction
- Policy validation against employee handbook
- Enhanced UI with file upload as primary input
- New agent tools for receipt processing and expense management
- Workflow automation with escalation logic

---

## 1. Database Schema Changes

### 1.1 New Tables & Modifications

#### A. Receipt Storage Table (`receipt_uploads`)

**Purpose:** Store receipt metadata and OCR extraction results

```sql
-- migrations/0009_create_receipt_uploads_table.sql
CREATE TABLE receipt_uploads (
  id TEXT PRIMARY KEY,
  expense_request_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL, -- e.g., 'image/jpeg', 'application/pdf'
  file_size INTEGER NOT NULL, -- bytes
  file_data BLOB, -- Store file as base64 or binary for MVP (no R2)
  upload_date INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  ocr_status TEXT DEFAULT NULL, -- 'pending', 'completed', 'failed'
  extracted_data JSONB, -- Extracted data from OCR: {amount, currency, date, merchant}
  processing_errors TEXT, -- Error messages if extraction failed
  created_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (expense_request_id) REFERENCES expense_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_receipt_uploads_expense ON receipt_uploads(expense_request_id);
CREATE INDEX idx_receipt_uploads_status ON receipt_uploads(ocr_status);
```

#### B. Enhanced `expense_requests` Table

**Current State Analysis:**
- Already has `receipt_url` and `has_receipt` fields
- Needs fields for AI validation results and auto-approval logic

**Modifications:**
```sql
-- Add to migrations/0010_enhance_expense_requests_table.sql
ALTER TABLE expense_requests ADD COLUMN ai_validation_status TEXT; 
  -- 'not_validated', 'validated', 'failed'

ALTER TABLE expense_requests ADD COLUMN ai_validation_notes TEXT; 
  -- JSON string containing validation details

ALTER TABLE expense_requests ADD COLUMN policy_violations TEXT; 
  -- JSON array of violations if any

ALTER TABLE expense_requests ADD COLUMN auto_approved BOOLEAN DEFAULT 0;

ALTER TABLE expense_requests ADD COLUMN escalation_reason TEXT; 
  -- Reason why escalated to manager

ALTER TABLE expense_requests ADD COLUMN employee_level TEXT; 
  -- Copy of employee level at time of submission (for audit)

ALTER TABLE expense_requests ADD COLUMN submission_method TEXT DEFAULT 'manual';
  -- 'manual', 'chat_ai', 'api'

ALTER TABLE expense_requests ADD COLUMN receipt_validation_errors TEXT;
  -- Errors from OCR processing or receipt validation (required field)

-- Add composite index for queries
CREATE INDEX idx_expense_status_employee ON expense_requests(status, employee_id, created_at DESC);
```

#### C. Expense Category & Policy Table 

**Update:** Policies are now read directly from the employee handbook using the AI search tool. This eliminates the need for a separate `expense_policies` database table.

### 1.2 Schema Migration Order

```
0009_create_receipt_uploads_table.sql
0010_enhance_expense_requests_table.sql
```

**Note:** Expense policies are read from the employee handbook via the `search_employee_handbook` tool. No separate `expense_policies` table is needed.

---

## 2. Ideal Workflow for Expense Reimbursement

### 2.1 Complete User Journey (Sequence Diagram)

```
Employee Input → Agent Requests Receipt → User Uploads Receipt → AI Parses Receipt → 
Agent Shows Details & Asks Confirmation → User Confirms → AI Validates Policy → 
Auto-Approve/Escalate → Manager/Notification
```

**Key Difference from PTO:** Receipt is the INPUT, not the optional attachment. The workflow is:
1. **Receipt First** - Upload before any validation
2. **Parse & Verify** - AI extracts data and asks user to confirm
3. **Policy Check** - After user confirms, check against policies
4. **Decision** - Auto-approve or escalate

### 2.2 Step-by-Step Workflow

#### Phase 1: Receipt Capture & Parsing (Receipt-First Approach)
1. **Employee Initiates Request**
   - User sends chat message: _"I need to be reimbursed for a meal"_ or _"I have an expense to submit"_
   - Agent **immediately asks for receipt**: "Let's start by uploading your receipt. Please attach the receipt image or PDF."
   - Agent does NOT ask for amount, date, or description yet - receipt is the source of truth

2. **Receipt Upload**
   - User uploads receipt image/PDF (mandatory)
   - File size validation (<5MB for MVP)
   - File type validation (jpg, png, pdf)
   - File required - cannot proceed without receipt
   - Create `receipt_uploads` record in database

3. **OCR Extraction (Automatic)**
   - Tool: `process_receipt_ocr()` extracts data automatically
   - Workers AI Vision extracts:
     - **Total amount** (primary amount at bottom)
     - **Currency** (USD, EUR, etc.)
     - **Date** (transaction date from receipt)
     - **Merchant name** (vendor/store name)
     - **Line items** (itemized list if available)
   - Store extracted data in `receipt_uploads.extracted_data`
   - If OCR fails → Show error, ask user to resubmit receipt (may be blurry/damaged)

4. **Agent Verification & Confirmation**
   - Agent displays extracted data to user in formatted message:
     ```
     ✓ Receipt parsed successfully!
     
     **Merchant:** Michelin Restaurant
     **Date:** November 15, 2025
     **Items:**
       - Dinner meal: $120.00
       - Tax: $18.00
       - Tip: $12.00
     **Total:** $150.00
     **Currency:** USD
     
     Is this information correct? (yes/no)
     ```
   - User confirms: "yes" → proceed to Phase 2
   - User says "no" → Ask which field is wrong, allow user to correct specific fields
   - User can manually override extracted values if OCR misread

#### Phase 2: Category & Description (After Receipt Confirmed)
5. **Collect Remaining Details** (now that receipt is verified)
   - Agent asks: "What category best describes this expense?"
   - Options: Meals, Travel, Training, Software, Supplies, Home Office
   - Agent asks: "Can you provide a brief description or reason for this expense?"
   - User input: "Client lunch with Product team"
   - Agent confirms: "Perfect! Let me validate this against company policy..."

#### Phase 3: Policy Validation
6. **Get Employee Info**
   - Tool: `get_current_user()` → fetch employee level (junior/senior)
   - Load employee's expense history
   - Get manager info for escalations

7. **Policy Lookup from Handbook**
   - Query employee handbook via `search_employee_handbook` tool
   - Ask: "What is the auto-approval limit for expenses for a [junior/senior] employee?"
   - Ask: "What are the non-reimbursable expenses?"

8. **Validate Against Policy**
   - Tool: `validate_expense_policy()` with:
     - Extracted amount vs. auto-approval limit
     - Receipt verification (now guaranteed present)
     - Category validity
     - Non-reimbursable item check
   - Returns: `is_valid`, `can_auto_approve`, `violations[]`

#### Phase 4: Decision & Action
9. **Auto-Approval Decision**
   ```
   IF (receipt_valid) AND
      (amount ≤ limit) AND 
      (no violations) THEN
     → AUTO_APPROVE
   ELSE IF (violations exist) THEN
     → ESCALATE_TO_MANAGER
   ELSE IF (amount exceeds limit) THEN
     → ESCALATE_TO_MANAGER
   ELSE
     → DENY with reason
   ```

10. **Create Expense Request**
    - Tool: `submit_expense_request()` with status
    - Store in `expense_requests` table
    - Link receipt via `expense_request_id`
    - Log AI validation notes

11. **Update Balance & Audit**
    - If auto-approved: Update reimbursement tracking
    - Tool: `log_audit_event()` for compliance

#### Phase 5: Manager Review (If Escalated)
12. **Manager Notification** (if escalated)
    - Notify manager of escalated expense
    - Include: Employee info, extracted receipt data, category, policy violation reasons

13. **Manager Review Flow**
    - Manager views: Receipt image, extracted data, AI validation notes, policy rules
    - Option to approve/deny with reason

14. **Employee Notification**
    - On approval: _"Your $150 meal expense has been approved!"_
    - On denial: _"Your expense was denied: reason_"_

### 2.3 Decision Tree

```
┌────────────────────────────────────────────┐
│   Employee Initiates Expense Request       │
│   "I need reimbursement for a meal"        │
└──────────────────┬─────────────────────────┘
                   │
        ┌──────────▼──────────────┐
        │ Agent Requests Receipt  │
        │ Upload image or PDF     │
        └──────────────┬──────────┘
                       │
        ┌──────────────▼──────────────┐
        │ User Uploads Receipt        │
        │ File validation (<5MB)      │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ OCR Extract Receipt Data    │
        │ (Amount, Date, Merchant)   │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ Agent Shows Extracted Data  │
        │ "Is this correct?"          │
        └──────┬──────────────┬───────┘
               │              │
            NO │              │ YES
               │              │
     ┌─────────▼──┐    ┌──────▼─────────────┐
     │User Corrects   │Ask Category &       │
     │Fields          │Description          │
     └─────────┬──┘    └──────┬─────────────┘
               │              │
               └──────┬───────┘
                      │
         ┌────────────▼─────────────┐
         │Query Handbook Policies   │
         │(Auto-approve limit, etc) │
         └────────────┬─────────────┘
                      │
         ┌────────────▼─────────────┐
         │Validate vs. Policies     │
         │Check: Amount, Limits,    │
         │Violations                │
         └──────┬──────────┬────────┘
                │          │
             OK │          │ VIOLATIONS FOUND
                │          │
          ┌─────▼──┐  ┌────▼──────────────┐
          │✅      │  │⏱ ESCALATE         │
          │AUTO-   │  │TO_MANAGER         │
          │APPROVE │  └────┬──────────────┘
          └─────┬──┘       │
                │          │
          ┌─────▼──────────▼──────────┐
          │Update Balance & Log Audit │
          │(if auto-approved)         │
          └─────┬──────────┬──────────┘
                │          │
           ┌────▼──────────▼──┐
           │Notify Employee   │
           │                  │
           │ Approved: ✅     │
           │ Escalated: ⏱     │
           └──────────────────┘
```
        │  │ │  │   OK │          VIOLATION
        │  │ │  │      │              │
        │  │ESCALATE   │          ESCALATE
        │  │           │              │
        │  └───┬───────┘              │
        │      │                      │
        │  AUTO-APPROVE               │
        │      │                      │
        ▼      ▼                      ▼
      DENY  APPROVED              MANAGER REVIEW
                                      │
                              ┌───────┴────────┐
                              │                │
                          APPROVE          DENY
```

---

## 3. Receipt Processing Tool Architecture

### 3.1 Receipt Processing Service

**File:** `src/tools/receipt-processor.ts`

This service handles end-to-end receipt processing:

```typescript
interface ReceiptProcessingResult {
  receipt_id: string;
  extracted_amount: number;
  extracted_currency: string;
  extracted_date: string;
  merchant_name: string;
  line_items: Array<{
    description: string;
    amount: number;
  }>;
  confidence_score: number; // 0-1
  warnings: string[];
}

interface ReceiptUploadRequest {
  file: File; // From FormData
  expense_request_id: string;
  submitted_amount: number;
  submitted_category: string;
}
```

#### Tool: `process_receipt_image`

**Description:** Processes a receipt image/PDF via OCR extraction and validates against the submitted expense.

**Parameters:**
- `file_data`: Base64-encoded file content
- `file_name`: Original filename
- `file_type`: MIME type
- `expense_request_id`: Link to expense
- `submitted_amount`: Expected amount from form

**Execution Steps:**

1. **Optional: Upload to R2 (for large files)**
   ```typescript
   // For files > 500KB, store in R2 for audit trail
   if (fileBuffer.byteLength > 500 * 1024) {
     const key = `receipts/${expense_id}/${timestamp}-${filename}`;
     await env.RECEIPT_STORAGE.put(key, fileBuffer, {
       httpMetadata: { contentType: fileMimeType },
       customMetadata: { expense_id, uploader_id: userId }
     });
   }
   ```

2. **Create Receipt Record**
   ```typescript
   const receiptId = crypto.randomUUID();
   await env.APP_DB.prepare(
     `INSERT INTO receipt_uploads (
        id, expense_request_id, file_name, file_type, file_size,
        upload_status, ocr_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
   ).bind(receiptId, expenseId, filename, fileType, fileSize, 'processing', 'pending').run();
   ```

3. **Extract Text via Workers AI Vision (Direct Processing)**
   ```typescript
   // Convert file to base64 or URL for AI processing
   const base64Data = Buffer.from(fileBuffer).toString('base64');
   
   const ocrResponse = await env.AI.run(
     '@cf/llava-1.5-7b-gguf',
     {
       prompt: `Extract receipt data as JSON: {
         amount: number (total),
         currency: string,
         date: string (YYYY-MM-DD),
         merchant: string,
         items: [{description, amount}]
       }`,
       image: [{ data: base64Data, type: 'base64' }]
     }
   );
   ```

4. **Parse & Validate Extracted Data**
   ```typescript
   const extracted = JSON.parse(ocrResponse.response);
   
   // Validate
   const discrepancies = [];
   if (Math.abs(extracted.amount - submitted_amount) > 0.01) {
     discrepancies.push(
       `Amount mismatch: receipt shows $${extracted.amount}, submitted $${submitted_amount}`
     );
   }
   
   // Store results
   await env.APP_DB.prepare(
     `UPDATE receipt_uploads 
      SET extracted_data = ?, ocr_status = ?, upload_status = ?
      WHERE id = ?`
   ).bind(JSON.stringify(extracted), 'completed', 'processed', receiptId).run();
   ```

5. **Return Result**
   ```typescript
   return {
     receipt_id: receiptId,
     extracted_amount: extracted.amount,
     extracted_currency: extracted.currency,
     extracted_date: extracted.date,
     merchant_name: extracted.merchant,
     line_items: extracted.items,
     confidence_score: 0.85, // Mock for now
     warnings: discrepancies
   };
   ```

**MVP Simplification:**
- Skip R2 for files under 500KB
- Store receipt metadata in D1, not file content
- Direct OCR processing within Worker request

### 3.2 Tool: `validate_expense_policy`

**Purpose:** Comprehensive expense validation against all policies

**Parameters:**
- `employee_id`: Employee making request
- `amount`: Expense amount
- `category`: Expense category
- `has_receipt`: Boolean
- `travel_start_date`: Optional, for travel expenses
- `travel_end_date`: Optional, for travel expenses

**Execution:**

```typescript
async execute(params, context) {
  const violations: PolicyViolation[] = [];
  const employee = await get_current_user.execute({ employee_id }, context);
  const policy = await context.env.APP_DB.prepare(
    "SELECT * FROM expense_policies WHERE category = ?"
  ).bind(params.category).first();
  
  if (!policy) {
    violations.push({
      policy: "invalid_category",
      message: `Category '${params.category}' is not recognized.`
    });
  }

  // Check auto-approval limit
  const limit = employee.employee_level === 'senior' 
    ? policy.auto_approval_limit_senior 
    : policy.auto_approval_limit_junior;
  
  if (params.amount > limit) {
    violations.push({
      policy: "exceeds_auto_approval",
      message: `Amount $${params.amount} exceeds auto-approval limit of $${limit} for ${employee.employee_level} employees.`
    });
  }

  // Check receipt requirement
  if (policy.requires_receipt && !params.has_receipt) {
    violations.push({
      policy: "missing_receipt",
      message: "Receipt is required for this category."
    });
  }

  // Check daily limits for meals/per-diem categories
  if (params.category === 'meals') {
    // Query today's meal expenses
    const todayMeals = await context.env.APP_DB.prepare(
      `SELECT SUM(amount) as total FROM expense_requests 
       WHERE employee_id = ? AND category = ? AND date(created_at) = date('now')`
    ).bind(params.employee_id, 'meals').first();
    
    const dailyLimit = 100; // Config
    if ((todayMeals?.total || 0) + params.amount > dailyLimit) {
      violations.push({
        policy: "exceeds_daily_limit",
        message: `Daily meal limit ($${dailyLimit}) would be exceeded.`
      });
    }
  }

  const canAutoApprove = violations.length === 0;
  
  return {
    is_valid: violations.length === 0,
    can_auto_approve: canAutoApprove,
    requires_escalation: violations.length > 0 && limit_check_failed,
    violations,
    auto_approval_limit: limit,
    recommendation: canAutoApprove ? 'AUTO_APPROVE' : 'ESCALATE_TO_MANAGER'
  };
}
```

### 3.3 Tool: `submit_expense_request`

**Purpose:** Create expense request with validated status

**Parameters:**
- `employee_id`: Employee ID
- `category`: Expense category
- `amount`: Amount in USD
- `description`: Description
- `receipt_upload_id`: Optional receipt ID
- `status`: 'auto_approved', 'pending', 'denied'
- `approval_type`: 'auto', 'manual'
- `validation_notes`: JSON string of validation results

**Result:**
- Returns `{ request_id, status, message }`
- Updates audit log
- If auto-approved: sends confirmation message to employee

---

## 4. UI Changes Required

### 4.1 New Components

#### A. `FileUploadInput` Component

**File:** `src/components/file-upload/FileUploadInput.tsx`

```typescript
interface FileUploadInputProps {
  onFileSelected: (file: File) => void;
  onUpload: (file: File) => Promise<{ success: boolean; error?: string }>;
  accept?: string; // 'image/*,application/pdf'
  maxSize?: number; // bytes
  disabled?: boolean;
  isLoading?: boolean;
}

export const FileUploadInput: React.FC<FileUploadInputProps> = ({
  onFileSelected,
  onUpload,
  accept = "image/*,application/pdf",
  maxSize = 10 * 1024 * 1024, // 10MB
  disabled = false,
  isLoading = false
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = e.dataTransfer.files;
    if (files?.length > 0) {
      await processFile(files[0]);
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files?.length > 0) {
      await processFile(files[0]);
    }
  };

  const processFile = async (file: File) => {
    // Validate size
    if (file.size > maxSize) {
      alert(`File size exceeds ${maxSize / 1024 / 1024}MB limit`);
      return;
    }

    // Validate type
    if (!file.type.match(accept)) {
      alert(`File type not accepted. Allowed: ${accept}`);
      return;
    }

    onFileSelected(file);
    
    // Upload
    if (onUpload) {
      const result = await onUpload(file);
      if (!result.success) {
        alert(result.error || "Upload failed");
      }
    }
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-8 text-center 
        transition-colors cursor-pointer
        ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        onChange={handleChange}
        accept={accept}
        disabled={disabled}
        style={{ display: 'none' }}
      />
      
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="btn btn-primary"
      >
        {isLoading ? 'Uploading...' : 'Choose File or Drag Here'}
      </button>
      
      <p className="text-sm text-gray-500 mt-2">
        Supported: Images (JPG, PNG) or PDF, max {maxSize / 1024 / 1024}MB
      </p>

      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="mt-4">
          <progress value={uploadProgress} max="100" className="w-full" />
          <p className="text-sm">{uploadProgress}%</p>
        </div>
      )}
    </div>
  );
};
```

#### B. `ReceiptPreview` Component

**File:** `src/components/receipt-preview/ReceiptPreview.tsx`

```typescript
interface ReceiptPreviewProps {
  receiptUrl: string;
  extractedData?: {
    amount: number;
    currency: string;
    date: string;
    merchant: string;
  };
  isLoading?: boolean;
  onRemove?: () => void;
}

export const ReceiptPreview: React.FC<ReceiptPreviewProps> = ({
  receiptUrl,
  extractedData,
  isLoading = false,
  onRemove
}) => {
  return (
    <Card className="mt-4">
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          {receiptUrl.endsWith('.pdf') ? (
            <FileText size={48} />
          ) : (
            <img 
              src={receiptUrl} 
              alt="Receipt" 
              className="w-32 h-32 object-cover rounded"
            />
          )}
        </div>
        
        {extractedData && (
          <div className="flex-1">
            <h3 className="font-semibold">Extracted Data</h3>
            <dl className="text-sm">
              <dt className="font-medium">Merchant:</dt>
              <dd>{extractedData.merchant}</dd>
              
              <dt className="font-medium mt-1">Amount:</dt>
              <dd>{extractedData.currency} {extractedData.amount}</dd>
              
              <dt className="font-medium mt-1">Date:</dt>
              <dd>{extractedData.date}</dd>
            </dl>
          </div>
        )}
        
        {onRemove && (
          <button 
            onClick={onRemove}
            className="flex-shrink-0 text-gray-500 hover:text-red-500"
          >
            <Trash size={20} />
          </button>
        )}
      </div>
    </Card>
  );
};
```

#### B. `ExpenseForm` Component

**File:** `src/components/expense-form/ExpenseForm.tsx`

```typescript
interface ExpenseFormProps {
  onSubmit: (data: ExpenseSubmission) => Promise<void>;
  isLoading?: boolean;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({ onSubmit, isLoading }) => {
  const [formData, setFormData] = useState({
    category: 'meals',
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    receipt_file: null as File | null // REQUIRED
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const handleFileSelected = (file: File) => {
    setFormData(prev => ({ ...prev, receipt_file: file }));
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    
    if (!formData.category) errors.category = 'Category is required';
    if (!formData.amount || parseFloat(formData.amount) <= 0) 
      errors.amount = 'Valid amount is required';
    if (!formData.description) errors.description = 'Description is required';
    if (!formData.receipt_file) 
      errors.receipt_file = 'Receipt is required for all expenses'; // MANDATORY
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    try {
      // Receipt upload is mandatory - file will always exist here
      const uploadResult = await uploadReceipt(formData.receipt_file!);
      const receiptUploadId = uploadResult.receipt_id;

      await onSubmit({
        category: formData.category,
        amount: parseFloat(formData.amount),
        description: formData.description,
        date: formData.date,
        receipt_upload_id: receiptUploadId
      });
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="category">Category</Label>
        <Select
          id="category"
          value={formData.category}
          onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
          options={[
            { value: 'meals', label: 'Meals' },
            { value: 'travel', label: 'Travel' },
            { value: 'home_office', label: 'Home Office' },
            { value: 'training', label: 'Training' },
            { value: 'software', label: 'Software' },
            { value: 'supplies', label: 'Supplies' }
          ]}
          error={validationErrors.category}
        />
      </div>

      <div>
        <Label htmlFor="amount">Amount (USD)</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
          placeholder="0.00"
          onValueChange={(val) => setFormData(prev => ({ ...prev, amount: val }))}
          error={validationErrors.amount}
        />
      </div>

      <div>
        <Label htmlFor="date">Date of Expense</Label>
        <Input
          id="date"
          type="date"
          value={formData.date}
          onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
          onValueChange={(val) => setFormData(prev => ({ ...prev, date: val }))}
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="E.g., Client lunch at Michelin-star restaurant"
          rows={3}
          onValueChange={(val) => setFormData(prev => ({ ...prev, description: val }))}
          error={validationErrors.description}
        />
      </div>

      <div>
        <Label>Receipt <span className="text-red-500">*</span> Required</Label>
        <FileUploadInput
          onFileSelected={handleFileSelected}
          onUpload={uploadReceipt}
          accept="image/*,application/pdf"
          maxSize={5 * 1024 * 1024} // 5MB limit
          disabled={isLoading}
        />
        
        {validationErrors.receipt_file && (
          <p className="text-red-600 text-sm mt-2">{validationErrors.receipt_file}</p>
        )}
        
        {formData.receipt_file && (
          <p className="text-sm text-green-600 mt-2">
            ✓ {formData.receipt_file.name} selected ({(formData.receipt_file.size / 1024).toFixed(1)}KB)
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? 'Submitting...' : 'Submit Expense'}
      </Button>
    </form>
  );
};
```

### 4.2 Chat Interface Integration

**File:** `src/app.tsx` - Enhancement to chat interface

```typescript
// Add to chat message handler
const handleAgentSubmit = async (
  e: React.FormEvent,
  extraData: Record<string, unknown> = {}
) => {
  e.preventDefault();
  
  // Check if user is attaching a file for expense submission
  const hasExpenseAttachment = extraData.expense_receipt_file;
  
  if (hasExpenseAttachment) {
    // Encode file to base64 for transmission
    const file = extraData.expense_receipt_file as File;
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    
    const message = `${agentInput}
[ATTACHMENT: Receipt]
File: ${file.name}
Type: ${file.type}
Size: ${file.size}
Base64: ${base64.substring(0, 100)}...`;
    
    // Send message with attachment metadata
    await agent.sendMessage({
      content: message,
      metadata: {
        hasAttachment: true,
        attachmentType: 'receipt',
        fileName: file.name,
        fileType: file.type,
        fileBase64: base64
      }
    });
  } else {
    // Regular message without attachment
    await agent.sendMessage(agentInput);
  }
  
  setAgentInput("");
};
```

### 4.3 Dashboard/History Component

**File:** `src/components/expense-history/ExpenseHistory.tsx`

```typescript
export const ExpenseHistory: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all');

  useEffect(() => {
    // Fetch from API
    fetchExpenses();
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['all', 'pending', 'approved', 'denied'] as const).map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded ${
              filter === status ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {expenses.map(expense => (
          <Card key={expense.id} className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{expense.description}</p>
                <p className="text-sm text-gray-600">
                  {expense.category} • {new Date(expense.created_at * 1000).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold">${expense.amount}</p>
                <span className={`text-sm px-2 py-1 rounded ${
                  expense.status === 'approved' ? 'bg-green-100 text-green-800' :
                  expense.status === 'denied' ? 'bg-red-100 text-red-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {expense.status}
                </span>
              </div>
            </div>
            
            {expense.receipt_url && (
              <a 
                href={expense.receipt_url} 
                target="_blank"
                className="text-blue-500 hover:underline text-sm mt-2"
              >
                View Receipt
              </a>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};
```

---

## 5. Agent Tools Implementation

### 5.1 New Tools to Add to `src/tools.ts`

```typescript
// Tool 10: Get Expense Policies from Employee Handbook
const get_expense_policies: Tool = {
  name: "get_expense_policies",
  description: "Retrieves expense policies from the employee handbook, including auto-approval limits, per diem rates, and non-reimbursable items.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language query about expense policy (e.g., 'What is the auto-approval limit for a junior employee?', 'What are non-reimbursable expenses?')"
      }
    },
    required: ["query"]
  },
  execute: async (params, context) => {
    const { query } = params as { query: string };
    console.log("[TOOL] get_expense_policies called with query:", query);

    // Use the existing search_employee_handbook tool
    return await search_employee_handbook.execute(
      { query: `Expense policy question: ${query}` },
      context
    );
  }
};

// Tool 11: Get Expense History
const get_expense_history: Tool = {
  name: "get_expense_history",
  description: "Retrieves past expense requests for the employee.",
  parameters: { /* ... */ },
  execute: async (params, context) => { /* ... */ }
};

// Tool 12: Validate Expense Policy
const validate_expense_policy: Tool = {
  name: "validate_expense_policy",
  description: "Validates an expense against company policies from the employee handbook and auto-approval limits.",
  parameters: { /* ... */ },
  execute: async (params, context) => { /* ... */ }
};

// Tool 13: Process Receipt OCR
const process_receipt_ocr: Tool = {
  name: "process_receipt_ocr",
  description: "Uploads receipt image and extracts data via OCR.",
  parameters: { /* ... */ },
  execute: async (params, context) => { /* ... */ }
};

// Tool 14: Submit Expense Request
const submit_expense_request: Tool = {
  name: "submit_expense_request",
  description: "Creates an expense request with auto-approval or escalation.",
  parameters: { /* ... */ },
  execute: async (params, context) => { /* ... */ }
};

// Tool 15: Approve Expense Request (Manager Only)
const approve_expense_request: Tool = {
  name: "approve_expense_request",
  description: "Approves a pending expense request (requires manager role).",
  parameters: { /* ... */ },
  execute: async (params, context) => { /* ... */ }
};

// Tool 16: Deny Expense Request (Manager Only)
const deny_expense_request: Tool = {
  name: "deny_expense_request",
  description: "Denies a pending expense request with reason.",
  parameters: { /* ... */ },
  execute: async (params, context) => { /* ... */ }
};
```

### 5.2 Update Tool Registry

```typescript
export const tools: Record<string, Tool> = {
  // ... existing PTO tools ...
  get_expense_history,
  get_expense_policies,
  validate_expense_policy,
  process_receipt_ocr,
  submit_expense_request,
  approve_expense_request,
  deny_expense_request
};
```

---

## 6. Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create database migrations (receipt_uploads, expense_requests enhancements)
- [ ] Implement receipt processing endpoint (direct, in-memory)
- [ ] Basic file validation (size, type)
- [ ] Workers AI Vision integration for OCR
- [ ] Integration with existing `search_employee_handbook` tool

### Phase 2: Tools & Validation (Week 2)
- [ ] Implement `process_receipt_ocr` tool
- [ ] Implement `validate_expense_policy` tool (uses handbook search)
- [ ] Implement `get_expense_policies` tool (wrapper around handbook search)
- [ ] Implement `submit_expense_request` tool
- [ ] Test policy queries against handbook

### Phase 3: Agent Integration (Week 3)
- [ ] Integrate new tools into agent prompt
- [ ] Update `react-agent.ts` to handle expense workflows
- [ ] Test end-to-end expense submission via chat
- [ ] Add manager tools (approve/deny)

### Phase 4: UI Components (Week 4)
- [ ] Build `FileUploadInput` component
- [ ] Build `ReceiptPreview` component
- [ ] Build `ExpenseForm` component
- [ ] Build `ExpenseHistory` component
- [ ] Integrate file upload into chat interface

### Phase 5: Manager Dashboard (Week 5)
- [ ] Create manager dashboard view
- [ ] Display pending expense escalations
- [ ] Implement approval/denial UI
- [ ] Add email notifications

### Phase 6: Testing & Polish (Week 6)
- [ ] Integration tests for full workflow
- [ ] OCR accuracy testing with sample receipts
- [ ] UI/UX refinements
- [ ] Documentation & deployment

---

## 7. Security & Compliance

### 7.1 Data Security

- **File Encryption:** R2 objects encrypted at rest with server-side encryption
- **Access Control:** Restrict receipt access to employee and their manager
- **Virus Scanning:** Implement ClamAV scan via Cloudflare Workers before processing
- **PII Protection:** Redact sensitive data from extracted OCR results

### 7.2 Audit & Compliance

- All expense actions logged to `audit_log` table
- Receipt processing tracked in `receipt_processing_log`
- Immutable audit trail for compliance/disputes
- Data retention: Keep receipts for 7 years per IRS guidelines

### 7.3 Input Validation

- **Receipt is mandatory** - all expenses must have a receipt
- File size limits: 5MB max (for MVP direct processing)
- Allowed file types: JPEG, PNG, PDF only
- Filename sanitization to prevent injection
- Amount validation: Must be positive, max $10,000
- Receipt content must be readable by OCR (min confidence 0.5)

---

## 8. Error Handling & Edge Cases

### 8.1 Common Error Scenarios

| Scenario | Handling |
|----------|----------|
| Receipt missing | Deny immediately - receipt is mandatory |
| File upload fails | Retry with exponential backoff; inform user, request re-upload |
| OCR extraction fails | Display error; ask user to resubmit receipt (may be blurry/damaged) |
| Ambiguous amount (e.g., multiple totals) | Escalate to manager; highlight ambiguity |
| Receipt doesn't match submitted amount | Flag as warning; escalate to manager for verification |
| Employee exceeds category annual limit | Deny with reason; suggest splitting across fiscal year |
| Receipt date is very old (> 90 days) | Flag warning but escalate to manager for approval |
| Duplicate expense (same receipt hash, amount, date) | Check and deny; suggest reviewing recent submissions |

### 8.2 Recovery Strategies

- Implement idempotency for receipt uploads (deduplicate by file hash)
- Store failed OCR results for manual retry
- Allow employee to edit and resubmit denied requests
- Implement rate limiting on submissions (1 per minute)

---

## 9. Future Enhancements

### 9.1 Post-MVP Features

- **Multi-Receipt Expenses:** Support bundling multiple receipts for single report
- **Bulk Submissions:** Manager batch approval/denial
- **Receipt Metadata:** Extract vendor tax ID, GST for international reimbursements
- **Analytics Dashboard:** Spending trends by category, employee, manager
- **Integration:** Connect to accounting software (QuickBooks, NetSuite)
- **Mobile App:** iOS/Android native apps for on-the-go submissions
- **Voice Submission:** "Submit expense of $45 for lunch today"

### 9.2 Advanced AI Features

- **Fraud Detection:** Flag suspicious patterns (e.g., same receipt submitted twice)
- **Policy Learning:** AI adapts policy recommendations based on company data
- **Multi-Language:** Support receipts in any language
- **Receipt Matching:** Correlate expenses with corporate credit card transactions

---

## 10. Testing & QA

### 10.1 Test Scenarios

| Test Case | Scenario | Expected Outcome |
|-----------|----------|------------------|
| T1 | Junior employee submits $75 meal | Auto-approved |
| T2 | Junior employee submits $200 travel | Escalated to manager |
| T3 | Receipt amount differs by $0.50 | Warning but allowed |
| T4 | Missing required receipt | Expense rejected - receipt mandatory |
| T5 | Manager approves escalated expense | Employee notified |
| T6 | Manager denies with reason | Employee receives reason |
| T7 | File upload fails (corrupted image) | Error message to user, asked to re-upload |
| T8 | OCR extraction fails | Error message, user asked to resubmit receipt |
| T9 | Receipt amount differs by $0.50 | Warning highlighted but still processes |
| T10 | Concurrent submissions | Both tracked separately |

## 10.2 Sample Test Data

```sql
-- Insert test employees
INSERT INTO users VALUES
  ('emp_1', 'alice', ..., 'junior'),
  ('emp_2', 'bob', ..., 'senior'),
  ('mgr_1', 'carol', ..., 'manager');

-- Insert test expenses
-- Policy validation will be done via handbook search, not database queries
INSERT INTO expense_requests VALUES
  ('exp_1', 'emp_1', 'meals', 75, 'USD', 'Client lunch', 'pending', ...);
```

**Note:** Policies are read from employee handbook dynamically. No policy seed data needed.

---

## 11. Configuration & Environment Variables

### 11.1 wrangler.jsonc Updates (MVP - No R2)

```jsonc
{
  // No changes needed - policies are read from handbook via AI search
  "env": {
    "production": {
      "vars": {
        "RECEIPT_MAX_SIZE": "5242880", // 5MB in bytes (max for direct processing)
        "OCR_CONFIDENCE_THRESHOLD": "0.75",
        "AUTO_APPROVAL_ENABLED": "true"
      }
    }
  }
}
```

**Note:** Expense policies are read dynamically from the employee handbook using the `search_employee_handbook` tool. No separate policy table or configuration needed.

### 11.2 Environment Variables

- `RECEIPT_MAX_SIZE`: Max file size (bytes)
- `OCR_CONFIDENCE_THRESHOLD`: Min confidence for auto-extraction
- `AUTO_APPROVAL_ENABLED`: Enable/disable auto-approval
- `MANAGER_EMAIL_TEMPLATE`: Email template for manager notifications

---

## 12. Documentation & Deployment

### 12.1 User Documentation

- **Employee Guide:** How to submit expenses, best receipt practices
- **Manager Guide:** Reviewing and approving expenses, policy overrides
- **Admin Guide:** Managing policies, audit logs, system configuration

### 12.2 Deployment Checklist

- [ ] Run all database migrations
- [ ] Seed expense_policies table
- [ ] Deploy Worker code updates
- [ ] Configure R2 bucket permissions
- [ ] Test end-to-end workflow in staging
- [ ] Train managers on new dashboard
- [ ] Communicate changes to employees
- [ ] Monitor OCR accuracy in first week
- [ ] Be ready to rollback if issues arise

---

## 13. Appendix: Example API Calls

### 13.1 Receipt-First Expense Submission Workflow

**User Initiates:**
```
User: "I need to be reimbursed for a meal I had yesterday."

Agent Response:
"Great! Let's start by uploading your receipt. Please share the receipt image or PDF.
(This helps us extract the exact amount, merchant, and date.)"
```

**User Uploads Receipt:**
```
User: [Uploads receipt.jpg of Michelin Restaurant invoice]

Agent: "Processing receipt..."
```

**AI Extracts & Confirms:**
```
Agent: "✓ Receipt parsed successfully!

**Merchant:** Michelin Restaurant
**Date:** November 15, 2025
**Items:**
  - Dinner meal: $120.00
  - Tax: $18.00
  - Tip: $12.00
**Total:** $150.00
**Currency:** USD

Is this information correct? (yes/no)"

User: "Yes, that's correct."
```

**Agent Collects Category & Description:**
```
Agent: "Perfect! What category best describes this expense?"
Options: Meals, Travel, Training, Software, Supplies, Home Office

User: "Meals"

Agent: "Can you provide a brief reason for this expense?"

User: "Client lunch with Product team to discuss Q4 roadmap"

Agent: "Great! Let me validate this against company policy..."
```

**Validation & Decision:**
```
Agent: "Checking against handbook policies...

✓ Receipt provided: YES
✓ Amount ($150): Within auto-approval limits for your level
✓ Category (Meals): Allowed
✓ No policy violations found

🎉 Your $150 meal expense has been AUTO-APPROVED!

Reimbursement will be processed within 5-7 business days.
View receipt: [link to receipt image]"
```

### 13.2 Escalation Example (Amount Exceeds Limit)

**User Initiates:**
```
User: "I need to expense a $500 software license for Adobe Creative Cloud (annual)"

Agent: "Let's start by uploading your receipt or invoice."

User: [Uploads invoice.pdf]

Agent: "✓ Receipt parsed successfully!

**Vendor:** Adobe Systems
**Description:** Creative Cloud Annual License
**Total:** $500.00

Is this correct?"

User: "Yes"

Agent: "What's this for?"

User: "Annual software subscription for design work"
```

**Validation Escalation:**
```
Agent: "Checking policy...

✓ Receipt: YES
⚠️ Amount ($500): Exceeds your auto-approval limit ($300 for junior employees)
ℹ️ Category: Software (allowed, requires manager review for amounts >$300)

Escalating to your manager for review...

Your manager Sarah will review this and get back to you within 24 hours.
View receipt: [link]"

[Email to Manager Sarah]: 
"New Expense Escalation
Employee: Alice Chen
Amount: $500
Category: Software
Reason: Adobe Creative Cloud annual license
Receipt: [image preview]
AI Notes: Exceeds junior employee auto-approval limit.
Action Needed: Approve or Deny in Manager Dashboard"
```

### 13.3 Manager Approval Flow

**Manager Dashboard:**
```
Escalated Expenses (3 pending):

1. Alice Chen - $500 Software
   ├─ Receipt: [preview image]
   ├─ Extracted Data:
   │  └─ Vendor: Adobe Systems
   │  └─ Amount: $500.00
   │  └─ Date: Nov 14, 2025
   ├─ Employee Reason: "Adobe Creative Cloud annual license"
   ├─ AI Notes: "Exceeds auto-approval limit. No policy violations detected."
   └─ [Approve Button] [Deny Button]

(Manager clicks Approve)

System Notification to Alice:
"✅ Your $500 software expense has been APPROVED by Sarah Martinez!
Reimbursement will be processed within 5-7 business days."
```

### 13.4 Denial Example (Policy Violation)

**User Attempts Non-Reimbursable Item:**
```
User: "I need to expense my parking for a client visit"

Agent: "Let's upload the parking receipt."

User: [Uploads parking_receipt.pdf showing $45]

Agent: "✓ Receipt parsed!
**Location:** Downtown Parking Garage
**Amount:** $45.00
**Date:** Nov 15, 2025

Correct?"

User: "Yes"

Agent: "Checking handbook policies...

❌ Parking expenses are non-reimbursable per company policy
(Section 6.2 - Travel expenses do not include parking. 
 If parking is required for business travel, it should be combined 
 with hotel/accommodation expenses.)

Your expense cannot be approved.

If you believe this is a business-critical parking expense 
(e.g., airport long-term parking for a business trip), 
please provide additional context and escalate to your manager."
```

---

## 14. Success Metrics

- **Submission Time:** Reduce expense submission from 10 min (manual) to 2 min (AI-assisted receipt-first)
- **Auto-Approval Rate:** Target 75%+ expenses auto-approved (vs. 0% manual)
- **Manager Review Time:** Reduce escalation review from 1 day to <2 hours
- **OCR Accuracy:** >95% match between receipt and extracted data
- **User Satisfaction:** NPS >8 on ease of use and receipt-first workflow
- **Compliance:** 100% audit trail for all expenses, 100% receipt coverage
- **Error Rate:** <2% OCR confidence below threshold requiring user correction

---

## 13. References

- Features Map: `/docs/features_map.md`
- PTO Implementation: `/docs/pto_request_plan.md`
- Auth MVP Plan: `/docs/auth_mvp_plan.md`
- Employee Handbook: `/docs/employee_handbook.md` (Policy source - Single Source of Truth)
- Existing Migrations: `/migrations/`
- Current Tools: `/src/tools.ts`

**Key:** All expense policies are read from the employee handbook via the `search_employee_handbook` tool. The handbook is the single source of truth for policy information.
