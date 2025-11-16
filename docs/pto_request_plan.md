# PTO Request Workflow Implementation Plan

This document outlines the plan for implementing the PTO (Paid Time Off) request workflow feature.

## 1. Overall Plan

1.  **Database Schema:** Create a new table `pto_requests` to store all PTO request data.
2.  **Backend API:** Develop API endpoints to handle creating, retrieving, and updating PTO requests.
3.  **Frontend UI:** Build React components for submitting requests, viewing request history, and managing pending requests (for managers).
4.  **Integration:** Integrate the new UI components into the application, likely under a new navigation item.
5.  **Testing:** Add unit and integration tests for the new backend and frontend logic.

## 2. Database Schema Changes

A new table named `pto_requests` will be created with the following schema. This assumes a `users` table already exists for employees and managers.

**Table: `pto_requests`**

| Column        | Type      | Constraints/Notes                               |
|---------------|-----------|-------------------------------------------------|
| `id`          | `TEXT`    | Primary Key, UUID                               |
| `employee_id` | `TEXT`    | Foreign Key to `users.id`                       |
| `manager_id`  | `TEXT`    | Foreign Key to `users.id` (the approver)        |
| `start_date`  | `TEXT`    | ISO 8601 date string (e.g., "YYYY-MM-DD")       |
| `end_date`    | `TEXT`    | ISO 8601 date string (e.g., "YYYY-MM-DD")       |
| `reason`      | `TEXT`    | Reason for the time off request                 |
| `status`      | `TEXT`    | `pending`, `approved`, or `denied`              |
| `created_at`  | `TEXT`    | ISO 8601 timestamp, set on creation             |
| `updated_at`  | `TEXT`    | ISO 8601 timestamp, updated on any change       |

## 3. Backend API Endpoints (in `src/server.ts`)

We will use Hono for routing. The following endpoints will be created under the `/api` prefix.

-   **`POST /api/pto-requests`**:
    -   **Action:** Creates a new PTO request.
    -   **Body:** `{ startDate: string, endDate: string, reason: string }`
    -   **Response:** The newly created PTO request object.

-   **`GET /api/pto-requests`**:
    -   **Action:** Retrieves all PTO requests for the currently authenticated user.
    -   **Response:** An array of PTO request objects.

-   **`GET /api/manager/pto-requests`**:
    -   **Action:** Retrieves all PTO requests where the currently authenticated user is the manager.
    -   **Response:** An array of PTO request objects submitted by their direct reports.

-   **`PUT /api/manager/pto-requests/:id`**:
    -   **Action:** Updates the status of a specific PTO request (approve/deny).
    -   **Params:** `id` - The ID of the PTO request.
    -   **Body:** `{ status: 'approved' | 'denied' }`
    -   **Response:** The updated PTO request object.

## 4. Frontend Components (in `src/components/`)

New components will be created to build the user interface for this feature.

-   **`PtoRequestForm.tsx`**:
    -   A form for employees to submit a new PTO request.
    -   Inputs for start date, end date, and a textarea for the reason.
    -   Will use the `POST /api/pto-requests` endpoint.

-   **`PtoRequestList.tsx`**:
    -   Displays a list of PTO requests for the current user.
    -   Shows the status of each request (`pending`, `approved`, `denied`).
    -   Will fetch data from `GET /api/pto-requests`.

-   **`ManagerApprovalView.tsx`**:
    -   A dashboard for managers to view and manage pending requests from their team.
    -   Displays a list of pending requests with details.
    -   Provides "Approve" and "Deny" buttons for each request.
    -   Will use `GET /api/manager/pto-requests` and `PUT /api/manager/pto-requests/:id`.

-   **`PtoPage.tsx` (New page component)**:
    -   A container component that combines `PtoRequestForm` and `PtoRequestList` for regular employees.
    -   Will conditionally render `ManagerApprovalView` if the user is a manager.

## 5. Integration and Routing

-   A new route `/pto` will be added in `src/app.tsx` to render the `PtoPage.tsx` component.
-   A navigation link to `/pto` will be added to the main application layout to make the feature accessible.
