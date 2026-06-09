# ─────────────────────────────────────────────
# Build stage
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 프로덕션 의존성만 별도 설치
RUN npm ci --omit=dev

# ─────────────────────────────────────────────
# Runtime stage
# ─────────────────────────────────────────────
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
