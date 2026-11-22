using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

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
        Assert.Equal(HttpStatusCode.NotFound, missingComplete.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missingDelete.StatusCode);
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
    public async Task BrowserClientsCanCallTheApi()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/tasks");
        request.Headers.Add("Origin", "http://localhost:4200");
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("*", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    }

    private static Task<HttpResponseMessage> PostJson(HttpClient client, string json)
    {
        return client.PostAsync("/api/tasks", new StringContent(json, Encoding.UTF8, "application/json"));
    }

    private sealed record TaskDto(Guid Id, string Title, string Status);
}
