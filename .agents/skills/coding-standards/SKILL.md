---
name: coding-standards
description: 'Apply ClaimHub coding standards and check linting or formatting drift. Use when writing C#, reviewing style consistency, or normalizing code without functional changes; use the built-in .NET formatter and preserve brownfield behavior.'
license: Apache-2.0
---

# ClaimHub coding standards

Use the conventions already prevalent in ClaimHub, not a new architecture or a
generic analyzer ruleset. The executable formatting policy is
[ClaimHub/.editorconfig](../../../ClaimHub/.editorconfig).

## When to use

- Add or edit application code and tests.
- Check coding-standard, linting, whitespace, or formatting divergence.
- Perform a behavior-preserving style cleanup.

## Repository conventions

The initial audit covered 253 tracked C# files: all used spaces with four-space
indentation and CRLF; 199 already ended in a newline and 54 did not. All 34 files
with both System and other imports placed a System import first. File-scoped
namespaces prevailed outside the three EF migration/model files.

- Use four spaces, CRLF, a final newline, and no trailing whitespace in C#.
  Preserve each existing file's encoding/BOM; do not mass-convert it.
- Put imports outside the file-scoped namespace, with System imports first.
  Preserve aliases and do not reorder members or remove imports during a
  whitespace-only pass.
- Use Allman braces for multiline constructs. Retain existing compact blocks,
  expression-bodied members, and single-line statements.
- Use PascalCase types, methods and properties; camelCase locals and parameters;
  and `_camelCase` private fields. Do not rename existing symbols in a
  formatting-only task, especially public or serialized members.
- Keep existing `var`/explicit-type choices: the repository uses both, and the
  policy deliberately does not force either.
- Use four-space indentation for Razor, two spaces for owned CSS and JSON.
  Preserve inline Razor markup and rendered whitespace; do not reformat vendor
  assets or introduce a frontend formatter just for this application.
- Follow each project's existing nullable settings. Infrastructure deliberately
  disables nullable; do not enable it or warnings-as-errors as style cleanup.

## Workflow

Run commands from the repository root in Windows PowerShell with the .NET 10 SDK.

1. Inspect `git status --short` and relevant files before editing. Preserve
   unrelated changes and establish build/test results before a broad cleanup.
2. Apply the conventions above to the requested scope. For a repository-wide
   C# formatting pass, run only the whitespace formatter:

   ```powershell
   dotnet format whitespace .\ClaimHub\ClaimHub.sln --no-restore --exclude .\ClaimHub\src\ClaimHub.Infrastructure\Data\Migrations
   if ($LASTEXITCODE -ne 0) { throw 'Solution formatting failed.' }
   ```

   Use `--include` for a narrower change. All three test projects are included
   in the solution. Restore only when
   dependencies are missing; do not install additional analyzer packages.
3. Verify that the same formatter commands with `--verify-no-changes` succeed.
   For formatting-only work, check that changes contain no altered tokens,
   literals, directives, member order, or logic, not merely that tests pass.
4. Build and run the solution, including all three test projects:

   ```powershell
   dotnet build .\ClaimHub\ClaimHub.sln --no-restore
   if ($LASTEXITCODE -ne 0) { throw 'Solution build failed.' }
   dotnet test .\ClaimHub\ClaimHub.sln --no-build --no-restore
   if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
   ```

   Report pre-existing failures separately; do not fix business behavior to make
   a formatting-only change pass.

## Gotchas

- **Do not run unrestricted `dotnet format` or analyzer fixes** for a
  non-functional cleanup. Use `dotnet format whitespace`; style/analyzer fixes
  can rewrite code beyond layout.
- **Exclude EF migrations and model snapshots**, as well as generated `bin`/`obj`
  files and third-party assets. Their namespace/layout differences are not a
  reason to regenerate or rewrite them.
- **Preserve contracts and runtime text.** Do not change DTO/property order,
  JSON/CSV serializers, route strings, SQL, regexes, raw strings, Razor output,
  query ordering, number sequences, or project language settings.
- **Do not unify architectural patterns as coding style.** Keep controllers
  versus Minimal APIs, existing mapping/validation libraries, and worker behavior.
- **Do not start hosts to check formatting.** They can seed or mutate the shared
  SQLite database; the Development Worker also runs jobs and writes exports.
- This policy uses SDK tooling and EditorConfig, not a new lint dependency or
  build-time analyzer gate. Generated files and non-C# layout require separate,
  appropriately scoped validation.
