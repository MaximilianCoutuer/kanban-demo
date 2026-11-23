using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Kanban.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Kanban.Api.Tests;

public sealed class TasksApiTests
{
    [Fact]
    public async Task TaskWorkflowPersistsAcrossRequestsAndOrdersById()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        Assert.Empty((await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!);
        using var firstResponse = await client.PostAsJsonAsync("/api/tasks", new { title = "  First task  " });
        Assert.Equal(HttpStatusCode.Created, firstResponse.StatusCode);
        var first = (await firstResponse.Content.ReadFromJsonAsync<TaskDto>())!;
        Assert.NotEqual(Guid.Empty, first.Id);
        Assert.Equal("First task", first.Title);
        Assert.Equal("ToDo", first.Status);
        Assert.Equal($"/api/tasks/{first.Id}", firstResponse.Headers.Location?.OriginalString);

        using var secondResponse = await client.PostAsJsonAsync("/api/tasks", new { title = "Second" });
        Assert.Equal(HttpStatusCode.Created, secondResponse.StatusCode);
        var second = (await secondResponse.Content.ReadFromJsonAsync<TaskDto>())!;
        Assert.NotEqual(first.Id, second.Id);
        var tasks = (await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!;
        Assert.Equal(new[] { first.Id.ToString(), second.Id.ToString() }.OrderBy(id => id, StringComparer.Ordinal),
            tasks.Select(task => task.Id.ToString()));

        using var complete = await client.PostAsync($"/api/tasks/{first.Id}/complete", null);
        Assert.Equal(HttpStatusCode.OK, complete.StatusCode);
        Assert.Equal(new TaskDto(first.Id, first.Title, "Done"), await complete.Content.ReadFromJsonAsync<TaskDto>());
        using var completeAgain = await client.PostAsync($"/api/tasks/{first.Id}/complete", null);
        Assert.Equal(HttpStatusCode.OK, completeAgain.StatusCode);
        Assert.Equal(new TaskDto(first.Id, first.Title, "Done"), await completeAgain.Content.ReadFromJsonAsync<TaskDto>());
        Assert.Equal("Done", (await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!.Single(task => task.Id == first.Id).Status);

        using var delete = await client.DeleteAsync($"/api/tasks/{first.Id}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Empty(await delete.Content.ReadAsStringAsync());
        Assert.Equal(second, Assert.Single((await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!));
    }

    [Fact]
    public async Task DeleteAllClearsEveryStatusAndAllowsNewTasks()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        using var initiallyEmpty = await client.DeleteAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.NoContent, initiallyEmpty.StatusCode);
        Assert.Empty(await initiallyEmpty.Content.ReadAsStringAsync());

        var seeded = new[] { "ToDo", "InProgress", "Done" }
            .Select(status => new KanbanTask { Id = Guid.NewGuid(), Title = status, Status = status })
            .ToArray();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<KanbanDbContext>();
            var storeLock = scope.ServiceProvider.GetRequiredService<TaskStoreLock>();
            lock (storeLock)
            {
                db.Tasks.AddRange(seeded);
                db.SaveChanges();
            }
        }

        Assert.Equal(3, (await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!.Length);
        using var deleted = await client.DeleteAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty(await deleted.Content.ReadAsStringAsync());
        Assert.Empty((await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!);

        using var repeated = await client.DeleteAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.NoContent, repeated.StatusCode);
        Assert.Empty(await repeated.Content.ReadAsStringAsync());
        using var missingDelete = await client.DeleteAsync($"/api/tasks/{seeded[0].Id}");
        using var missingComplete = await client.PostAsync($"/api/tasks/{seeded[1].Id}/complete", null);
        Assert.Equal(HttpStatusCode.NotFound, missingDelete.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missingComplete.StatusCode);

        using var created = await client.PostAsJsonAsync("/api/tasks", new { title = "After clearing" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var task = (await created.Content.ReadFromJsonAsync<TaskDto>())!;
        Assert.Equal("ToDo", task.Status);
        Assert.Equal(task, Assert.Single((await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!));
        using var complete = await client.PostAsync($"/api/tasks/{task.Id}/complete", null);
        Assert.Equal(HttpStatusCode.OK, complete.StatusCode);
        using var singleDelete = await client.DeleteAsync($"/api/tasks/{task.Id}");
        Assert.Equal(HttpStatusCode.NoContent, singleDelete.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("{\"title\":null}")]
    [InlineData("{\"title\":\"   \"}")]
    public async Task InvalidTitlesReturnValidationProblem(string json)
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var response = await PostJson(client, json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("title", out _));
        Assert.Empty((await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!);
    }

    [Fact]
    public async Task TitleLengthUsesTrimmedUtf16Units()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        var maximum = string.Concat(Enumerable.Repeat("😀", 100));
        using var accepted = await client.PostAsJsonAsync("/api/tasks", new { title = $"  {maximum}  " });
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        Assert.Equal(maximum, (await accepted.Content.ReadFromJsonAsync<TaskDto>())!.Title);
        using var rejected = await client.PostAsJsonAsync("/api/tasks", new { title = maximum + "a" });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        using var body = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync());
        Assert.True(body.RootElement.GetProperty("errors").TryGetProperty("title", out _));
    }

    [Theory]
    [InlineData("")]
    [InlineData("{")]
    [InlineData("{\"title\":42}")]
    [InlineData("[]")]
    public async Task MalformedOrWrongJsonReturnsProblem(string json)
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var response = await PostJson(client, json);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task InvalidAndMissingIdsAreHandled()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var invalidComplete = await client.PostAsync("/api/tasks/not-a-uuid/complete", null);
        using var invalidDelete = await client.DeleteAsync("/api/tasks/not-a-uuid");
        Assert.Equal(HttpStatusCode.BadRequest, invalidComplete.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalidDelete.StatusCode);
        var missing = Guid.NewGuid();
        using var missingComplete = await client.PostAsync($"/api/tasks/{missing}/complete", null);
        using var missingDelete = await client.DeleteAsync($"/api/tasks/{missing}");
        foreach (var response in new[] { missingComplete, missingDelete })
        {
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal(404, body.RootElement.GetProperty("status").GetInt32());
            Assert.Equal("Task not found", body.RootElement.GetProperty("title").GetString());
        }
    }

    [Fact]
    public async Task HostsHaveIsolatedDatabases()
    {
        using var firstFactory = new WebApplicationFactory<Program>();
        using var secondFactory = new WebApplicationFactory<Program>();
        using var firstClient = firstFactory.CreateClient();
        using var secondClient = secondFactory.CreateClient();
        using var created = await firstClient.PostAsJsonAsync("/api/tasks", new { title = "Isolated" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Single((await firstClient.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!);
        Assert.Empty((await secondClient.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!);
    }

    [Fact]
    public async Task ConcurrentCreatesAreAllVisible()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        var responses = await Task.WhenAll(Enumerable.Range(0, 20)
            .Select(index => client.PostAsJsonAsync("/api/tasks", new { title = $"Task {index}" })));
        try
        {
            Assert.All(responses, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
            Assert.Equal(20, (await client.GetFromJsonAsync<TaskDto[]>("/api/tasks"))!.Length);
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task CrossOriginRequestsAreNotGrantedWildcardAccess()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/tasks");
        request.Headers.Add("Origin", "http://localhost:4200");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Theory]
    [InlineData("Development", false)]
    [InlineData("Production", false)]
    [InlineData("Development", true)]
    [InlineData("Production", true)]
    public async Task UnhandledExceptionsReturnSafeProblem(string environment, bool deleteAll)
    {
        const string sensitiveMessage = "Sensitive exception detail";
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TaskStoreLock>();
                services.AddSingleton<TaskStoreLock>(_ => throw new InvalidOperationException(sensitiveMessage));
            });
        });
        using var client = factory.CreateClient();
        using var response = deleteAll
            ? await client.DeleteAsync("/api/tasks")
            : await client.GetAsync("/api/tasks");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(sensitiveMessage, json);
        using var body = JsonDocument.Parse(json);
        Assert.Equal(500, body.RootElement.GetProperty("status").GetInt32());
        Assert.False(string.IsNullOrWhiteSpace(body.RootElement.GetProperty("title").GetString()));
    }

    private static Task<HttpResponseMessage> PostJson(HttpClient client, string json)
    {
        return client.PostAsync("/api/tasks", new StringContent(json, Encoding.UTF8, "application/json"));
    }

    private sealed record TaskDto(Guid Id, string Title, string Status);
}
