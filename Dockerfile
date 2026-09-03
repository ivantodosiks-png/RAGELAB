FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY shared shared
COPY server server
COPY client client

ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build:shared && npm run build:server && npm run build:client

ENV GAME_SERVER_HOST=0.0.0.0
ENV GAME_SERVER_PUBLIC_TUNNEL=false
ENV GAME_SERVER_ALLOW_GUESTS=true
ENV GAME_SERVER_PERSIST=true
ENV GAME_SERVER_ALLOWED_ORIGINS=*

EXPOSE 8080
CMD ["npm", "start"]
