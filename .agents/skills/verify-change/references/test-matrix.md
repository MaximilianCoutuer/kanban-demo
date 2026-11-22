# AgentBoard verification matrix

The paths below are examples for the AgentBoard layout. Adjust them to the
actual repository before running the scripts.

| Scope | Check | Command (from appropriate working directory) | Prerequisites |
| --- | --- | --- | --- |
| backend | .NET xUnit | `dotnet test tests/AgentBoard.Api.Tests/AgentBoard.Api.Tests.csproj --no-restore -c Release` (repo root) | .NET SDK, restored NuGet dependencies, test project exists |
| frontend | Angular unit tests | `npm test -- --watch=false` (`frontend/agentboard`) | Node.js, local node_modules, `test` script invokes `ng test` or an equivalent runner |
| frontend | Angular production build | `npm run build` (`frontend/agentboard`) | Node.js, local node_modules, `build` script configured |
| e2e | Automated Playwright test suite | `npx --no-install playwright test` (`frontend/agentboard`) | Local `@playwright/test`, browser binaries, tests, and `playwright.config.ts`; web server is running or managed by Playwright config |

`all` covers **backend and frontend**. `full` additionally runs the **e2e** suite.
The scripts never run npm installs or Playwright browser installs.

One-time developer setup (explicit, outside verification):

```bash
dotnet restore tests/AgentBoard.Api.Tests/AgentBoard.Api.Tests.csproj
cd frontend/agentboard
npm ci
# If automated browser tests are configured:
npx playwright install chromium
```

Angular's current CLI defaults to Vitest for new projects and supports `--watch=false`.
If the repository uses a different test runner, update the npm test script.

**Not covered:** exploratory interaction through Playwright MCP; visual review;
security scanning; deployment; checking browser behavior not encoded as tests.
These are separate QA tasks.
