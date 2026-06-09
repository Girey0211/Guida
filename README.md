# 🧭 Guida

> 림버스 컴퍼니 유저의 거울 던전 플레이 및 수집 목표 관리를 돕기 위한 **PC 전용 데스크톱 편의성 애플리케이션**입니다.
>
> 오픈소스의 투명성을 기반으로 하며, 게임의 공정성을 해치지 않는 **'읽기 전용(Read-Only)'** 및 **'로컬 중심(Offline-First)'** 설계를 지향합니다.
>
> *"Guida"는 단테의 신곡에서 베르길리우스가 단테의 안내자(길잡이)로 불리던 이탈리아어 단어입니다.*

---

## 📑 목차

1. [프로젝트 개요 및 기조](#1-프로젝트-개요-및-기조)
2. [개발 로드맵 (MVP 우선순위)](#2-개발-로드맵-mvp-우선순위)
3. [시스템 아키텍처](#3-시스템-아키텍처-3-tier-hybrid)
4. [코드 구조](#4-코드-구조-project-structure)
5. [핵심 기능 요구사항](#5-핵심-기능-요구사항-functional-requirements)
6. [루트 탐색 필터 명세](#6-루트-탐색-필터-명세-route-search-filter)
7. [데이터 흐름도](#7-데이터-흐름도-data-flow-diagram)
8. [데이터 스키마](#8-데이터-스키마-data-schema)
9. [기술 명세 및 제약 조항](#9-기술-명세-및-제약-조항-technical-specifications)
10. [배포 및 운영 정책](#10-배포-및-운영-정책)

---

## 1. 프로젝트 개요 및 기조

- **목적:** 거울 던전 선택지 가이드 및 실시간 보상 추적을 통한 유저 편의성 극대화
- **플랫폼:** PC 데스크톱 애플리케이션 (Windows 환경 우선 지원)

### 개발 기조

| 기조 | 설명 |
|---|---|
| 🔍 **Transparency** (투명성) | GitHub 전면 오픈소스 공개로 코드 투명성 확보 및 보안 취약점 원천 차단 |
| 🛡️ **Read-Only** (안전성) | 게임 내 조작(Input) 및 클라이언트 변조가 없는 비인젝션(Non-Injection) 방식 설계 |
| 📦 **Offline-First** (독립성) | 중앙 서버 가동 여부와 관계없이 핵심 기능이 100% 가동되는 하이브리드 아키텍처 |
| 🪶 **Ultra-Lightweight** (경량화) | 최초 설치 용량 **15MB 이하** 목표 (이미지 지연 로딩 적용) |

---

## 2. 개발 로드맵 (MVP 우선순위)

OCR 기반 보상 추적은 한글 인식, 해상도/DPI 차이, 빛 효과 및 애니메이션 등으로 인해 안정성 확보가 어렵습니다. **MVP 단계에서는 OCR 없이도 핵심 가치를 전달할 수 있는 기능을 먼저 출시하고, 유저 피드백을 반영하며 점진적으로 기능을 확장합니다.**

### Phase 1 — MVP (최초 출시)

> 목표: OCR 없이 즉시 사용 가능한 핵심 기능으로 초기 유저 확보

| 기능 | 설명 |
|---|---|
| ✅ **거던 선택지 가이드** | 거울 던전 이벤트/선택지별 보상 DB 기반 오버레이 가이드 |
| ✅ **루트 작성 및 로컬 저장** | 유저가 직접 루트를 작성하고 로컬에 저장 |
| ✅ **루트 공유 허브 (코드 방식)** | 6자리 난수 코드 기반 익명 루트 업로드/다운로드 |
| ✅ **루트 탐색 및 필터** | 패치 버전, 추천순, 목표 재화 등 필터 기반 루트 검색 |
| ✅ **추천(좋아요) 시스템** | UUID 기반 디바이스당 1추천, 패치 버전 단위 집계 |
| ✅ **이미지 지연 로딩 및 캐싱** | GitHub Raw → Cloudflare CDN 단계적 전환 |

> ⚠️ Phase 1에서 루트 공유의 **검증(Verified) 조건은 OCR이 아닌 자기 신고 방식**(체크박스)으로 대체합니다.
> OCR 검증은 Phase 2 이후 안정화되면 자동 대체됩니다.

---

### Phase 2 — OCR 베타 (안정화 목표)

> 목표: OCR 기능을 선택적(opt-in) 베타로 제공하여 안정성 검증

| 기능 | 설명 |
|---|---|
| 🔬 **OCR 보상 추적 (베타)** | 거던 클리어 결과창 자동 감지 및 아이템/수량 추출 |
| 🔬 **OCR 기반 루트 자동 검증** | 결과창 감지 시 `verified: true` 자동 플래그 |
| 🔬 **다양한 해상도/DPI 대응** | 창 모드, 전체화면, DPI scaling 별 캡처 보정 |

> 📌 OCR은 처음엔 **Tesseract.js (JS 기반)** 로 시작하여 빠르게 프로토타이핑하고,
> 인식률 및 성능 이슈 발생 시 **Rust OCR (leptess 바인딩)** 으로 마이그레이션합니다.

---

### Phase 3 — 고도화

> 목표: 유저 피드백 기반 기능 확장 및 품질 개선

| 기능 | 설명 |
|---|---|
| 🚀 **수집 목표 관리 대시보드** | 획득한 재화 누적 추적 및 목표 달성률 시각화 |
| 🚀 **루트 버전 만료 경고** | 현재 패치와 2버전 이상 차이 시 "오래된 루트" 배지 자동 표시 |
| 🚀 **클립보드 코드 감지** | 코드 복사 후 앱 실행 시 해당 루트 자동 불러오기 팝업 |
| 🚀 **macOS / Linux 지원 확장** | Windows 우선 이후 타 OS 지원 검토 |

---

## 3. 시스템 아키텍처 (3-Tier Hybrid)

본 프로그램은 로그인이나 회원가입 없이, 개인정보 유출 리스크가 없는 **익명 기반의 3티어 구조**를 채택하고 있습니다.

### 3.1. 아키텍처 구조

#### 🖥️ Client Layer (유저 PC 설치 앱 - Tauri)

- **UI / Frontend (React + TypeScript + Vite)**
  - 거던 가이드 및 루트 관리 대시보드 화면
  - 투명도 및 마우스 클릭 관통(`Click-through`) 오버레이 구현
  - Tailwind CSS + shadcn/ui 기반 컴포넌트
- **App Core / Backend (Rust)**
  - Windows Graphics Capture API를 통한 창 캡처 *(Phase 2~)*
  - OpenCV / Tesseract 기반 이미지 인식 및 OCR *(Phase 2~)*
  - 로컬 파일 시스템 제어

#### 💾 Local Storage Layer (유저 PC 내부 저장소)

- `%APPDATA%/LimbusGuide/` 경로에 유저 고유 데이터를 파일 형태로 안전하게 보관
  - `user_settings.json` — 앱 설정 및 **디바이스 고유 UUID** 포함
  - `my_routes.json` — 로컬 루트 데이터
  - `cache/` — 이미지 캐시 폴더

#### ☁️ Server & Data Layer (중앙 인프라)

- **Backend Server**
  - 최신 게임 데이터 패치 및 **현재 패치 버전 정보** 제공
  - CDN: **GitHub Raw → Cloudflare** 단계적 전환 (트래픽 증가 시)
  - 6자리 난수 코드 기반 익명 거던 루트 공유 허브
  - 루트별 패치 버전 단위 통계 집계 (플레이 수, 추천수)
  - Rate Limiting 적용으로 도배 방지
  - UUID 기반 중복 추천/플레이 방지

---

## 4. 코드 구조 (Project Structure)

```
guida/
│
├── src/                          # React 프론트엔드 (TypeScript)
│   ├── main.tsx                  # React 앱 진입점
│   ├── App.tsx                   # 루트 컴포넌트 / 라우팅
│   │
│   ├── components/               # 재사용 UI 컴포넌트
│   │   ├── ui/                   # shadcn/ui 기본 컴포넌트
│   │   ├── overlay/              # 오버레이 관련 컴포넌트
│   │   │   ├── OverlayWindow.tsx     # 오버레이 창 컨테이너
│   │   │   └── GuideHighlight.tsx    # 선택지 하이라이트
│   │   ├── route/                # 루트 관련 컴포넌트
│   │   │   ├── RouteCard.tsx         # 루트 카드 (탐색 화면)
│   │   │   ├── RouteEditor.tsx       # 루트 작성/편집기
│   │   │   └── RouteFilter.tsx       # 탐색 필터 패널
│   │   └── common/               # 공통 컴포넌트
│   │       ├── PatchBadge.tsx        # 패치 버전 배지
│   │       └── ImageWithFallback.tsx # 이미지 + Fallback 처리
│   │
│   ├── pages/                    # 페이지 단위 화면
│   │   ├── Dashboard.tsx         # 메인 대시보드
│   │   ├── Guide.tsx             # 거던 선택지 가이드
│   │   ├── RouteHub.tsx          # 루트 공유 허브 (탐색)
│   │   ├── MyRoutes.tsx          # 내 루트 관리
│   │   └── Settings.tsx          # 앱 설정
│   │
│   ├── store/                    # Zustand 전역 상태
│   │   ├── appStore.ts           # 앱 전반 상태 (패치버전, UUID 등)
│   │   ├── guideStore.ts         # 거던 가이드 상태
│   │   └── routeStore.ts         # 루트 데이터 상태
│   │
│   ├── hooks/                    # 커스텀 훅
│   │   ├── useTauriCommand.ts    # Tauri IPC 커맨드 호출 훅
│   │   ├── useImageCache.ts      # 이미지 캐싱 처리 훅
│   │   └── useRouteFilter.ts     # 루트 필터 로직 훅
│   │
│   ├── api/                      # 서버 API 통신
│   │   ├── client.ts             # Axios/Fetch 기본 설정
│   │   ├── routes.ts             # 루트 공유 허브 API
│   │   └── gameData.ts           # 게임 데이터 동기화 API
│   │
│   ├── types/                    # TypeScript 타입 정의
│   │   ├── route.ts              # 루트 관련 타입
│   │   ├── gameData.ts           # 게임 데이터 타입
│   │   └── settings.ts           # 설정 타입
│   │
│   └── assets/                   # 정적 에셋
│       ├── fallback.webp         # 이미지 로드 실패 시 대체 이미지
│       └── icons/                # 앱 아이콘
│
├── src-tauri/                    # Tauri / Rust 백엔드
│   ├── Cargo.toml                # Rust 의존성 관리
│   ├── tauri.conf.json           # Tauri 앱 설정
│   │
│   └── src/
│       ├── main.rs               # Tauri 앱 진입점
│       ├── lib.rs                # 모듈 선언
│       │
│       ├── commands/             # Tauri IPC 커맨드 (JS ↔ Rust 브릿지)
│       │   ├── mod.rs
│       │   ├── fs.rs             # 파일 시스템 읽기/쓰기
│       │   ├── settings.rs       # 설정 및 UUID 관리
│       │   └── capture.rs        # 화면 캡처 (Phase 2~)
│       │
│       ├── ocr/                  # OCR 처리 모듈 (Phase 2~)
│       │   ├── mod.rs
│       │   ├── capture.rs        # Windows Graphics Capture API
│       │   ├── preprocess.rs     # 캡처 이미지 전처리 (OpenCV)
│       │   └── recognize.rs      # 텍스트 인식 (Tesseract/leptess)
│       │
│       └── utils/                # 공통 유틸리티
│           ├── mod.rs
│           └── uuid.rs           # UUID 생성 및 관리
│
├── data/                         # 게임 데이터 JSON (서버 배포용)
│   ├── game_data.json            # 거던 이벤트/선택지/보상 데이터
│   └── patch_version.json        # 현재 패치 버전 정보
│
├── public/                       # Vite 정적 파일
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── LICENSE
└── README.md
```

### 4.1. 주요 디렉토리 설명

| 경로 | 역할 |
|---|---|
| `src/components/overlay/` | 게임 위에 띄우는 오버레이 창 컴포넌트. 클릭 관통 처리 포함 |
| `src/store/` | Zustand 기반 전역 상태. 컴포넌트 간 데이터 공유 |
| `src/api/` | 서버와의 HTTP 통신 로직만 분리. 컴포넌트에서 직접 fetch 금지 |
| `src-tauri/src/commands/` | JS에서 호출 가능한 Rust 함수 모음. IPC 브릿지 역할 |
| `src-tauri/src/ocr/` | Phase 2에서 추가. 화면 캡처 → 전처리 → 인식 파이프라인 |
| `data/` | 패치마다 업데이트하는 게임 데이터. CDN으로 서빙 |

---

## 5. 핵심 기능 요구사항 (Functional Requirements)

### 10.1. 🎯 거울 던전 실시간 선택지 가이드 (Mirror Dungeon Guide)
`Phase 1`

- 거울 던전 내 조우하는 이벤트 및 선택지별 보상 데이터베이스 탑재
- 유저가 설정한 파밍 목적에 맞춰 **최적의 선택지를 오버레이 화면에 추천 및 하이라이트** 노출

---

### 10.2. 🔗 거던 루트 익명 공유 허브 (Route Sharing Hub)
`Phase 1`

림버스 컴퍼니는 **약 2주 주기로 신규 인격 및 에고기프트가 추가**되므로, 패치 버전을 기준으로 루트의 유효성과 통계를 관리합니다.

#### 루트 업로드

- 유저가 로컬에서 작성한 루트를 **로그인 없이** 서버에 업로드
- **Phase 1 공유 조건:** "실제로 이 루트로 플레이했습니다" 자기 신고 체크박스 확인
- **Phase 2 이후:** OCR 결과창 감지 시 자동 검증으로 대체
- 업로드 시 서버에서 **현재 패치 버전 자동 태깅** (유저 입력 불필요)
- 서버 검증 후 **6자리 고유 난수 코드** (예: `X7R2B9`) 발급

#### 루트 탐색 및 검색

- 6자리 코드 직접 입력으로 특정 루트 즉시 호출
- 탐색 화면에서 필터/정렬 조합으로 루트 검색 (섹션 6 참조)

#### 추천(좋아요) 시스템

- 앱 최초 실행 시 생성된 **디바이스 UUID** 기반으로 디바이스당 루트 1추천 제한
- 추천수, 플레이 수는 **패치 버전 단위로 집계** → 버전이 달라지면 카운터 초기화
- 이전 패치 데이터는 아카이브로 보존되어 버전별 경향성 조회 가능

---

### 8.3. 📊 인게임 실시간 보상 추적 (Real-time Reward Tracking)
`Phase 2 — OCR 베타`

> ⚠️ OCR 안정성(한글 인식, 해상도/DPI/애니메이션 대응) 확보 후 도입합니다.
> Phase 1에서는 해당 기능이 포함되지 않습니다.

- 거울 던전 클리어 후 등장하는 **'보상 획득 결과 창'** 을 백그라운드에서 실시간 모니터링 및 감지
- 결과 창 감지 시 해당 영역을 순간 캡처하여 OCR로 획득 아이템 종류와 수량 추출
- 로컬 데이터에 자동 반영
- 결과 창 감지 이벤트 발생 시 현재 사용 루트에 `verified: true` 자동 플래그 기록 → **루트 공유 자동 검증**으로 전환

---

## 6. 루트 탐색 필터 명세 (Route Search Filter)
`Phase 1`

### 10.1. 기본 필터

| 필터 | 옵션 | 기본값 |
|---|---|---|
| **패치 버전** | 현재 패치 / 전체 / 버전 직접 선택 | 현재 패치 |
| **정렬 기준** | 추천순 / 최신순 / 플레이 많은순 | 추천순 |
| **검증 여부** | 전체 / 검증된 루트만 | 검증된 루트만 |

### 10.2. 게임 콘텐츠 필터 (림버스 특화)

| 필터 | 설명 |
|---|---|
| **목표 재화** | 특정 에고기프트 / 루심화폐 / 기타 특정 재화 |
| **거던 층수** | 전체 / 특정 층 집중 루트 |
| **난이도 태그** | 작성자 자체 태그 (쉬움 / 보통 / 어려움) |
| **루트 유형** | 파밍 효율 중심 / 특정 목표 중심 |

### 8.3. 신뢰도 필터

| 필터 | 설명 |
|---|---|
| **최소 추천수** | 예) 추천 5개 이상만 표시 |
| **최소 플레이수** | 예) 3회 이상 사용된 루트만 |

> ⚠️ 패치 버전 필터의 기본값은 항상 **현재 패치**로 고정됩니다. 신규 인격/에고기프트 추가로 메타가 빠르게 변하는 림버스의 특성을 반영합니다.

---

## 7. 데이터 흐름도 (Data Flow Diagram)

### 10.1. 최초 실행 및 데이터 동기화

```text
[ 앱 최초 실행 ]
        │
        ├─► UUID 존재 여부 확인
        │       ├─► 없음: UUID 신규 생성 후 user_settings.json 저장
        │       └─► 있음: 기존 UUID 로드
        │
        ▼
[ 클라이언트 (Tauri) ] ──( 1. 버전 체크 요청 )──► [ 중앙 서버 / DB ]
        │                                              │
        │ ◄──( 2. 최신 게임 데이터 JSON +             │
        │        현재 패치 버전 반환 )─────────────────┘
        ▼
[ 로컬 정적 데이터 가공 ]
(게임 데이터 JSON 및 현재 패치 버전을 로컬 메모리에 탑재)
```

### 10.2. 루트 업로드 및 코드 발급 (Phase 1 — 자기 신고 방식)

```text
[ 유저: 루트 작성 완료 후 '공유하기' 클릭 ]
        │
        ▼
[ "실제로 이 루트로 플레이했습니다" 체크박스 확인 ]
        │
        ▼
[ 루트 데이터 + UUID + 현재 패치 버전 → 서버 전송 ]
        │
        ▼
[ 서버: 데이터 유효성 검증 + 패치 버전 자동 태깅 ]
        │
        ▼
[ 6자리 난수 코드 발급 (예: X7R2B9) → 클라이언트 반환 ]
        │
        ▼
[ 유저: 코드 복사 후 커뮤니티 등에 공유 ]
```

### 8.3. OCR 기반 루트 자동 검증 (Phase 2 이후)

```text
[ 거던 플레이 중 - 백그라운드 모니터링 ]
        │
        ▼
[ 보상 획득 결과 창 감지 (OCR) ]
        │
        ▼
[ 현재 활성 루트에 검증 플래그 자동 기록 ]
  my_routes.json: { verified: true, verified_at: "타임스탬프" }
        │
        ▼
[ 해당 루트의 '공유하기' 버튼 자동 활성화 ]
(Phase 1의 자기 신고 체크박스 대체)
```

### 7.4. 추천(좋아요) 흐름

```text
[ 유저: 루트 탐색 중 '추천' 버튼 클릭 ]
        │
        ▼
[ 서버: { uuid, route_code, patch_version } 조합 중복 확인 ]
        │
        ├─► 중복: 요청 거부 (이미 추천한 루트)
        │
        └─► 최초: 추천수 +1 반영 (패치 버전 단위 카운터)
```

### 7.5. UI 이미지 지연 로딩(Lazy Loading) 및 로컬 캐싱

> 최초 설치 용량을 최소화하기 위해 모든 이미지(512 × 512 WebP 포맷)는 앱에 내장하지 않고, 필요할 때 실시간으로 스트리밍 및 캐싱합니다.

```text
[ UI에서 특정 이미지(예: 'greg_01.webp') 요청 ]
              │
              ├─► [ 조건 A ] 이미 로컬 캐시 폴더에 파일이 존재하는가?
              │         │
              │         └─► YES: [로컬 저장소]에서 즉시 로드
              │                  (서버 통신 0원, 최고 속도) ──► 화면 표시
              │
              └─► [ 조건 B ] 로컬 캐시 폴더에 파일이 없는가? (최초 조회 시)
                        │
                        ├──► [ 서버 정상 ]
                        │         │
                        │         ▼
                        │   [CDN]에 이미지 다운로드 요청
                        │         │
                        │         ├─► 1. 로컬 캐시 폴더에 파일 저장
                        │         │      (이후 조건 A로 진입)
                        │         └─► 2. 화면에 이미지 표시
                        │
                        └──► [ 서버 다운 ]: 다운로드 실패
                                  │
                                  ▼
                            [우아한 예외 처리 (Fallback)]
                                  │
                                  └─► 앱에 내장된 '기본 대체 이미지' 또는
                                      '텍스트 타이틀'로 대체하여 앱 중단 방지
```

---

## 8. 데이터 스키마 (Data Schema)

### 10.1. 로컬 — `user_settings.json`

```json
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "app_version": "1.0.0",
  "current_patch": "2.4",
  "theme": "dark",
  "overlay_opacity": 0.85
}
```

### 10.2. 로컬 — `my_routes.json` (루트 1개 예시)

```json
{
  "routes": [
    {
      "local_id": "route_001",
      "name": "주간 루심화폐 파밍 루트",
      "created_at": "2025-06-01T12:00:00Z",
      "patch_version": "2.4",
      "verified": false,
      "verified_method": "self_report",
      "verified_at": "2025-06-02T09:30:00Z",
      "shared_code": "X7R2B9",
      "target_rewards": ["루심화폐", "황금가지"],
      "difficulty_tag": "보통",
      "route_type": "파밍 효율 중심",
      "floors": [1, 2, 3, 4, 5, 6, 7],
      "memo": "3층 선택지 주의"
    }
  ]
}
```

> 📌 `verified_method` 필드는 검증 방식을 추적합니다.
> - `"self_report"` — Phase 1: 자기 신고 체크박스
> - `"ocr"` — Phase 2 이후: OCR 자동 감지

### 8.3. 서버 — 루트 공개 데이터 구조

```json
{
  "route_code": "X7R2B9",
  "patch_version": "2.4",
  "name": "주간 루심화폐 파밍 루트",
  "difficulty_tag": "보통",
  "route_type": "파밍 효율 중심",
  "target_rewards": ["루심화폐", "황금가지"],
  "floors": [1, 2, 3, 4, 5, 6, 7],
  "memo": "3층 선택지 주의",
  "verified_method": "self_report",
  "stats": {
    "2.4": { "likes": 18, "play_count": 42 },
    "2.3": { "likes": 55, "play_count": 130 }
  },
  "uploaded_at": "2025-06-01T15:00:00Z"
}
```

> 📌 `stats` 객체는 패치 버전을 키로 사용하여 버전별 추천수 및 플레이 수를 독립적으로 관리합니다. 이전 패치 데이터는 삭제되지 않고 아카이브로 보존됩니다.

---

## 9. 기술 명세 및 제약 조항 (Technical Specifications)

### 10.1. 세부 기술 스택

| 구분 | Phase 1 | Phase 2~ |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui | 동일 |
| **상태 관리** | Zustand | 동일 |
| **Backend Bridge** | Tauri v2 Core (Rust) | 동일 |
| **Screen Capture** | — | Windows Graphics Capture API |
| **OCR** | — | Tesseract.js (초기) → leptess Rust 바인딩 (성능 이슈 시) |
| **Image Processing** | — | OpenCV (Rust Binding) |
| **CDN** | GitHub Raw | Cloudflare (트래픽 증가 시 전환) |
| **Resource Format** | 512 × 512 WebP (장당 30KB~50KB) | 동일 |

### 10.2. 개발 제약 및 예외 처리 가이드라인

#### 🚫 No Memory Touch

`OpenProcess` 등 게임 프로세스에 직접 관여하는 시스템 API 호출을 **금지**하여 안티치트(보안 프로그램) 오탐지를 원천 차단합니다.

#### 🚫 No Input Injection

마우스 클릭 및 키보드 스트로크를 가로채거나 입력하는 자동화 코드는 **포함될 수 없습니다.**

#### ✅ 서버 오프라인 대응

중앙 서버나 DB가 다운되더라도, 이미 로컬에 캐싱된 이미지와 `game_data.json`, 로컬 루트 데이터를 기반으로 **실시간 오버레이 가이드 기능은 100% 정상 작동** 해야 합니다.

> ⚠️ 단, 루트 공유 / 탐색 / 추천 기능만 제한됨

#### ✅ 화면 캡처 권한 명시 (Phase 2~)

Windows Graphics Capture API 사용 시 **앱 UI에서 유저에게 화면 캡처 권한을 명시적으로 요청**하고, 용도와 범위를 명확히 안내합니다.

---

## 10. 배포 및 운영 정책

### 10.1. 배포 방식

- GitHub Releases를 통한 `.exe` 설치 파일 배포
- 각 릴리즈에 **VirusTotal 스캔 결과 링크** 첨부 (유저 신뢰 확보)
- 오픈소스 공개로 코드 투명성 보장

### 10.2. 베타 출시 전략

1. **디시인사이드 림버스 컴퍼니 갤러리**에 베타 테스트 모집 공고
2. "OCR 없이도 루트 공유/검색 즉시 사용 가능" 강조
3. 오버레이 실시간 가이드 **데모 영상** (유튜브/X) 선공개로 관심 유도
4. 초기 피드백 기반으로 OCR Phase 2 개발 방향 결정

### 10.3. 유지보수 정책

- 패치 적용 시 **게임 데이터 JSON 업데이트** + 현재 패치 버전 정보 갱신
- Phase 2 이후 OCR 도입 시 **해상도/DPI별 캡처 보정 템플릿** 별도 관리
- 앱 최초 실행 시 **비공식 팬 프로젝트 고지 팝업** 필수 노출

---

## 📜 License

본 프로젝트는 **MIT License** 하에 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE) 파일을 참조하세요.

### ⚠️ 비공식 팬 프로젝트 고지

본 프로젝트는 Project Moon의 팬이 제작한 **비공식 서드파티 도구**입니다.
림버스 컴퍼니(Limbus Company)의 저작권 및 관련 지식재산권 일체는 **Project Moon**에 귀속됩니다.
본 프로젝트는 Project Moon과 공식적인 제휴 또는 후원 관계가 없으며, 어떠한 상업적 목적으로도 사용되지 않습니다.

> This project is an unofficial fan-made tool and is not affiliated with, endorsed by, or sponsored by Project Moon.
> All rights to Limbus Company and related intellectual property belong to Project Moon.

---

*This document is the living specification of the Guida project.*