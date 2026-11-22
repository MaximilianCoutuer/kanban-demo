# Kanban API

Requires the .NET 10 SDK. From the repository root:

```powershell
dotnet restore api\Kanban.sln
dotnet run --project api\Kanban.Api --no-launch-profile
```

The API listens at `http://localhost:5000`. Data is held in memory and is lost
when the process stops. Browser clients may access the API using CORS; there is
no authentication.

- `GET /api/tasks` lists tasks ordered by UUID.
- `POST /api/tasks` creates a task from `{"title":"..."}`.
- `POST /api/tasks/{id}/complete` marks a task Done, including if already Done.
- `DELETE /api/tasks/{id}` deletes a task.

Tasks contain `id`, `title`, and `status` (`ToDo`, `InProgress`, or `Done`).
Titles are trimmed and must contain 1–200 UTF-16 code units.

Run the integration tests with `dotnet test api\Kanban.sln`.
