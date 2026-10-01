# Lexisora HRMS API — production image (build from repo root: docker build -f apps/api/Dockerfile .)
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @lexisora/api... --filter @lexisora/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @lexisora/shared build \
 && cd apps/api && npx prisma generate && npx nest build -b swc

FROM node:22-bookworm-slim
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /repo /repo
RUN sed -i 's/\r$//' /repo/apps/api/docker-entrypoint.sh && chmod +x /repo/apps/api/docker-entrypoint.sh
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/repo/apps/api/docker-entrypoint.sh"]
