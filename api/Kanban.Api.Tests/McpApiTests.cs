using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Kanban.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Kanban.Api.Tests;

public sealed class McpApiTests
{
    [Fact]
    public async Task ProtocolDiscoversReadOnlyToolsAndReadsLiveRestData()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var initialize = await Rpc(client, "initialize", new
        {
            protocolVersion = "2025-03-26",
            capabilities = new { },
            clientInfo = new { name = "test", version = "1" }
        });
        Assert.Equal("2025-03-26", initialize.RootElement.GetProperty("result").GetProperty("protocolVersion").GetString());

        using var discovery = await Rpc(client, "tools/list", new { });
        var tools = discovery.RootElement.GetProperty("result").GetProperty("tools").EnumerateArray().ToArray();
        Assert.Equal(new[] { "get_kanban_item", "list_kanban_items" },
            tools.Select(t => t.GetProperty("name").GetString()).OrderBy(n => n, StringComparer.Ordinal));
        Assert.All(tools, t => Assert.True(t.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean()));
        var get = tools.Single(t => t.GetProperty("name").GetString() == "get_kanban_item");
        var schema = get.GetProperty("inputSchema");
        Assert.Equal("string", schema.GetProperty("properties").GetProperty("id").GetProperty("type").GetString());
        Assert.Contains(schema.GetProperty("required").EnumerateArray(), p => p.GetString() == "id");
        var list = tools.Single(t => t.GetProperty("name").GetString() == "list_kanban_items");
        Assert.Empty(list.GetProperty("inputSchema").GetProperty("properties").EnumerateObject());

        using var empty = await Call(client, "list_kanban_items", new { });
        Assert.Empty(Structured(empty).GetProperty("tasks").EnumerateArray());
        using var firstResponse = await client.PostAsJsonAsync("/api/tasks", new { title = "First" });
        using var secondResponse = await client.PostAsJsonAsync("/api/tasks", new { title = "Second" });
        firstResponse.EnsureSuccessStatusCode();
        secondResponse.EnsureSuccessStatusCode();
        var first = (await firstResponse.Content.ReadFromJsonAsync<TaskDto>())!;
        var second = (await secondResponse.Content.ReadFromJsonAsync<TaskDto>())!;

        using var complete = await client.PostAsync($"/api/tasks/{first.Id}/complete", null);
        complete.EnsureSuccessStatusCode();
        var rest = (await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!;
        using var listed = await Call(client, "list_kanban_items", new { });
        var listedJson = Structured(listed);
        Assert.Equal(new[] { "tasks" }, listedJson.EnumerateObject().Select(p => p.Name));
        var taskJson = listedJson.GetProperty("tasks")[0];
        Assert.Equal(new[] { "id", "title", "status" }, taskJson.EnumerateObject().Select(p => p.Name));
        var listedTasks = JsonSerializer.Deserialize<TaskDto[]>(listedJson.GetProperty("tasks"), JsonSerializerOptions.Web)!;
        Assert.Equal(rest, listedTasks);
        using var found = await Call(client, "get_kanban_item", new { id = first.Id.ToString() });
        Assert.Equal(new[] { "task" }, Structured(found).EnumerateObject().Select(p => p.Name));
        Assert.Equal(new TaskDto(first.Id, "First", "Done"),
            JsonSerializer.Deserialize<TaskDto>(Structured(found).GetProperty("task"), JsonSerializerOptions.Web));

        using var deleted = await client.DeleteAsync($"/api/tasks/{second.Id}");
        deleted.EnsureSuccessStatusCode();
        using var afterDelete = await Call(client, "list_kanban_items", new { });
        Assert.Single(Structured(afterDelete).GetProperty("tasks").EnumerateArray());
        using var missing = await Call(client, "get_kanban_item", new { id = second.Id.ToString() });
        AssertToolError(missing, "Task not found");
    }

    [Fact]
    public async Task InvalidAndMissingIdsProduceClearErrors()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var invalid = await Call(client, "get_kanban_item", new { id = "not-a-uuid" });
        AssertToolError(invalid, "Invalid task ID");
        using var missing = await Call(client, "get_kanban_item", new { });
        Assert.Contains("id", missing.RootElement.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.True(missing.RootElement.TryGetProperty("error", out _) ||
                    missing.RootElement.GetProperty("result").GetProperty("isError").GetBoolean());
        using var nullId = await Call(client, "get_kanban_item", new { id = (string?)null });
        AssertToolError(nullId, "Invalid task ID");
        using var wrongType = await Call(client, "get_kanban_item", new { id = 42 });
        Assert.True(wrongType.RootElement.TryGetProperty("error", out _) ||
                    wrongType.RootElement.GetProperty("result").GetProperty("isError").GetBoolean());
        using var notFound = await Call(client, "get_kanban_item", new { id = Guid.NewGuid().ToString() });
        AssertToolError(notFound, "Task not found");
    }

    [Theory]
    [InlineData("http://evil.example")]
    [InlineData("http://localhost:5000.evil.example")]
    [InlineData("null")]
    public async Task UntrustedOriginsAreRejected(string origin)
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp");
        request.Headers.Add("Origin", origin);
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task SameOriginAndNonBrowserClientsCanUseMcp()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Origin", "http://localhost:5000");
        using var result = await Call(client, "list_kanban_items", new { });
        Assert.Empty(Structured(result).GetProperty("tasks").EnumerateArray());
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Production")]
    public async Task UnexpectedFailuresDoNotLeakDetails(string environment)
    {
        const string secret = "sensitive internal details";
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TaskStoreLock>();
                services.AddSingleton<TaskStoreLock>(_ => throw new InvalidOperationException(secret));
            });
        });
        using var client = factory.CreateClient();
        using var result = await Call(client, "list_kanban_items", new { });
        Assert.DoesNotContain(secret, result.RootElement.ToString());
        Assert.True(result.RootElement.TryGetProperty("error", out _) ||
                    result.RootElement.GetProperty("result").GetProperty("isError").GetBoolean());
    }

    private static JsonElement Structured(JsonDocument response)
    {
        var result = response.RootElement.GetProperty("result");
        Assert.False(result.TryGetProperty("isError", out var error) && error.GetBoolean());
        return result.GetProperty("structuredContent");
    }

    private static void AssertToolError(JsonDocument response, string message)
    {
        var result = response.RootElement.GetProperty("result");
        Assert.True(result.GetProperty("isError").GetBoolean());
        Assert.Contains(message, result.GetProperty("content")[0].GetProperty("text").GetString());
    }

    private static Task<JsonDocument> Call(HttpClient client, string name, object arguments) =>
        Rpc(client, "tools/call", new { name, arguments });

    private static async Task<JsonDocument> Rpc(HttpClient client, string method, object parameters)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp");
        request.Headers.Accept.ParseAdd("application/json, text/event-stream");
        request.Headers.Add("MCP-Protocol-Version", "2025-03-26");
        request.Content = JsonContent.Create(new { jsonrpc = "2.0", id = 1, method, @params = parameters });
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        if (response.Content.Headers.ContentType?.MediaType == "text/event-stream")
        {
            body = body.Split('\n').First(line => line.StartsWith("data: ", StringComparison.Ordinal))[6..];
        }
        return JsonDocument.Parse(body);
    }
}
