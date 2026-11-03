#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
verify="$repo_root/scripts/verify.sh"

bash -n "$verify"
bash -n "$repo_root/scripts/verify-container.sh"
bash -n "$repo_root/scripts/smoke-deploy.sh"

smoke="$repo_root/scripts/smoke-deploy.sh"
"$smoke" --help >/dev/null
for bad in "" "--api https://a.example" "--api http://a.example --web https://b.example" \
  "--api https://u:p@a.example --web https://b.example" "--api https://a.example --web https://b.example --bogus" \
  "--api https://a.example --web https://b.example --timeout 0"; do
  set +e
  # shellcheck disable=SC2086
  env -u SMOKE_API_URL -u SMOKE_WEB_URL "$smoke" $bad >/dev/null 2>&1
  status=$?
  set -e
  if [[ "$status" -ne 2 ]]; then
    echo "Smoke script must exit 2 for usage error: $bad" >&2
    exit 1
  fi
done

default_output="$($verify --dry-run)"
grep -Fq 'Frontend verification' <<<"$default_output"
grep -Fq 'Backend verification' <<<"$default_output"
if grep -Fq 'PostgreSQL integration verification' <<<"$default_output"; then
  echo 'Default verification must not require PostgreSQL.' >&2
  exit 1
fi

all_output="$($verify --dry-run all)"
grep -Fq 'Frontend verification' <<<"$all_output"
grep -Fq 'Backend verification' <<<"$all_output"
grep -Fq 'PostgreSQL integration verification' <<<"$all_output"
grep -Fq 'Production container verification' <<<"$all_output"

if "$verify" --dry-run unsupported >/dev/null 2>&1; then
  echo 'Unknown lanes must fail.' >&2
  exit 1
fi

postgres_error="$(mktemp "${TMPDIR:-/tmp}/ordo-verify-test.XXXXXX")"
trap 'rm -f "$postgres_error"' EXIT
if env -u BUDGETPLANNER_POSTGRESQL_TEST_CONNECTION "$verify" postgresql \
  >/dev/null 2>"$postgres_error"; then
  echo 'PostgreSQL verification must fail without an explicit local connection.' >&2
  exit 1
fi
grep -Fq 'Use only an approved disposable local database' "$postgres_error"

echo 'Verification script checks passed.'
