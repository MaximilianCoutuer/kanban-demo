using Microsoft.EntityFrameworkCore;

namespace Kanban.Api;

public sealed class KanbanDbContext(DbContextOptions<KanbanDbContext> options) : DbContext(options)
{
    public DbSet<KanbanTask> Tasks => Set<KanbanTask>();
}

public sealed class KanbanTask
{
    public Guid Id { get; set; }
    public required string Title { get; set; }
    public required string Status { get; set; }
}

public sealed record CreateTaskRequest(string? Title);

public sealed record TaskDto(Guid Id, string Title, string Status);

public sealed class TaskStoreLock
{
}
