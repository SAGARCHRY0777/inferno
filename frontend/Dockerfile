# Build the static console, then serve it from nginx with an API/WS/chat reverse proxy.
FROM node:20-alpine AS build
WORKDIR /app
# npm ci needs the lockfile present and in sync -> reproducible, fails loudly if missing.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build-time only: a relative chat base ("") makes the bundle call /chat, which
# nginx proxies to the chat service. Vite inlines this at `npm run build`.
ARG VITE_CHAT_URL=""
ENV VITE_CHAT_URL=$VITE_CHAT_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
