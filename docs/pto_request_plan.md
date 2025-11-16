# PTO Request Workflow Implementation Plan (Revised)

This document outlines the plan to refactor the existing application into a dedicated conversational agent for handling PTO (Paid Time Off) requests. The chatbot will become the sole purpose and interface of this application.

## 1. Overall Plan

1.  **Refactor Core UI:** Modify the main application component (`src/app.tsx`) to render a chat interface as the primary and only view for employees.
2.  **Implement Conversational Agent:** Develop the backend AI agent and `POST /api/chat` endpoint that will drive the entire PTO request workflow.
3.  **Implement Manager View:** Create a simple view for managers to handle escalated requests.
4.  **Database Schema:** Implement the `pto_requests` table to store and track all request data.
5.  **Cleanup and Simplification:** Remove all non-essential UI components, routes, and code to focus the application entirely on the chatbot functionality.
6.  **Testing:** Add unit and integration tests for the new conversational flow and policy enforcement.

## 2. AI Agent Logic & Workflow

The core of this feature is the AI agent. It will manage the following workflow within a single conversation:

1.  **Natural Language Understanding (NLU):** The agent will parse the user's initial request (e.g., "I need to take a vacation in July") using an LLM to extract intents and entities like dates and duration.

2.  **Conversational Information Gathering:** If the initial request is incomplete, the agent will enter a clarification loop, asking the user for the missing details (e.g., "What are the exact start and end dates for your vacation?").

3.  **Policy and Data Retrieval:** Once all necessary information is gathered, the agent will retrieve data to make a decision:
    *   **Employee Data:** Fetch the user's role (e.g., 'Junior Employee', 'Senior Employee') and PTO balance.
    *   **Policy Rules:** Query the `employee_handbook.md` (ingested into a Vector DB) to get PTO policies like auto-approval limits and blackout periods.
    *   **Existing Requests:** Query the `pto_requests` table to check for conflicting approved PTO.

4.  **Automated Decision Engine:** Using the retrieved data, the agent will automatically apply the business logic:
    *   **DENY:** For clear policy violations (e.g., blackout period, insufficient balance).
    *   **APPROVE:** For requests within the auto-approval threshold for the employee's role.
    *   **ESCALATE:** For valid requests that exceed the auto-approval threshold.

5.  **Action and Response:** The agent will finalize the process by:
    *   Updating the `pto_requests` table with the final status (`approved`, `denied`, or `pending_approval`).
    *   If escalated, triggering a notification to the manager.
    *   Providing a clear, final response to the user in the chat, confirming the outcome.

## 3. Database Schema Changes

The `pto_requests` table is essential. The schema is unchanged.

**Table: `pto_requests`**

| Column        | Type      | Constraints/Notes                               |
|---------------|-----------|-------------------------------------------------|
| `id`          | `TEXT`    | Primary Key, UUID                               |
| `employee_id` | `TEXT`    | Foreign Key to `users.id`                       |
| `manager_id`  | `TEXT`    | Foreign Key to `users.id` (the approver)        |
| `start_date`  | `TEXT`    | ISO 8601 date string (e.g., "YYYY-MM-DD")       |
| `end_date`    | `TEXT`    | ISO 8601 date string (e.g., "YYYY-MM-DD")       |
| `reason`      | `TEXT`    | Reason for the time off request                 |
| `status`      | `TEXT`    | `pending_approval`, `approved`, or `denied`     |
| `created_at`  | `TEXT`    | ISO 8601 timestamp, set on creation             |
| `updated_at`  | `TEXT`    | ISO 8601 timestamp, updated on any change       |

## 4. Backend API Endpoints (in `src/server.ts`)

The API will be simplified to focus on the conversational experience.

-   **`POST /api/chat`**:
    -   **Action:** The primary endpoint for all user interaction. It receives the user's message and orchestrates the entire AI agent workflow.
    -   **Body:** `{ message: string, conversation_id: string }`
    -   **Response:** The agent's reply to the user.

-   **`GET /api/manager/pto-requests`**:
    -   **Action:** Retrieves all PTO requests escalated to the currently authenticated manager.
    -   **Response:** An array of PTO request objects with `status: 'pending_approval'`.

-   **`PUT /api/manager/pto-requests/:id`**:
    -   **Action:** Allows a manager to manually approve or deny an escalated request.
    -   **Params:** `id` - The ID of the PTO request.
    -   **Body:** `{ status: 'approved' | 'denied' }`
    -   **Response:** The updated PTO request object.

## 5. Frontend Implementation

The frontend will be refactored to be a dedicated chat application.

-   **`src/app.tsx` Modification:**
    -   This file will be modified to remove any existing routing and non-chat UI.
    -   It will be the primary container that renders the `ChatInterface.tsx` for standard users.
    -   It will conditionally render the `ManagerApprovalView.tsx` if the logged-in user is a manager with pending approvals.

-   **`ChatInterface.tsx` (New Component):**
    -   The main component for the PTO feature. It will provide a chat window for the user to interact with the AI agent.

-   **`ManagerApprovalView.tsx` (New Component):**
    -   A simple dashboard for managers to view and act upon escalated requests.

## 6. Code Cleanup and Removal

To align with the new vision of a dedicated chatbot, a thorough cleanup will be performed:
-   **Component Removal:** Audit and remove all unused React components from `src/components/`. Components related to a general website layout (e.g., those in `src/components/orbit-site/`) are prime candidates for removal.
-   **Route Removal:** Remove all routes and navigation elements that are not related to the chat or manager approval flow.
-   **Styling Cleanup:** Remove any CSS from `src/styles.css` that is no longer used after component removal.

This step is critical to simplifying the codebase and focusing the application on its new, singular purpose.
