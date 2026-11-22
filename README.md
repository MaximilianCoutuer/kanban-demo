# Kanban demonstration

A deliberately small Kanban board for a technical session, using Angular for the client and .NET for the API. The application is intended to demonstrate the core workflow, not to provide production-grade persistence or project-management features.

## Features

- Add tasks with a title, complete them, and delete them.
- View **To Do**, **In Progress**, and **Done** columns. New tasks start in To Do; completing them moves them directly to Done.
- Keep tasks synchronized with the API, including after browser refresh.
- Show request errors without treating failed changes as successful.

Authentication, editing, moving tasks to In Progress, priorities, filtering, and GitHub issue associations are not implemented yet.

## Architecture

The application has two main parts:

- **Angular 21 client** — presents the board and task actions. It calls the API rather than owning the authoritative task collection.
- **.NET 10 API** — exposes task operations and uses Entity Framework Core's in-memory database provider. The API is the single source of truth while the application process is running.

Tasks currently contain a server-generated UUID, a title, and a status (`ToDo`, `InProgress`, or `Done`). Titles are trimmed and must contain 1–200 UTF-16 code units. The board starts empty and data is intentionally lost when the API restarts. There is no background polling: another browser sees changes when it reloads.

## Running locally

Requires the .NET 10 SDK and a Node version supported by Angular 21 (for example Node 22.12+ in the 22.x series). Node 25 is unsupported by Angular even though the checks ran successfully in this session.

Start the API from the repository root:

```powershell
dotnet restore api\Kanban.sln
dotnet run --project api\Kanban.Api --no-launch-profile
```

In another terminal:

```powershell
Set-Location client
npm ci
npm start
```

Open `http://localhost:4200`. Angular proxies `/api` requests to `http://localhost:5000`; no authentication or external database setup is needed. Stop these processes when finished.

API operations:

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/tasks` | Task array |
| POST | `/api/tasks` | Create from `{"title":"My task"}`; returns the created task |
| POST | `/api/tasks/{id}/complete` | Returns the completed task; repeated completion is safe |
| DELETE | `/api/tasks/{id}` | Deletes the task; returns 204 |

Invalid input returns 400; missing task IDs return 404. Errors use Problem Details.

Run automated checks:

```powershell
dotnet test api\Kanban.sln
Set-Location client
npm run build
npm test -- --watch=false
```

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

### QA verification hook

The orchestrator creates a JSON plan outside the integration worktree, before QA runs checks. Use absolute paths and full Git commit IDs. Each check has a unique ID, an existing working directory, an executable, and its argument array; commands run directly, not through a shell. On Windows, use an executable rather than a `.cmd` launcher (for example, invoke npm's CLI JavaScript with Node). For example (replace all paths and IDs for the current run):

```json
{
  "worktree": "C:\\work\\repo",
  "branch": "integration",
  "revision": "0123456789012345678901234567890123456789",
  "commits": ["0123456789012345678901234567890123456789", "0123456789012345678901234567890123456789"],
  "checks": [
    { "id": "unit-tests", "cwd": "C:\\work\\repo", "executable": "node", "args": ["--test", "scripts/example.test.cjs"] }
  ]
}
```

QA runs `node scripts/qa-verification.cjs run <absolute-plan-path> <absolute-result-path>` after completing its test edits. The runner creates a new JSON result and a combined-output `.log` beside it; neither may already exist. The QA handoff contains one line `QA_EVIDENCE_FILE: <absolute-result-path>`. A Copilot `subagentStop` hook appends PASS, FAIL, or BLOCKED for the execution evidence. It checks the plan and log integrity, exit codes, branch, commit ancestry, revision, and a fingerprint of tracked changes and non-ignored untracked files at the start and end of execution and at the hook. Keep the worktree unchanged until the hook finishes. Logs can contain sensitive test output; choose an appropriately protected location and do not commit them.

The hook does not decide which tests are required, whether zero tests ran, or whether acceptance criteria are met; the orchestrator supplies the plan and Verification Gate reviews the output and coverage. Missing hook output is blocked, not a pass. Start a new Copilot session to load the hook and verify it runs in the intended environment. Hooks depend on the Copilot runtime and workspace trust, can be disabled or time out, and are not a security or CI enforcement boundary. The session Git hook operates independently. Use a required CI status check for enforced PR protection.
