# --- build rummy client (vite) ---
FROM node:20-alpine AS rummy-build
WORKDIR /app/games/rummy
COPY games/rummy/package.json games/rummy/package-lock.json* ./
RUN npm install
COPY games/rummy/ ./
RUN npm run build

# --- runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# deps raiz (express, etc.)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# deps rummy (express/socket.io usados em runtime pelo server ESM)
COPY games/rummy/package.json games/rummy/package-lock.json* ./games/rummy/
RUN npm --prefix games/rummy install --omit=dev

COPY . .
COPY --from=rummy-build /app/games/rummy/dist ./games/rummy/dist

EXPOSE 3000
CMD ["node", "server.js"]
