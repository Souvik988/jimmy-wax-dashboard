# Production image for the Jimmy & Wax operator dashboard (Next.js BFF). TLS is terminated in front of this container.
FROM node:22-alpine AS deps
WORKDIR /app
# Same pnpm as package.json "packageManager"; installed with npm so an old bundled corepack cannot reject its signature.
RUN npm install --global pnpm@11.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3200
RUN npm install --global pnpm@11.20.0 && addgroup -S app && adduser -S app -G app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./
USER app
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3200/api/health || exit 1
# DASHBOARD_SESSION_SECRET (32 random bytes, base64) and BACKEND_ORIGIN must be injected by the host secret manager.
CMD ["pnpm", "start"]
