using System.Text.Json;
using Kanban.Api;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://localhost:5000");
var databaseName = Guid.NewGuid().ToString();
builder.Services.AddDbContext<KanbanDbContext>(options =>
    options.UseInMemoryDatabase(databaseName));
builder.Services.AddSingleton<TaskStoreLock>();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseExceptionHandler();

app.MapGet("/api/tasks", (KanbanDbContext db, TaskStoreLock storeLock) =>
{
    lock (storeLock)
    {
        var tasks = db.Tasks.AsNoTracking().AsEnumerable()
            .OrderBy(task => task.Id.ToString(), StringComparer.Ordinal)
            .Select(task => new TaskDto(task.Id, task.Title, task.Status))
            .ToArray();
        return Results.Ok(tasks);
    }
});

app.MapPost("/api/tasks", async (HttpRequest request, KanbanDbContext db, TaskStoreLock storeLock) =>
{
    CreateTaskRequest? input;
    try
    {
        input = await JsonSerializer.DeserializeAsync<CreateTaskRequest>(
            request.Body, new JsonSerializerOptions(JsonSerializerDefaults.Web), request.HttpContext.RequestAborted);
    }
    catch (JsonException)
    {
        return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid JSON");
    }

    var title = input?.Title?.Trim();
    if (string.IsNullOrEmpty(title) || title.Length > 200)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["title"] = ["Title must contain between 1 and 200 characters."]
        });
    }

    lock (storeLock)
    {
        var task = new KanbanTask { Id = Guid.NewGuid(), Title = title, Status = "ToDo" };
        db.Tasks.Add(task);
        db.SaveChanges();
        return Results.Created($"/api/tasks/{task.Id}", new TaskDto(task.Id, task.Title, task.Status));
    }
});

app.MapPost("/api/tasks/{id}/complete", (string id, KanbanDbContext db, TaskStoreLock storeLock) =>
{
    if (!Guid.TryParse(id, out var taskId))
    {
        return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid task ID");
    }

    lock (storeLock)
    {
        var task = db.Tasks.Find(taskId);
        if (task is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Task not found");
        }

        task.Status = "Done";
        db.SaveChanges();
        return Results.Ok(new TaskDto(task.Id, task.Title, task.Status));
    }
});

app.MapDelete("/api/tasks/{id}", (string id, KanbanDbContext db, TaskStoreLock storeLock) =>
{
    if (!Guid.TryParse(id, out var taskId))
    {
        return Results.Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid task ID");
    }

    lock (storeLock)
    {
        var task = db.Tasks.Find(taskId);
        if (task is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Task not found");
        }

        db.Tasks.Remove(task);
        db.SaveChanges();
        return Results.NoContent();
    }
});

app.Run();

public partial class Program
{
}
