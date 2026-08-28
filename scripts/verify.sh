#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dry_run=false

usage() {
  cat <<'EOF'
Usage: ./scripts/verify.sh [--dry-run] [default|frontend|backend|postgresql|container|all]

Lanes:
  default     Frontend and non-PostgreSQL backend verification (the default)
  frontend    Install locked dependencies, then run tests, lint, and build
  backend     Restore, build, and run non-PostgreSQL backend tests
  postgresql  Run migration-chain and PostgreSQL financial integration tests
  container   Publish and verify the production backend container
  all         Run every lane; requires local PostgreSQL and Docker
EOF
}

if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
  shift
fi

mode="${1:-default}"
if (( $# > 0 )); then
  shift
fi
if (( $# > 0 )); then
  usage >&2
  exit 2
fi

run_frontend() {
  echo "==> Frontend verification"
  if $dry_run; then
    echo "(cd frontend && npm ci)"
    echo "(cd frontend && npm run verify)"
    return
  fi
  (
    cd "$repo_root/frontend"
    npm ci
    npm run verify
  )
}

run_backend() {
  echo "==> Backend verification"
  if $dry_run; then
    echo 'dotnet restore backend.Tests/backend.Tests.csproj'
    echo 'dotnet build backend/backend.csproj --configuration Release --no-restore'
    echo 'dotnet test backend.Tests/backend.Tests.csproj --configuration Release --no-restore --filter Category!=PostgreSQL'
    return
  fi
  cd "$repo_root"
  dotnet restore backend.Tests/backend.Tests.csproj
  dotnet build backend/backend.csproj --configuration Release --no-restore
  dotnet test backend.Tests/backend.Tests.csproj \
    --configuration Release \
    --no-restore \
    --filter "Category!=PostgreSQL"
}

run_postgresql() {
  echo "==> PostgreSQL integration verification"
  if $dry_run; then
    echo 'require BUDGETPLANNER_POSTGRESQL_TEST_CONNECTION for disposable local PostgreSQL'
    echo 'dotnet restore backend.Tests/backend.Tests.csproj'
    echo 'dotnet build backend.Tests/backend.Tests.csproj --configuration Release --no-restore'
    echo 'dotnet test backend.Tests/backend.Tests.csproj --configuration Release --no-build --filter Category=PostgreSQL&FullyQualifiedName~Migration_chain'
    echo 'dotnet test backend.Tests/backend.Tests.csproj --configuration Release --no-build --filter Category=PostgreSQL&FullyQualifiedName!~Migration_chain'
    return
  fi
  if [[ -z "${BUDGETPLANNER_POSTGRESQL_TEST_CONNECTION:-}" ]]; then
    echo "BUDGETPLANNER_POSTGRESQL_TEST_CONNECTION is required for the PostgreSQL lane." >&2
    echo "Use only an approved disposable local database; never use a hosted or production database." >&2
    exit 1
  fi
  cd "$repo_root"
  dotnet restore backend.Tests/backend.Tests.csproj
  dotnet build backend.Tests/backend.Tests.csproj --configuration Release --no-restore
  dotnet test backend.Tests/backend.Tests.csproj \
    --configuration Release \
    --no-build \
    --filter "Category=PostgreSQL&FullyQualifiedName~Migration_chain"
  dotnet test backend.Tests/backend.Tests.csproj \
    --configuration Release \
    --no-build \
    --filter "Category=PostgreSQL&FullyQualifiedName!~Migration_chain"
}

run_container() {
  echo "==> Production container verification"
  if $dry_run; then
    echo './scripts/verify-container.sh'
    return
  fi
  "$repo_root/scripts/verify-container.sh"
}

case "$mode" in
  default)
    run_frontend
    run_backend
    ;;
  frontend)
    run_frontend
    ;;
  backend)
    run_backend
    ;;
  postgresql)
    run_postgresql
    ;;
  container)
    run_container
    ;;
  all)
    run_frontend
    run_backend
    run_postgresql
    run_container
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown verification lane: $mode" >&2
    usage >&2
    exit 2
    ;;
esac
