#!/bin/sh
set -e

echo "[start] Running prisma migrate deploy..."
apps/api/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "[start] Starting API server..."
exec node apps/api/dist/server.js
