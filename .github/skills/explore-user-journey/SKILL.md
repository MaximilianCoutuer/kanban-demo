---
name: explore-user-journey
description: >
  Verify AgentBoard functionality by interacting
  with the running Angular application in a browser.
  Use when testing UI behavior, validating acceptance
  criteria, or performing exploratory testing.
---

# Explore User Journey

## Goal

Verify that a feature works from the user's
perspective, not just that automated tests pass.

## Prerequisites

- AgentBoard API and frontend are running.
- A browser automation tool is available.
- Acceptance criteria have been identified.

## Procedure

1. Read the feature's acceptance criteria.
2. Identify the relevant UI workflows.
3. Navigate to the running application using
   the available browser tools.
4. Exercise the feature as a real user would.
5. Verify results against acceptance criteria.
6. Include edge cases and invalid inputs.
7. Inspect browser errors when possible.
8. Capture evidence for unexpected behavior.

## AgentBoard conventions

- Frontend development URL: http://localhost:4200
- Use accessible labels to locate controls.
- Never assume a click succeeded.
- Verify the resulting UI state.
- Do not change application source code.

## Reporting

For each acceptance criterion report:

- Criterion
- Action performed
- Expected result
- Actual result
- PASS / FAIL / BLOCKED

For failures, include reproduction steps and
relevant browser evidence.

Never report PASS without actually verifying it.
