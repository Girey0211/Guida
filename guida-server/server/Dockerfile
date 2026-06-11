# ─────────────────────────────────────────────
# Build stage — TypeScript 컴파일 + 프로덕션 의존성 분리
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 설치 레이어 (package.json 변경 시에만 무효화)
COPY package*.json ./
RUN npm ci

# 소스 빌드 (tsc → dist, src/db 도 dist/db 로 복사)
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 런타임에 넣을 프로덕션 의존성만 별도 디렉터리에 설치
RUN npm ci --omit=dev

# ─────────────────────────────────────────────
# Runtime stage — 최소 이미지로 실행
# ─────────────────────────────────────────────
FROM node:20-alpine AS runtime

# tini: PID 1 시그널 처리(SIGTERM 전달 → graceful shutdown / 좀비 프로세스 방지)
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

# 프로덕션 의존성 + 빌드 산출물만 복사
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# node:alpine 이미지에 기본 포함된 비루트 사용자로 실행
USER node

EXPOSE 3000

# /health 로 헬스체크 (Node 내장 fetch 사용, 추가 패키지 불필요)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
