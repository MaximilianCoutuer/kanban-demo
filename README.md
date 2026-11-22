# Kanban demonstration

A deliberately small Kanban board for a technical session, using Angular for the client and .NET for the API. The application is intended to demonstrate the core workflow, not to provide production-grade persistence or project-management features.

## Features

- Create, edit, and delete tasks.
- Move tasks among **To Do**, **In Progress**, and **Done**.
- Set task priority to **Low**, **Medium**, or **High**.
- Filter tasks by status and priority.
- Optionally associate a task with a GitHub issue.

## Architecture

The application has two main parts:

- **Angular client** — presents the board, task editing controls, and status/priority filters. It calls the API rather than owning the authoritative task collection.
- **.NET API** — exposes the task operations and keeps the task collection in memory. The API is the single source of truth while the application process is running.

The task model should contain the task's identifying and descriptive information, status, priority, and an optional GitHub issue reference. Keep status and priority to the small, explicit sets above. The GitHub association is optional; the core board must work without GitHub access.

## Architectural decisions

| Decision | Why |
| --- | --- |
| Separate Angular UI from a .NET API | Demonstrates a common client/API boundary and keeps UI concerns independent from task operations. |
| Use in-memory storage | Makes the demo easy to run without database setup and keeps attention on the application flow. Data is intentionally lost when the API process restarts. |
| Keep status and priority as constrained values | The board has a fixed, small workflow; constrained values make filtering and transitions straightforward and prevent unnecessary configuration. |
| Make the GitHub issue link optional | Allows the board to be demonstrated independently, while showing how an external reference can be attached to a task. |
| Avoid expanding beyond the listed task workflow | Keeps the technical-session example understandable and focused. |

## Development guidance

Keep the API and Angular client simple and use their established project conventions. If the architecture, persistence strategy, or supported feature scope changes materially, update this document and the relevant project setup instructions.

### Session Git hook

The repository's Copilot hooks use Node.js and Git to record a clean worktree at session start and commit and push changes on the current branch when the session ends, not when a subagent or individual turn finishes. A new session must load the hooks first. The hook does not create a branch, and uses the branch's upstream or `origin` if there is none. Git credentials must already be configured for non-interactive pushing.

The hook refuses to operate if the worktree was dirty at session start, the branch changed, or the start snapshot is missing. It stages all non-ignored changes present at session end: it cannot distinguish agent changes from other changes made concurrently in the same worktree. Avoid sharing the worktree during a session and ensure unignored files do not contain secrets. It also runs on aborted or failed sessions, so it may commit incomplete work. A failed push leaves the commit locally for a manual retry; abrupt termination can prevent the hook from running.
