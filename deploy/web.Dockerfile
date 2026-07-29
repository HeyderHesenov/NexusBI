# syntax=docker/dockerfile:1
#
# The edge: compiled frontend + TLS termination + reverse proxy, in one image.
#
# Named for what it is rather than "frontend", because it also owns the routing
# between the browser and the backend. Built from the repository root so it can
# reach both frontend/ and deploy/Caddyfile.

# ─── Compile the SPA ───
FROM node:22-alpine AS build
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Relative on purpose. The browser reaches the API through this same origin, so
# a relative base means one image serves any domain — no rebuild per customer,
# and no CORS at all. lib/wsUrl.ts resolves it against the page origin for
# WebSockets, which cannot take a relative URL.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── Serve ───
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
