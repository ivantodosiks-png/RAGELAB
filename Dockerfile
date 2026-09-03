FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY shared shared
COPY server server
RUN npm run build:shared && npm run build:server

ENV GAME_SERVER_HOST=0.0.0.0
ENV GAME_SERVER_PUBLIC_TUNNEL=false
ENV GAME_SERVER_ALLOW_GUESTS=true
ENV GAME_SERVER_PERSIST=true

EXPOSE 8080
CMD ["npm", "start"]
