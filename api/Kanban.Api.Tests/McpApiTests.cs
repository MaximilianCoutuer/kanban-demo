using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Kanban.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

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
    public async Task SdkClientInitializesDiscoversAndCallsOverStreamableHttp()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var http = factory.CreateClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var transport = new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = new Uri(http.BaseAddress!, "/mcp"),
            TransportMode = HttpTransportMode.StreamableHttp,
            EnableStandaloneGetStream = false
        }, http, null, false);
        await using var mcp = await McpClient.CreateAsync(transport, cancellationToken: timeout.Token);
        var tools = await mcp.ListToolsAsync(cancellationToken: timeout.Token);
        Assert.Equal(new[] { "get_kanban_item", "list_kanban_items" },
            tools.Select(t => t.Name).OrderBy(n => n, StringComparer.Ordinal));

        using var created = await http.PostAsJsonAsync("/api/tasks", new { title = "\u65e5\u672c\u8a9e \ud83d\ude00 caf\u00e9" }, timeout.Token);
        created.EnsureSuccessStatusCode();
        var task = (await created.Content.ReadFromJsonAsync<TaskDto>(cancellationToken: timeout.Token))!;
        var result = await mcp.CallToolAsync("get_kanban_item", new Dictionary<string, object?>
        {
            ["id"] = task.Id.ToString()
        }, cancellationToken: timeout.Token);
        Assert.NotEqual(true, result.IsError);
        var text = Assert.IsType<TextContentBlock>(Assert.Single(result.Content));
        using var document = JsonDocument.Parse(text.Text);
        Assert.Equal(task, JsonSerializer.Deserialize<TaskDto>(document.RootElement.GetProperty("task"), JsonSerializerOptions.Web));

        var list = await mcp.CallToolAsync("list_kanban_items", cancellationToken: timeout.Token);
        Assert.NotEqual(true, list.IsError);
        var listText = Assert.IsType<TextContentBlock>(Assert.Single(list.Content));
        using var listDocument = JsonDocument.Parse(listText.Text);
        Assert.Equal(task, JsonSerializer.Deserialize<TaskDto>(listDocument.RootElement.GetProperty("tasks")[0], JsonSerializerOptions.Web));
    }

    [Fact]
    public async Task SdkClientReadsLiveRestDataOverTcp()
    {
        using var factory = new WebApplicationFactory<Program>();
        factory.UseKestrel(0);
        factory.StartServer();
        var addresses = factory.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!;
        var address = new Uri(Assert.Single(addresses.Addresses));
        Assert.True(address.IsLoopback);
        Assert.NotEqual(5000, address.Port);
        Assert.NotEqual(0, address.Port);
        using var http = new HttpClient { BaseAddress = address };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var transport = new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = new Uri(address, "/mcp"),
            TransportMode = HttpTransportMode.StreamableHttp,
            EnableStandaloneGetStream = false
        }, http, null, false);
        await using var mcp = await McpClient.CreateAsync(transport, cancellationToken: timeout.Token);
        var tools = await mcp.ListToolsAsync(cancellationToken: timeout.Token);
        Assert.Equal(new[] { "get_kanban_item", "list_kanban_items" },
            tools.Select(t => t.Name).OrderBy(n => n, StringComparer.Ordinal));

        using var created = await http.PostAsJsonAsync("/api/tasks", new { title = "TCP task" }, timeout.Token);
        created.EnsureSuccessStatusCode();
        var task = (await created.Content.ReadFromJsonAsync<TaskDto>(cancellationToken: timeout.Token))!;
        var list = await mcp.CallToolAsync("list_kanban_items", cancellationToken: timeout.Token);
        Assert.NotEqual(true, list.IsError);
        var listText = Assert.IsType<TextContentBlock>(Assert.Single(list.Content));
        using var listDocument = JsonDocument.Parse(listText.Text);
        var tasks = listDocument.RootElement.GetProperty("tasks");
        Assert.Equal(1, tasks.GetArrayLength());
        Assert.Equal(task, JsonSerializer.Deserialize<TaskDto>(tasks[0], JsonSerializerOptions.Web));

        var get = await mcp.CallToolAsync("get_kanban_item", new Dictionary<string, object?>
        {
            ["id"] = task.Id.ToString()
        }, cancellationToken: timeout.Token);
        Assert.NotEqual(true, get.IsError);
        var getText = Assert.IsType<TextContentBlock>(Assert.Single(get.Content));
        using var getDocument = JsonDocument.Parse(getText.Text);
        Assert.Equal(task, JsonSerializer.Deserialize<TaskDto>(getDocument.RootElement.GetProperty("task"), JsonSerializerOptions.Web));
    }

    [Fact]
    public async Task StructuredAndTextResultsMatchAndAreOrderedOrdinally()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        var ids = new List<string>();
        foreach (var title in new[] { "Z", "\u65e5\u672c\u8a9e \ud83d\ude00 caf\u00e9", "A", "\u00e9" })
        {
            using var response = await client.PostAsJsonAsync("/api/tasks", new { title });
            response.EnsureSuccessStatusCode();
            ids.Add((await response.Content.ReadFromJsonAsync<TaskDto>())!.Id.ToString());
        }
        using var list = await Call(client, "list_kanban_items", new { });
        var structured = Structured(list);
        var items = structured.GetProperty("tasks").EnumerateArray().ToArray();
        Assert.Equal(ids.OrderBy(id => id, StringComparer.Ordinal), items.Select(t => t.GetProperty("id").GetString()));
        Assert.Contains(items, t => t.GetProperty("title").GetString() == "\u65e5\u672c\u8a9e \ud83d\ude00 caf\u00e9");
        AssertTextMatchesStructured(list);
        using var get = await Call(client, "get_kanban_item", new { id = ids[1] });
        Assert.Equal("\u65e5\u672c\u8a9e \ud83d\ude00 caf\u00e9", Structured(get).GetProperty("task").GetProperty("title").GetString());
        AssertTextMatchesStructured(get);
    }

    private static void AssertTextMatchesStructured(JsonDocument response)
    {
        var result = response.RootElement.GetProperty("result");
        var content = result.GetProperty("content");
        Assert.Equal(1, content.GetArrayLength());
        Assert.Equal("text", content[0].GetProperty("type").GetString());
        using var text = JsonDocument.Parse(content[0].GetProperty("text").GetString()!);
        Assert.True(JsonElement.DeepEquals(Structured(response), text.RootElement));
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
    [InlineData("http://localhost:4200")]
    [InlineData("http://127.0.0.1:5000")]
    [InlineData("https://localhost:5000")]
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
