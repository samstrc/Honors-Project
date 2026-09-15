# The Express proxy. Installs only the backend workspace's production dependencies.
FROM node:22-alpine

WORKDIR /app

# the lockfile lives at the workspace root, so both workspace manifests are needed
# for npm to resolve it, even though only the backend is installed here
COPY web-app/package.json web-app/package-lock.json ./
COPY web-app/backend/package.json ./backend/
COPY web-app/frontend/package.json ./frontend/
RUN npm ci --omit=dev --workspace backend

COPY web-app/backend ./backend

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["node", "backend/server.js"]
