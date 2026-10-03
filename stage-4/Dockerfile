# syntax=docker/dockerfile:1
# Tablekeeper stage 3. Multi-stage: dependencies and TypeScript are resolved at build time
# (network available); the runtime image needs no network.

# Production dependencies, with native modules (better-sqlite3, bcrypt) built for Alpine/musl.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compile the TypeScript sources.
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime: compiled JavaScript plus production node_modules only.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
