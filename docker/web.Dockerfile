# The React frontend, built with Vite and served as static files by nginx, which also
# forwards /api to the backend so the browser only ever talks to one origin (the same
# arrangement the Vite dev server provides in development).
FROM node:22-alpine AS build
WORKDIR /app
COPY web-app/package.json web-app/package-lock.json ./
COPY web-app/backend/package.json ./backend/
COPY web-app/frontend/package.json ./frontend/
RUN npm ci --workspace frontend
COPY web-app/frontend ./frontend
RUN npm run build --workspace frontend

FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
