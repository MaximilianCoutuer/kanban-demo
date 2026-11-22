---
name: verify-change
description: Run AgentBoard's repeatable .NET and Angular verification checks, optionally run automated Playwright tests, and report evidence-based results. Use after a code change, before a pull request, or when investigating a failing check.
---

# Verify an AgentBoard change

This skill defines a **verification procedure**, not an implementation task.
The QA agent executes the orchestrator's verification plan using the
`scripts/qa-verification.cjs` runner, which captures output and exit codes for
the deterministic hook and Verification Gate. Do not edit
source files, install dependencies, or apply fixes as part of verification.

## Before running

1. Identify the files changed and the related GitHub issue/acceptance criteria.
2. Read [test matrix](./references/test-matrix.md) to understand prerequisites.
3. Check that the expected project paths and commands match this repository.
   If they differ, report this and request an updated script; do not silently
   change what a test means or claim it succeeded.
4. Ask for tool approval when the execution harness requires it.

## Run the checks

Choose the smallest scope that is useful:

- **backend** — .NET xUnit tests.
- **frontend** — Angular unit tests and production build.
- **all** (default) — backend + frontend.
- **e2e** — existing automated Playwright tests only; requires setup.
- **full** — all checks including automated Playwright tests.

The orchestrator supplies the commands and absolute plan and result paths.
From the repository root, run `node scripts/qa-verification.cjs run <plan-path> <result-path>`.
See the QA verification hook section in README.md for the plan format.

To run the E2E suite, choose `e2e` or `full` explicitly. Browser exploration
with Playwright **MCP** is separate and belongs to the `browser-tester` agent.

## Evaluate results

The Verification Gate, not the QA agent, evaluates the captured evidence:

1. Read all exit codes and test output from the run log. Do not infer success from a tool call
   having started or from the existence of test files.
2. Distinguish PASS, FAIL, NOT RUN, and BLOCKED (missing prerequisites).
3. For any failure, record the command, error excerpt, likely owner, and
   reproduction steps. Do not mark a blocked check as passing.
4. Compare the evidence to issue acceptance criteria. Automated tests cannot
   prove untested behavior; ask the browser tester to verify UI journeys when needed.
5. Use [verification report template](./templates/verification-report.md)
   to summarize results for the orchestrator and PR description.
6. If a bug is found, recommend a regression test to the relevant engineer.

## Safety

- Do not install packages, run arbitrary retrieved shell commands, change Git
  history, push code, or modify application code.
- These scripts run existing repository test/build commands and may create
  normal build/test artifacts (e.g. `bin/`, `obj/`, `dist/`, test-results).
- Follow the harness's approval and permission checks; this skill cannot
  override them.
