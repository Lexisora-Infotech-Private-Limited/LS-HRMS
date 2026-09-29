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
WORKDIR /repo/apps/api
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply schema then start. For managed migrations switch to `prisma migrate deploy`.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/main.js"]
