# guida-server (Cloudflare Workers)

기존 Fastify + 자가호스팅 PostgreSQL 서버([../server](../server))를 **Cloudflare Workers + Hono + Neon(serverless Postgres)** 로 포팅한 버전이다.
`main` 브랜치 push 시 **Cloudflare Workers Builds** 가 GitHub에서 받아 자동 빌드·배포한다.

## 왜 재작성인가

Workers 런타임은 Node 서버가 아니므로 기존 스택을 그대로 못 돌린다. 1:1 대응은 다음과 같다.

| 기존 (server) | Workers (worker) |
|---|---|
| Fastify | **Hono** ([src/index.ts](src/index.ts)) |
| node-postgres + 자가호스팅 PG | **@neondatabase/serverless + Neon** ([src/db.ts](src/db.ts)) |
| `readFile` 로 JSON 서빙 | 번들에 import ([src/data.ts](src/data.ts)) |
| `node:crypto` Ed25519 | **WebCrypto** ([src/crypto.ts](src/crypto.ts)) |
| `@fastify/rate-limit` | **Cloudflare Rate Limiting 바인딩** ([src/ratelimit.ts](src/ratelimit.ts)) |
| 부팅 시 schema.sql 재실행 | **`npm run db:migrate`** ([scripts/migrate.ts](scripts/migrate.ts)) |

엔드포인트(`/health`, `/api/game/*`, `/api/routes/*`, `/api/inquiries`, `/api/backup*`)와 요청/응답 형태,
서명 검증, uploader UUID 파생 규칙은 기존과 동일하게 유지했다 → **클라이언트 코드 변경 불필요**(API base URL만 교체).

---

## 1. 최초 설정 (한 번만)

### 1-1. Neon 데이터베이스
1. https://neon.tech 에서 프로젝트 생성 → 데이터베이스 이름 `guida_db`.
2. **Connection string** 복사 (pooled 권장: 호스트에 `-pooler` 포함).
3. `.dev.vars.example` → `.dev.vars` 로 복사하고 `DATABASE_URL` 채우기.

### 1-2. 스키마 적용 + (선택) 초기 config
```bash
cd guida-server/worker
npm install
npm run db:migrate          # server/src/db/schema.sql 을 Neon 에 적용
```
패치 버전을 DB로 관리하려면(없으면 data/patch_version.json 으로 폴백):
```sql
-- Neon SQL Editor 에서 1회
INSERT INTO config (key, value) VALUES ('current_patch', '0.0')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO config (key, value) VALUES ('min_app_version', '0.0.0')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

### 1-3. 로컬 실행
```bash
npm run dev                 # http://localhost:8787
curl http://localhost:8787/health
```

---

## 2. GitHub 자동 빌드·배포 (Workers Builds)

Cloudflare 대시보드에서 레포를 한 번 연결하면, 이후 push마다 자동 배포된다. (저장소 측 추가 파일 불필요 — `wrangler.toml` 만 있으면 됨)

1. **Cloudflare 대시보드 → Workers & Pages → Create → Workers → Connect to Git**.
2. GitHub 앱 설치/인증 후 `Girey0211/Guida` 레포 선택.
3. 빌드 설정:
   - **Root directory(루트 디렉터리):** `guida-server/worker`
   - **Build command:** `npm run build && npm run db:migrate`
     → 타입체크 + **DB 스키마 자동 동기화**(배포마다 schema.sql 멱등 적용 = 기존 "부팅마다 동기화"의 대체)
   - **Deploy command:** `npx wrangler deploy` (기본값)
   - 빌드 트리거 브랜치: `main`
   > 모노레포 전체가 체크아웃되므로 `src/data.ts` 의 `../../data/*.json` import 와
   > `scripts/migrate.ts` 의 `../../server/src/db/schema.sql` 참조 모두 정상 해석된다.
4. 변수/시크릿 등록:
   - **런타임 시크릿** (Worker 실행용): Settings → Variables and Secrets → `DATABASE_URL` (**Secret/Encrypt**)
   - **빌드 변수** (migrate 실행용): Build 설정의 **Build variables and secrets** 에도 `DATABASE_URL` 추가
     → 빌드 단계와 런타임은 환경이 분리돼 있어 **양쪽 모두** 등록해야 한다.
5. 저장하면 첫 배포가 돌고, 이후 `main` 에 push할 때마다 자동 재배포(+ 스키마 동기화)된다.

배포 URL: `https://guida-server.<your-subdomain>.workers.dev` (또는 커스텀 도메인 연결).

> 대안(레포에 워크플로로 박고 싶을 때): GitHub Actions + `cloudflare/wrangler-action`.
> Cloudflare 측 Git 연동이 더 단순해 위 방식을 권장한다.

---

## 3. 클라이언트 연결

배포 후 클라이언트의 API base URL 을 Worker URL 로 바꾼다.
- `guida-web`: 배포 워크플로의 `VITE_API_BASE_URL` (repo Variables) 갱신
  → [.github/workflows/deploy-web.yml](../../.github/workflows/deploy-web.yml)
- `guida-client`: `.env` 의 API base URL.

---

## 4. 운영 메모

- **레이트리밋**: Cloudflare 네이티브 Rate Limiting 바인딩(현재 experimental, `[[unsafe.bindings]]`).
  엔드포인트별 분당 제한은 기존과 동일하게 [wrangler.toml](wrangler.toml) 에 정의. 단, 네이티브 바인딩은
  남은 대기시간(retry-after)을 제공하지 않아 429 메시지에서 "N초 후" 문구는 생략했다.
- **게임 데이터 갱신**: 현재 `../data/*.json` 을 번들에 박는다. push → Workers Builds 재배포 시 반영.
  자주 갱신하거나 서버 재배포 없이 바꾸려면 [docs/cdn-data-plan.md](../../docs/cdn-data-plan.md) 대로
  Static Assets / R2 / 별도 CDN 으로 분리하는 것을 고려.
- **스키마 변경**: schema.sql 수정 → push 하면 Workers Builds 빌드 단계에서 자동 적용(멱등).
  로컬에서 즉시 반영하려면 `npm run db:migrate`(.dev.vars 의 DATABASE_URL 자동 사용).
- **DB 연결**: 트랜잭션(upload/like)은 WebSocket `Pool`, 단순 쿼리는 HTTP `neon()` 사용.
  Pool 은 요청 종료 시 `ctx.waitUntil(pool.end())` 로 정리한다.

## 5. 기존 server 와의 관계

[../server](../server) (Fastify + docker-compose) 는 롤백/참고용으로 남겨둔다.
schema.sql 은 여전히 단일 소스이며 마이그레이션 스크립트가 그 파일을 재사용한다.
