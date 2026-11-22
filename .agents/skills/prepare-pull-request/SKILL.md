---
name: prepare-pull-request
description: Prepare a pull request description using the repository's template. Use when drafting or preparing a pull request.
---

# Prepare Pull Request

## Procedure

1. Read [templates/template.md](templates/template.md) and use it as the
   structure for the pull request description.
2. Review the changes, related issue and available verification results.
3. Replace the placeholders with accurate, relevant details. Preserve the
   template's sections and testing table; mark checks that were not run as
   `NOT RUN` and explain relevant limitations.
4. Link the issue with `Closes #<number>` only when there is a known related
   issue that the pull request closes. Otherwise, state that no closing issue
   was identified.
5. Check acceptance criteria and reviewer checklist items only when verified.
   Include available before/after screenshots for UI changes; otherwise note
   that screenshots are unavailable or not applicable.
6. Report known risks and unverified behavior without inventing results.
