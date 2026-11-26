#!/usr/bin/env bash
# Runs full browser E2E tests against the real Docker stacks.
set -euo pipefail
ROOT=/home/shoue
echo "Starting stacks..."
(cd "$ROOT/coaching-platform" && docker compose up -d --build >/dev/null)
(cd "$ROOT/exam-service" && docker compose up -d --build >/dev/null)
for i in $(seq 1 40); do
  curl -fsS http://localhost:18081/health/ready >/dev/null 2>&1 && \
  curl -fsS http://localhost:13000/ >/dev/null 2>&1 && \
  curl -fsS http://localhost:18090/api/health >/dev/null 2>&1 && \
  curl -fsS http://localhost:13010/ >/dev/null 2>&1 && break
  sleep 2
done
echo "Building E2E image..."
docker build -t coaching-e2e "$ROOT/e2e" >/dev/null
echo "Running E2E tests..."
set +e
docker run --rm --network host coaching-e2e
CODE=$?
set -e
echo "Stopping main platform containers (exam service stays up)..."
docker ps --format '{{.Names}}' | grep -v '^proctored-exam-service-' | xargs -r docker stop >/dev/null 2>&1 || true
exit $CODE
