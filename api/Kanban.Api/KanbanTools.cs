using System.ComponentModel;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace Kanban.Api;

public sealed class KanbanTools(KanbanDbContext db, TaskStoreLock storeLock)
{
    [McpServerTool(Name = "list_kanban_items", ReadOnly = true, OpenWorld = false, UseStructuredContent = true)]
    [Description("List all kanban items ordered by ID.")]
    public KanbanItemsResult List()
    {
        lock (storeLock)
        {
            var tasks = db.Tasks.AsNoTracking().AsEnumerable()
                .OrderBy(task => task.Id.ToString(), StringComparer.Ordinal)
                .Select(task => new TaskDto(task.Id, task.Title, task.Status))
                .ToArray();
            return new KanbanItemsResult(tasks);
        }
    }

    [McpServerTool(Name = "get_kanban_item", ReadOnly = true, OpenWorld = false, UseStructuredContent = true)]
    [Description("Get a kanban item by its UUID.")]
    public KanbanItemResult Get([Description("The UUID of the kanban item.")] string id)
    {
        if (!Guid.TryParse(id, out var taskId))
        {
            throw new McpException("Invalid task ID");
        }

        lock (storeLock)
        {
            var task = db.Tasks.AsNoTracking().SingleOrDefault(task => task.Id == taskId);
            if (task is null)
            {
                throw new McpException("Task not found");
            }

            return new KanbanItemResult(new TaskDto(task.Id, task.Title, task.Status));
        }
    }
}

public sealed record KanbanItemsResult(TaskDto[] Tasks);
public sealed record KanbanItemResult(TaskDto Task);
