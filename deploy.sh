#!/bin/bash
set -e
cd /opt/lexisora-hrms
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker image prune -f

API_PORT="$(grep -E '^API_PORT=' .env.prod | cut -d= -f2)"
API_PORT="${API_PORT:-4000}"

for i in $(seq 1 15); do
  if curl -fsS "http://localhost:${API_PORT}/api/v1/health" > /dev/null; then
    echo "API healthy"
    exit 0
  fi
  sleep 2
done

echo "API health check failed after deploy" >&2
exit 1
