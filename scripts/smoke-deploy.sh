#!/usr/bin/env bash
# Minimal read-only post-deploy smoke check. No credentials, no cookies.
# Exit 0 = all checks passed, 1 = a check failed, 2 = usage error.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/smoke-deploy.sh --api <url> --web <url> [--timeout N] [--retries N]

Checks (GET only):
  <api>/health        200
  <api>/health/ready  200 and "Healthy" body
  <web>               200 or a same-origin redirect

Options (env fallbacks: SMOKE_API_URL, SMOKE_WEB_URL):
  --api URL      API base URL (https only)
  --web URL      Web origin URL (https only)
  --timeout N    Seconds per request (default 10)
  --retries N    Extra attempts per check for cold starts (default 5)
  --help         Show this help

Output is scheme, host, path and status code only.
EOF
}

api="${SMOKE_API_URL:-}"
web="${SMOKE_WEB_URL:-}"
timeout=10
retries=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --api) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; api="$2"; shift 2 ;;
    --web) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; web="$2"; shift 2 ;;
    --timeout) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; timeout="$2"; shift 2 ;;
    --retries) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; retries="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$api" && -n "$web" ]] || { echo "Both --api and --web are required." >&2; usage >&2; exit 2; }
[[ "$timeout" =~ ^[0-9]+$ && "$timeout" -ge 1 ]] || { echo "--timeout must be a positive integer." >&2; exit 2; }
[[ "$retries" =~ ^[0-9]+$ ]] || { echo "--retries must be a non-negative integer." >&2; exit 2; }

# https only, host only, no credentials, query or fragment.
url_re='^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$'
for u in "$api" "$web"; do
  [[ "$u" =~ $url_re ]] || { echo "URLs must be https://host[:port] with no credentials, path or query." >&2; exit 2; }
done
api="${api%/}"
web="${web%/}"

failed=0
body_file="$(mktemp "${TMPDIR:-/tmp}/ordo-smoke.XXXXXX")"
trap 'rm -f "$body_file"' EXIT

# fetch <url> -> sets code; body in $body_file. Retries until 2xx/3xx or attempts run out.
fetch() {
  local url="$1" attempt=0
  code=000
  while :; do
    code="$(curl -sS -o "$body_file" -w '%{http_code}' --max-time "$timeout" "$url" 2>/dev/null || true)"
    [[ "$code" =~ ^[23] ]] && return 0
    attempt=$((attempt + 1))
    [[ "$attempt" -gt "$retries" ]] && return 1
    sleep 3
  done
}

report() { # report <label> <ok|FAIL> <code>
  printf '%s %s (HTTP %s)\n' "$2" "$1" "$3"
}

check() { # check <url> <expected-body-substring or empty>
  local url="$1" expect="$2"
  if fetch "$url" && { [[ -z "$expect" ]] || grep -Fq "$expect" "$body_file"; }; then
    report "$url" ok "$code"
  else
    report "$url" FAIL "$code"
    failed=1
  fi
}

check "$api/health" ""
check "$api/health/ready" '"status":"Healthy"'

# Web origin: 200, or a redirect that stays on the same host (curl does not follow).
web_host="${web#https://}"
if fetch "$web/"; then
  redirect="$(curl -sS -o /dev/null -w '%{redirect_url}' --max-time "$timeout" "$web/" 2>/dev/null || true)"
  if [[ "$code" == 200 || "$redirect" == "https://$web_host"* ]]; then
    report "$web/" ok "$code"
  else
    report "$web/" FAIL "$code"
    failed=1
  fi
else
  report "$web/" FAIL "$code"
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  echo "Smoke check failed." >&2
  exit 1
fi
echo "Smoke check passed."
