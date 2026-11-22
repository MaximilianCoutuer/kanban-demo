#!/usr/bin/env bash
# AgentBoard verification. Does not install dependencies or modify source.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 2
ROOT="$(cd -- "$SCRIPT_DIR/../../../.." && pwd)" || exit 2
SCOPE="${1:-all}"

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [backend|frontend|all|e2e|full]" >&2
  exit 2
fi
case "$SCOPE" in
  backend|frontend|all|e2e|full) ;;
  *) echo "Unknown scope: $SCOPE" >&2; exit 2 ;;
esac

passed=()
failed=()

run_check() {
  local label="$1" dir="$2"
  shift 2
  printf '\n== %s ==\n' "$label"
  if [[ ! -d "$dir" ]]; then
    printf 'FAIL: working directory is missing: %s\n' "$dir" >&2
    failed+=("$label")
    return
  fi
  if (cd -- "$dir" && "$@"); then
    printf 'PASS: %s\n' "$label"
    passed+=("$label")
  else
    local code=$?
    printf 'FAIL: %s (exit %s)\n' "$label" "$code" >&2
    failed+=("$label")
  fi
}

if [[ "$SCOPE" == backend || "$SCOPE" == all || "$SCOPE" == full ]]; then
  run_check '.NET tests' "$ROOT" dotnet test \
    tests/AgentBoard.Api.Tests/AgentBoard.Api.Tests.csproj --no-restore -c Release
fi
if [[ "$SCOPE" == frontend || "$SCOPE" == all || "$SCOPE" == full ]]; then
  run_check 'Angular unit tests' "$ROOT/frontend/agentboard" npm test -- --watch=false
  run_check 'Angular production build' "$ROOT/frontend/agentboard" npm run build
fi
if [[ "$SCOPE" == e2e || "$SCOPE" == full ]]; then
  run_check 'Automated Playwright tests' "$ROOT/frontend/agentboard" \
    npx --no-install playwright test
fi

printf '\n== Summary ==\n'
printf 'Passed: %s | Failed: %s\n' "${#passed[@]}" "${#failed[@]}"
if (( ${#failed[@]} > 0 )); then
  printf 'Failed checks:\n'
  printf ' - %s\n' "${failed[@]}"
  exit 1
fi
exit 0
