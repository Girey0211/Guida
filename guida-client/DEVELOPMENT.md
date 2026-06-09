# 개발 가이드 (Phase 1 MVP)

이 문서는 README의 Phase 1(MVP)을 구현한 코드의 실행 방법을 설명합니다.

## 구현 범위 (Phase 1)

| 기능 | 상태 | 위치 |
|---|---|---|
| 거던 선택지 가이드 (오버레이/페이지) | ✅ | `src/pages/Guide.tsx`, `src/components/overlay/` |
| 루트 작성 및 로컬 저장 | ✅ | `src/pages/MyRoutes.tsx`, `src/components/route/RouteEditor.tsx` |
| 루트 공유 허브 (6자리 코드) | ✅ | `src/pages/RouteHub.tsx`, `src/api/` |
| 루트 탐색 및 필터 | ✅ | `src/components/route/RouteFilter.tsx`, `src/hooks/useRouteFilter.ts` |
| 추천(좋아요) 시스템 (UUID 기반, 패치 단위) | ✅ | `src/api/mockServer.ts`, `src/store/routeStore.ts` |
| 이미지 지연 로딩 및 Fallback | ✅ | `src/components/common/ImageWithFallback.tsx` |
| 최초 실행 팬 프로젝트 고지 | ✅ | `src/components/common/FirstRunNotice.tsx` |

> Phase 2(OCR/캡처)와 Phase 3(대시보드/만료 경고 등)은 구현 대상에서 제외했습니다.
> `src-tauri/src/ocr/`, `commands/capture.rs` 등은 의도적으로 생성하지 않았습니다.

## 아키텍처 메모

- **저장소 추상화** (`src/lib/storage.ts`): Tauri에서는 Rust IPC로
  `%APPDATA%/LimbusGuide/` 하위 JSON을 읽고 쓰며, 브라우저(Vite dev)에서는
  localStorage로 폴백합니다. 덕분에 Rust 없이도 전체 흐름을 검증할 수 있습니다.
- **Mock 중앙 서버** (`src/api/mockServer.ts`): 백엔드가 아직 없으므로 공유/탐색/
  추천을 localStorage 기반으로 시뮬레이션합니다. 실제 서버 연동 시 `src/api/routes.ts`의
  시그니처를 유지한 채 구현만 교체하면 됩니다.
- **오프라인 우선**: 게임 데이터는 동기화 성공 시 로컬 캐시되며, 네트워크 실패 시
  캐시 폴백으로 가이드 기능이 100% 동작합니다 (README 9.2 요구사항).

## 실행 방법

### 1) 웹(브라우저) 모드 — Rust 불필요, 즉시 실행/검증 가능

```bash
npm install
npm run dev          # http://localhost:1420
```

- 모든 Phase 1 기능이 localStorage 폴백으로 동작합니다.
- 오버레이는 `#/overlay` 경로의 새 창(window.open)으로 열립니다.

기타 스크립트:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # 프로덕션 번들 (dist/)
```

### 2) 데스크톱(Tauri) 모드 — 정식 빌드

사전 요구사항(현재 환경 미설치):

1. **Rust 툴체인** — https://rustup.rs
2. **앱 아이콘 생성** — 아이콘 소스(1024×1024 PNG) 준비 후:
   ```bash
   npm run tauri icon path/to/icon.png
   ```
   `src-tauri/icons/`가 채워져야 `tauri build`가 통과합니다.

실행:

```bash
npm run tauri:dev    # 개발 (핫리로드)
npm run tauri:build  # .exe / NSIS 설치 파일 (GitHub Releases 배포용)
```

데스크톱 모드에서는:
- 로컬 데이터가 `%APPDATA%/LimbusGuide/`의 실제 파일로 저장됩니다.
- 오버레이가 별도 투명 창(`overlay` 라벨)으로 뜨고, 클릭 관통이 OS 레벨로 동작합니다.

## 환경 변수 (선택)

| 변수 | 용도 | 기본값 |
|---|---|---|
| `VITE_API_BASE_URL` | 실제 백엔드 전환 시 베이스 URL | (없음 → Mock 사용) |
| `VITE_DATA_BASE_URL` | 게임 데이터 CDN 경로 | `/data` |
| `VITE_IMAGE_CDN_URL` | 이미지 CDN(GitHub Raw → Cloudflare) | GitHub Raw 예시 경로 |

## 다음 단계 제안

- 실제 백엔드(루트 허브 API) 연결: `VITE_API_BASE_URL` 설정 시 `src/api/httpServer.ts`(실 HTTP), 미설정 시 Mock 으로 자동 전환됨
- 이미지 에셋 CDN 업로드 및 `VITE_IMAGE_CDN_URL` 설정
- Tauri 디스크 이미지 캐시(`%APPDATA%/LimbusGuide/cache`) 확장 (`useImageCache`)
- Phase 2: `src-tauri/src/ocr/` 파이프라인 추가
