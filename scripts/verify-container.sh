#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
publish_dir="$(mktemp -d "${TMPDIR:-/tmp}/ordo-backend-publish.XXXXXX")"
container_id=""

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker logs "$container_id" || true
    docker rm --force "$container_id" >/dev/null || true
  fi
  rm -rf "$publish_dir"
}
trap cleanup EXIT

cd "$repo_root"

dotnet publish backend/backend.csproj \
  --configuration Release \
  --output "$publish_dir"

worker="$publish_dir/PdfWorker/backend.PdfWorker"
test -x "$worker"
test -f "$publish_dir/PdfWorker/backend.PdfWorker.deps.json"
test -f "$publish_dir/PdfWorker/backend.PdfWorker.runtimeconfig.json"
find "$publish_dir/PdfWorker" -maxdepth 1 -name 'UglyToad.PdfPig*.dll' -print -quit | grep -q .
DOTNET_GCHeapHardLimit=8000000 "$worker" </dev/null >"$publish_dir/worker-smoke.bin"
test "$(wc -c <"$publish_dir/worker-smoke.bin")" -eq 6

docker build --file backend/Dockerfile --tag ordo-backend:ci .
docker image inspect ordo-backend:ci \
  --format '{{json .Config.Entrypoint}}' \
  | grep -Fx '["dotnet","backend.dll"]'

docker run --rm --entrypoint sh ordo-backend:ci -c '
  test -f /app/backend.dll
  test -x /app/PdfWorker/backend.PdfWorker
  test -f /app/PdfWorker/backend.PdfWorker.deps.json
  test -f /app/PdfWorker/backend.PdfWorker.runtimeconfig.json
  find /app/PdfWorker -maxdepth 1 -name "UglyToad.PdfPig*.dll" -print -quit | grep -q .
  DOTNET_GCHeapHardLimit=8000000 /app/PdfWorker/backend.PdfWorker </dev/null >/tmp/worker-smoke.bin
  test "$(wc -c </tmp/worker-smoke.bin)" -eq 6
'

container_id=$(docker run --detach --publish 127.0.0.1::8080 \
  --env 'ConnectionStrings__DefaultConnection=Host=127.0.0.1;Database=unused;Username=unused;Password=unused;Timeout=1' \
  --env 'Jwt__Key=ci-only-jwt-key-with-at-least-thirty-two-bytes' \
  --env 'EmailSettings__FromName=Ordo CI' \
  --env 'EmailSettings__FromEmail=ci@example.invalid' \
  --env 'GoogleEmail__ClientId=ci-only' \
  --env 'GoogleEmail__ClientSecret=ci-only' \
  --env 'GoogleEmail__RefreshToken=ci-only' \
  --env 'Frontend__BaseUrl=https://example.invalid' \
  --env 'Logging__LogLevel__Microsoft.EntityFrameworkCore=Critical' \
  --env 'Logging__LogLevel__Microsoft.AspNetCore.DataProtection=Critical' \
  ordo-backend:ci)

started=false
for attempt in {1..10}; do
  test "$(docker inspect --format '{{.State.Running}}' "$container_id")" = true
  if docker exec "$container_id" sh -c \
    'grep -Eq ":1F90 .* 0A " /proc/net/tcp /proc/net/tcp6'; then
    started=true
    break
  fi
  sleep 1
done

test "$started" = true
docker exec "$container_id" sh -c \
  'tr "\000" " " </proc/1/cmdline | grep -Fx "dotnet backend.dll "'
