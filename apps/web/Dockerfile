# Lexisora HRMS web — static build served by nginx, proxying /api and /socket.io to the API.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @lexisora/web... --filter @lexisora/shared
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_DEMO_LOGINS=false
ENV VITE_DEMO_LOGINS=$VITE_DEMO_LOGINS
RUN pnpm --filter @lexisora/shared build && cd apps/web && npx vite build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
