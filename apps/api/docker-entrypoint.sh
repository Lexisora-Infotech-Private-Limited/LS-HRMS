#!/bin/sh
# Lexisora HRMS API container entrypoint: apply schema → first-run bootstrap → start.
set -e
cd /repo/apps/api

if [ -d prisma/schema/migrations ] && [ -n "$(ls -A prisma/schema/migrations 2>/dev/null | grep -v migration_lock)" ]; then
  echo "Applying database migrations…"
  npx prisma migrate deploy
else
  echo "Applying database schema…"
  npx prisma db push --skip-generate
fi

npx tsx prisma/bootstrap.ts

echo "Starting Lexisora HRMS API…"
exec node dist/src/main.js
