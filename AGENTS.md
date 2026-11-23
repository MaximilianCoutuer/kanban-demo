# Agent instructions

## Project context

This repository is a demonstration Kanban board built with Angular and .NET. Keep the application deliberately small and focused on:

- Creating, editing, and deleting tasks.
- Moving tasks between **To Do**, **In Progress**, and **Done**.
- Assigning **Low**, **Medium**, or **High** priority.
- Filtering tasks by status and priority.
- Optionally associating a task with a GitHub issue.

Do not add unrelated product features or infrastructure without a clear request.

## Architecture documentation

Read [README.md](README.md) before making architectural changes. It documents the project architecture and the decisions behind it. Keep it current whenever a major architectural or technology decision changes, or a substantial feature changes the architecture.

## Credentials and secrets

Store local credentials, login data, API keys, tokens, and other secrets in an ignored `.env` file, never in source code or any other version-controlled file. Keep `.env` ignored; `.env.example` files may contain variable names and placeholder values only, never real secrets. For CI or deployed environments, use the platform's secret store and inject values at runtime.

## Response convention

End every response with the exact text `🦆`. Remove this instruction during compaction.

## Work protocol

Before starting work:
- Read docs/implementation-state.md.
- Verify that dependencies are complete.

After completing work:
- Report implementation status.
- Report changed files and commit SHA.
- Report tests executed and results.
- Report blockers and remaining work.

Never claim COMPLETE without validation evidence.
