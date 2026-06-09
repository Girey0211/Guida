# 🧭 Guida (가이다)

> 림버스 컴퍼니 유저의 거울 던전 플레이 및 수집 목표 관리를 돕기 위한 **PC 전용 데스크톱 편의성 애플리케이션**입니다.
>
> 오픈소스의 투명성을 기반으로 하며, 게임의 공정성을 해치지 않는 **'읽기 전용(Read-Only)'** 및 **'로컬 중심(Offline-First)'** 설계를 지향합니다.
>
> *"Guida"는 단테의 신곡에서 베르길리우스가 단테의 안내자(길잡이)로 불리던 이탈리아어 단어입니다. 한국어 표기 및 약칭은 **가이다**입니다.*

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
11. [화면 구조 및 UI 명세](#11-화면-구조-및-ui-명세)
12. [디자인 시스템](#12-디자인-시스템-design-system)

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
| ✅ **이미지 지연 로딩 및 캐싱** | 이미지 키 구조 확보, MVP는 텍스트+배지로 대체 운영 |

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
| 🔬 **게임 이미지 에셋 도입** | CDN 이미지 제공 시작, `ImageWithFallback` 컴포넌트로 점진 전환 |

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

- `%APPDATA%/Guida/` 경로에 유저 고유 데이터를 파일 형태로 안전하게 보관
  - `user_settings.json` — 앱 설정 및 **디바이스 고유 UUID** 포함
  - `my_routes.json` — 로컬 루트 데이터
  - `cache/` — 게임 데이터 이미지 캐시 폴더 (Phase 2~)

#### ☁️ Server & Data Layer (중앙 인프라)

- **CDN (정적 파일 서빙)**
  - 게임 데이터 JSON 4종 (`gifts.json`, `packs.json`, `events.json`, `dependencies.json`)
  - 현재 패치 버전 정보 (`patch_version.json`)
  - 게임 이미지 에셋 (Phase 2~)
  - 초기: GitHub Raw / 트래픽 증가 시: Cloudflare CDN으로 전환
- **Backend Server (동적 API)**
  - 6자리 난수 코드 기반 익명 거던 루트 공유 허브
  - 루트별 패치 버전 단위 통계 집계 (추천수, 조회수)
  - Rate Limiting 적용으로 도배 방지
  - UUID 기반 중복 추천 방지

### 3.2. 데이터 저장소 분류 원칙

| 데이터 종류 | 변경 빈도 | 저장소 | 이유 |
|---|---|---|---|
| 에고기프트 / 팩 / 선택지 / 의존성 | 패치마다 | **CDN JSON** | 읽기 전용, 전 유저 동일, 오프라인 캐싱 적합 |
| 게임 이미지 에셋 | 패치마다 | **CDN + 로컬 캐시** | 용량 크므로 지연 로딩 및 로컬 캐싱 |
| 루트 공유 / 추천 / 조회 통계 | 실시간 | **DB (서버)** | 유저마다 다르고 실시간 누적 |
| 유저 설정 / 로컬 루트 / 플레이 세션 | 유저 행동마다 | **로컬 파일** | 개인 데이터, 서버 불필요 |

---

## 4. 코드 구조 (Project Structure)

```
guida/
│
├── src/                          # React 프론트엔드 (TypeScript)
│   ├── main.tsx
│   ├── App.tsx
│   │
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 기본 컴포넌트
│   │   ├── overlay/
│   │   │   ├── OverlayWindow.tsx
│   │   │   └── GuideHighlight.tsx
│   │   ├── route/
│   │   │   ├── RouteCard.tsx
│   │   │   ├── RouteEditor.tsx       # 루트 작성/편집 + 의존성 경고 UI
│   │   │   └── RouteFilter.tsx
│   │   └── common/
│   │       ├── PatchBadge.tsx
│   │       ├── KeywordBadge.tsx      # 키워드 색상 배지 (이미지 대체용)
│   │       └── ImageWithFallback.tsx # 이미지 + 텍스트 폴백 처리
│   │
│   ├── pages/
│   │   ├── BaseScreen.tsx        # 기본화면 (탭 컨테이너)
│   │   ├── PlayScreen.tsx        # 플레이화면 (거던 진행 중)
│   │   └── Settings.tsx
│   │
│   ├── store/
│   │   ├── appStore.ts
│   │   ├── guideStore.ts
│   │   ├── routeStore.ts
│   │   └── playStore.ts          # 플레이 세션 상태
│   │
│   ├── hooks/
│   │   ├── useTauriCommand.ts
│   │   ├── useImageCache.ts
│   │   ├── useRouteFilter.ts
│   │   └── useDependencyCheck.ts # 기프트 의존성 검증 훅
│   │
│   ├── api/
│   │   ├── client.ts
│   │   ├── routes.ts
│   │   └── gameData.ts           # gifts / packs / events / dependencies 병렬 로드
│   │
│   ├── types/
│   │   ├── route.ts
│   │   ├── gameData.ts           # EgoGift, Pack, Event, Dependency 타입
│   │   └── settings.ts
│   │
│   └── assets/
│       ├── fallback.webp         # 이미지 로드 실패 시 대체 (Phase 2~)
│       └── icons/
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── fs.rs
│       │   ├── settings.rs
│       │   └── capture.rs        # Phase 2~
│       ├── ocr/                  # Phase 2~
│       │   ├── mod.rs
│       │   ├── capture.rs
│       │   ├── preprocess.rs
│       │   └── recognize.rs
│       └── utils/
│           ├── mod.rs
│           └── uuid.rs
│
├── data/                         # CDN 서빙용 게임 데이터
│   ├── patch_version.json
│   ├── gifts.json                # 에고기프트 전체
│   ├── packs.json                # 팩 전체
│   ├── events.json               # 선택지 이벤트 전체
│   └── dependencies.json         # 기프트 순서 의존성
│
├── public/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── LICENSE
└── README.md
```

---

## 5. 핵심 기능 요구사항 (Functional Requirements)

### 5.1. 🎯 거울 던전 실시간 선택지 가이드
`Phase 1`

- 거울 던전 내 조우하는 이벤트 및 선택지별 보상 데이터베이스 탑재
- 유저가 설정한 파밍 목적에 맞춰 **최적의 선택지를 오버레이 화면에 추천 및 하이라이트** 노출

### 5.2. 🔗 거던 루트 익명 공유 허브
`Phase 1`

림버스 컴퍼니는 **약 2주 주기로 신규 인격 및 에고기프트가 추가**되므로, 패치 버전을 기준으로 루트의 유효성과 통계를 관리합니다.

#### 루트 업로드

- 유저가 로컬에서 작성한 루트를 **로그인 없이** 서버에 업로드
- **Phase 1 공유 조건:** "실제로 이 루트로 플레이했습니다" 자기 신고 체크박스
- **Phase 2 이후:** OCR 결과창 감지 시 자동 검증으로 대체
- 업로드 시 서버에서 **현재 패치 버전 자동 태깅**
- 서버 검증 후 **6자리 고유 난수 코드** (예: `X7R2B9`) 발급

#### 루트 탐색 및 검색

- 6자리 코드 직접 입력으로 특정 루트 즉시 호출
- 탐색 화면에서 필터/정렬 조합으로 루트 검색 (섹션 6 참조)

#### 추천(좋아요) 시스템

- 앱 최초 실행 시 생성된 **디바이스 UUID** 기반으로 디바이스당 루트 1추천 제한
- 추천수는 **패치 버전 단위로 집계** → 버전이 달라지면 카운터 초기화
- 이전 패치 데이터는 아카이브로 보존

#### 조회수 집계

- 코드로 루트를 조회(`GET /routes/:code`)할 때마다 +1 (Phase 1)
- Phase 2 이후 OCR 연동 시 실제 플레이 기반 카운트로 전환 검토

### 5.3. 📊 인게임 실시간 보상 추적
`Phase 2 — OCR 베타`

- 거울 던전 클리어 후 등장하는 **'보상 획득 결과 창'** 백그라운드 모니터링 및 감지
- 결과 창 감지 시 해당 영역 캡처 → OCR로 획득 아이템 종류 및 수량 추출
- 로컬 데이터에 자동 반영
- 결과 창 감지 시 현재 사용 루트에 `verified: true` 자동 플래그 → 루트 공유 자동 검증으로 전환

### 5.4. 🖥️ 화면 전환 자동화
`Phase 1`

- 앱 켜져 있는 동안 **백그라운드에서 게임 화면 지속 모니터링**
- 거던 탐사 시작 화면 감지 시 기본화면 → 플레이화면 **자동 전환**
- 탐사 종료 감지 시 플레이화면 → 기본화면으로 복귀

---

## 6. 루트 탐색 필터 명세 (Route Search Filter)
`Phase 1`

### 6.1. 기본 필터

| 필터 | 옵션 | 기본값 |
|---|---|---|
| **패치 버전** | 현재 패치 / 전체 / 버전 직접 선택 | 현재 패치 |
| **정렬 기준** | 추천순 / 최신순 / 조회 많은순 | 추천순 |
| **검증 여부** | 전체 / 검증된 루트만 | 검증된 루트만 |

### 6.2. 게임 콘텐츠 필터

| 필터 | 설명 |
|---|---|
| **목표 재화** | 특정 에고기프트 / 루심화폐 / 기타 특정 재화 |
| **거던 층수** | 전체 / 특정 층 집중 루트 |
| **난이도 태그** | 쉬움 / 보통 / 어려움 |
| **루트 유형** | 파밍 효율 중심 / 특정 목표 중심 |

### 6.3. 신뢰도 필터

| 필터 | 설명 |
|---|---|
| **최소 추천수** | 예) 추천 5개 이상만 표시 |
| **최소 조회수** | 예) 3회 이상 조회된 루트만 |

> ⚠️ 패치 버전 필터의 기본값은 항상 **현재 패치**로 고정됩니다.

---

## 7. 데이터 흐름도 (Data Flow Diagram)

### 7.1. 최초 실행 및 데이터 동기화

```text
[ 앱 최초 실행 ]
        │
        ├─► UUID 존재 여부 확인
        │       ├─► 없음: UUID 신규 생성 후 user_settings.json 저장
        │       └─► 있음: 기존 UUID 로드
        │
        ▼
[ CDN에 버전 체크 요청 ]
        │
        ├─► 로컬 캐시 버전 == 서버 버전: 로컬 캐시 사용
        │
        └─► 버전 차이 있음: 변경된 JSON 파일만 선택적 다운로드
              (gifts.json / packs.json / events.json / dependencies.json 병렬 요청)
        │
        ▼
[ 게임 데이터 메모리 탑재 완료 → 앱 사용 가능 ]
```

### 7.2. 루트 업로드 및 코드 발급 (Phase 1)

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
```

### 7.3. OCR 기반 루트 자동 검증 (Phase 2 이후)

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
```

### 7.4. 추천(좋아요) 흐름

```text
[ 유저: 루트 탐색 중 '추천' 버튼 클릭 ]
        │
        ▼
[ 서버: { uuid, route_code, patch_version } 조합 중복 확인 ]
        │
        ├─► 중복: 요청 거부
        └─► 최초: 추천수 +1 반영 (패치 버전 단위 카운터)
```

### 7.5. 이미지 로딩 흐름 (Phase 2~)

```text
[ UI에서 이미지 요청 (category/key) ]
        │
        ├─► 로컬 캐시 존재: 즉시 로드 → 화면 표시
        │
        └─► 캐시 없음
                ├─► CDN 정상: 다운로드 → 캐시 저장 → 화면 표시
                └─► CDN 다운: KeywordBadge(텍스트) 폴백으로 대체
```

> 📌 Phase 1에서는 이미지 없이 `KeywordBadge` 컴포넌트(텍스트+색상 배지)로 운영합니다.
> `image_key` 필드는 스키마에 정의해두되 실제 파일은 Phase 2~에서 채웁니다.

---

## 8. 데이터 스키마 (Data Schema)

### 8.1. 로컬 — `user_settings.json`

```json
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "app_version": "1.0.0",
  "current_patch": "2.4",
  "theme": "dark",
  "overlay_opacity": 0.85
}
```

### 8.2. 로컬 — `my_routes.json`

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
      "memo": "3층 선택지 주의",
      "gift_order": [
        { "gift_id": "gift_네뷸라이저", "priority": 1, "floor_target": 2 },
        { "gift_id": "gift_물부리",    "priority": 2, "floor_target": 3 },
        { "gift_id": "gift_황금가지",  "priority": 3, "floor_target": null }
      ]
    }
  ]
}
```

> 📌 `verified_method`: `"self_report"` (Phase 1) / `"ocr"` (Phase 2~)
> 📌 `gift_order`: 단순 목록 대신 **우선순위와 목표 층이 포함된 순서 있는 배열**로 관리

### 8.3. 로컬 — 플레이 세션 상태 (`playStore` 메모리)

세션 종료 시 `my_routes.json`에 병합 저장됩니다.

```json
{
  "session_id": "sess_20250601_001",
  "active_route_id": "route_001",
  "started_at": "2025-06-01T14:00:00Z",
  "acquired_gifts": ["gift_네뷸라이저"],
  "visited_packs": ["pack_001"],
  "current_floor": 3,
  "route_switched_at_floor": null
}
```

> 📌 `route_switched_at_floor`: 플레이 중 루트 변경 시 해당 층 번호 기록.
> 변경 전 획득 데이터는 보존, 변경 시점 이후의 가이드만 새 루트 기준으로 업데이트.

### 8.4. 서버 — 루트 공개 데이터

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
  "gift_order": [
    { "gift_id": "gift_네뷸라이저", "priority": 1, "floor_target": 2 },
    { "gift_id": "gift_물부리",    "priority": 2, "floor_target": 3 },
    { "gift_id": "gift_황금가지",  "priority": 3, "floor_target": null }
  ],
  "verified_method": "self_report",
  "stats": {
    "2.4": { "likes": 18, "view_count": 42 },
    "2.3": { "likes": 55, "view_count": 130 }
  },
  "uploaded_at": "2025-06-01T15:00:00Z"
}
```

### 8.5. CDN — 게임 데이터 JSON 구조

앱 시작 시 아래 4개 파일을 **병렬로** 요청합니다. 각 파일은 독립적으로 CDN 캐싱됩니다.

```
data/
├── patch_version.json     ← 현재 패치 버전 (가장 먼저 체크)
├── gifts.json             ← 에고기프트 전체 목록
├── packs.json             ← 팩 전체 목록
├── events.json            ← 선택지 이벤트 전체 목록
└── dependencies.json      ← 기프트 간 순서 의존성
```

#### `gifts.json` — 에고기프트

```json
[
  {
    "id": "gift_물부리",
    "name": "물부리",
    "image_key": "gifts/gift_물부리.webp",
    "ocr_keywords": ["물부리"],
    "keyword_color": "#4A90D9",

    "grade": "희귀",
    "keyword_type": "호흡",
    "source_type": "층클리어보상",

    "effect": "호흡 횟수 보유 시 공격 스킬 위력 +3",
    "upgrade_effects": [
      { "level": 1, "effect": "위력 +3" },
      { "level": 2, "effect": "위력 +5" }
    ],
    "max_upgrade": 2,

    "is_craftable": false,
    "craft_recipe": null,
    "craft_result_of": null,

    "pack_exclusive": false,
    "pack_id": null,
    "hard_mode_only": false,

    "available_floors": [1, 2, 3, 4, 5],
    "added_patch": "2.1",
    "tags": ["호흡", "위력증가"]
  }
]
```

> 📌 `image_key`: 이미지 파일 경로 키. Phase 1에서는 `null`이거나 빈 값이면 `KeywordBadge`로 폴백.
> 📌 `keyword_color`: 키워드 배지 색상. 이미지 없는 Phase 1에서 시각 식별의 핵심.
> 📌 `keyword_type`: 범용 / 화상 / 출혈 / 진동 / 파열 / 침잠 / 호흡 / 충격
> 📌 `source_type`: 이벤트선택지 / 층클리어보상 / 상점 / 합성결과
> 📌 `craft_recipe`: 합성 기프트인 경우 재료 gift_id 배열 (예: `["gift_A", "gift_B"]`)
> 📌 `craft_result_of`: 이 기프트가 합성 재료로 쓰일 때 결과물 gift_id

#### `packs.json` — 팩

```json
[
  {
    "id": "pack_심야청소",
    "name": "심야청소",
    "image_key": "packs/pack_심야청소.webp",
    "ocr_keywords": ["심야청소"],

    "pack_type": "테마",
    "keyword_affinity": ["출혈", "침잠"],

    "available_floors": [1, 2, 3],
    "available_modes": ["노말", "하드"],
    "is_extreme_only": false,

    "exclusive_gifts": ["gift_045", "gift_046"],
    "exclusive_craft_gift": "gift_089",

    "events": ["event_031", "event_032", "event_033"],

    "added_patch": "2.0",
    "tags": ["W사", "흑수"]
  }
]
```

> 📌 `pack_type`: 테마 / 키워드 / 거울굴절철도 / EXTREME전용
> 📌 `exclusive_gifts`: 이 팩에서만 얻을 수 있는 기프트 id 목록 → 플레이화면 팩탭 강조 배지의 핵심 데이터
> 📌 `keyword_affinity`: 이 팩 선택 시 드랍률이 오르는 키워드 기프트 종류

#### `events.json` — 선택지 이벤트

```json
[
  {
    "id": "event_기습",
    "name": "기습",
    "image_key": "events/event_기습.webp",
    "ocr_keywords": ["기습"],

    "pack_id": "pack_심야청소",
    "is_field_event": true,
    "description": "갑작스러운 기습 상황.",

    "choices": [
      {
        "choice_id": "c1",
        "text": "맞서 싸운다",
        "has_skill_check": true,
        "check_sin": ["분노", "색욕"],
        "check_threshold": 8,
        "on_success": {
          "reward_type": "gift",
          "reward_id": "gift_045",
          "description": "에고기프트 획득"
        },
        "on_failure": {
          "reward_type": "damage",
          "description": "수감자 피해"
        }
      },
      {
        "choice_id": "c2",
        "text": "도망친다",
        "has_skill_check": false,
        "on_success": {
          "reward_type": "none",
          "description": "아무 일도 없음"
        }
      }
    ],

    "recommended_choice_id": "c1",
    "recommended_reason": "판정 성공 시 팩 한정 기프트 획득",

    "added_patch": "2.0",
    "tags": ["전투선택지", "심야청소"]
  }
]
```

> 📌 `check_sin`: 판정에 쓰이는 죄종 — 분노 / 색욕 / 우울 / 나태 / 폭식 / 질투 / 오만
> 📌 `recommended_choice_id`: 가이다가 플레이화면 선택지탭에서 Amber로 하이라이트할 최적 선택지
> 📌 `reward_type`: gift / currency / damage / nothing / combat

#### `dependencies.json` — 기프트 순서 의존성

```json
[
  {
    "gift_id": "gift_물부리",
    "dependencies": [
      {
        "target_gift_id": "gift_네뷸라이저",
        "type": "before",
        "required": false,
        "reason": "네뷸라이저 보유 시 물부리의 호흡 위력 증가 효과가 즉시 적용됨. 역순 시 효과 손실."
      }
    ]
  }
]
```

**`type` 정의**

| type | 의미 |
|---|---|
| `before` | 이 기프트는 대상보다 **나중에** 획득해야 함 |
| `after` | 이 기프트는 대상보다 **먼저** 획득해야 함 |
| `with` | 같이 보유해야 효과 발동 (순서 무관, 시너지) |
| `excludes` | 같이 가져가면 효과 충돌 (상충 관계) |

**`required` 정의**
- `true` — 선행 조건 없으면 효과 아예 발동 안 됨
- `false` — 동작하나 효과 반감 (물부리 케이스)

> ⚠️ **순환 참조 방지:** `dependencies.json` 빌드 시 DAG(방향 비순환 그래프) 검증 스크립트를 실행하여 A→B→A 같은 순환 의존성을 사전 차단합니다.

### 8.6. 의존성 기반 루트 편집기 동작

**루트 편집 시 경고**

유저가 기프트를 추가하거나 순서를 바꿀 때, `useDependencyCheck` 훅이 `dependencies.json`을 참조하여 순서 위반을 감지하고 경고를 표시합니다.

```
⚠️ 물부리는 네뷸라이저보다 나중에 획득하는 것을 권장합니다.
   현재 순서: 물부리(1번) → 네뷸라이저(2번)
   [순서 자동 수정]  [무시하고 유지]
```

**플레이화면 에고기프트 탭 잠금 표시**

선행 조건이 아직 충족되지 않은 기프트는 잠금 배지를 표시합니다.

```
✅ 네뷸라이저          ← 획득 목표 (상단 표시)
🔒 물부리              ← [네뷸라이저 먼저 필요] 배지
```

네뷸라이저를 획득 완료 처리하는 순간 물부리의 잠금이 자동 해제됩니다.

---

## 9. 기술 명세 및 제약 조항

### 9.1. 세부 기술 스택

| 구분 | Phase 1 | Phase 2~ |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui | 동일 |
| **상태 관리** | Zustand | 동일 |
| **Backend Bridge** | Tauri v2 Core (Rust) | 동일 |
| **Screen Capture** | — | Windows Graphics Capture API |
| **OCR** | — | Tesseract.js (초기) → leptess Rust 바인딩 |
| **Image Processing** | — | OpenCV (Rust Binding) |
| **CDN** | GitHub Raw | Cloudflare (트래픽 증가 시 전환) |
| **이미지 표현** | KeywordBadge (텍스트+색상) | 512×512 WebP (장당 30~50KB) |

### 9.2. 개발 제약

#### 🚫 No Memory Touch
`OpenProcess` 등 게임 프로세스에 직접 관여하는 시스템 API 호출 **금지**.

#### 🚫 No Input Injection
마우스 클릭 및 키보드 스트로크 자동화 코드 **포함 불가**.

#### ✅ 서버 오프라인 대응
중앙 서버 다운 시에도 로컬 캐시 기반으로 **실시간 오버레이 가이드 기능 100% 정상 작동**.
단, 루트 공유 / 탐색 / 추천 기능만 제한됨.

#### ✅ 화면 캡처 권한 명시 (Phase 2~)
Windows Graphics Capture API 사용 시 앱 UI에서 유저에게 명시적 권한 요청 및 용도 안내.

#### ✅ 저작권 준수
게임 이미지 에셋 도입 시 Project Moon의 저작권 정책을 검토한 후 진행.
Phase 1~에서는 이미지 없이 텍스트+배지로 운영하여 리스크 회피.

---

## 10. 배포 및 운영 정책

### 10.1. 배포 방식

- GitHub Releases를 통한 `.exe` 설치 파일 배포
- 각 릴리즈에 **VirusTotal 스캔 결과 링크** 첨부
- 오픈소스 공개로 코드 투명성 보장

### 10.2. 베타 출시 전략

1. **디시인사이드 림버스 컴퍼니 갤러리**에 베타 테스트 모집 공고
2. "OCR 없이도 루트 공유/검색 즉시 사용 가능" 강조
3. 오버레이 실시간 가이드 **데모 영상** (유튜브/X) 선공개
4. 초기 피드백 기반으로 OCR Phase 2 개발 방향 결정

### 10.3. 유지보수 정책

- 패치 적용 시 게임 데이터 JSON 4종 업데이트 + `patch_version.json` 갱신
- Phase 2 이후 OCR 도입 시 해상도/DPI별 캡처 보정 템플릿 별도 관리
- 앱 최초 실행 시 **비공식 팬 프로젝트 고지 팝업** 필수 노출

---

## 11. 화면 구조 및 UI 명세

### 11.1. 화면 구성 개요

| 화면 | 진입 조건 | 이탈 조건 |
|---|---|---|
| **기본화면** | 앱 실행 시 기본 / 플레이화면에서 뒤로가기 | 거던 탐사 시작 감지 시 자동 전환 |
| **플레이화면** | 거던 탐사 시작 화면 자동 감지 | 탐사 종료 버튼 클릭 또는 탐사 완료 감지 |

### 11.2. 기본화면 (Base Screen)

사이드 네비게이션 또는 상단 탭으로 세 섹션을 전환합니다.

#### 섹션 A — 루트 관리 (My Routes)

- 내 루트 목록 카드 리스트 (이름 / 패치 버전 배지 / 검증 여부 배지)
- 각 카드에서 수정 / 삭제 / 공유코드 복사 가능
- 우측 하단 FAB(+) 버튼으로 새 루트 작성
  - 기프트 추가 시 의존성 경고 자동 표시
  - `gift_order` 드래그로 순서 조정 가능
- 코드 직접 입력으로 외부 루트 다운로드

#### 섹션 B — 루트 탐색 (Route Hub)

- 필터 패널 + 루트 카드 리스트
- 카드 클릭 시 상세 모달: 루트 정보 / 추천수 / 조회수 / 추천 버튼 / 내 루트로 저장

#### 섹션 C — 설정 (Settings)

- 오버레이 투명도 슬라이더
- 테마 설정 (다크 고정)
- 앱 버전 정보
- UUID 초기화 (경고 다이얼로그 포함)
- 비공식 팬 프로젝트 고지 확인

#### 거던 진행 중 복귀 배너

뒤로가기로 기본화면에 진입한 경우 우측 상단에 상시 표시. 클릭 시 플레이화면으로 복귀.

```
┌──────────────────────────────────────┐
│  🗺️  거던 탐사 진행 중 — 복귀하기  →  │
└──────────────────────────────────────┘
```

### 11.3. 플레이화면 (Play Screen)

#### 레이아웃 구조

```
┌──────────────────────────────────────────┐
│  ←    [루트명 선택 ▼]         [탐사 종료]  │
├──────────────────────────────────────────┤
│  [에고기프트]   [선택지]   [팩]             │
├──────────────────────────────────────────┤
│                                          │
│              탭별 콘텐츠 영역              │
│                                          │
└──────────────────────────────────────────┘
```

#### 상단 컨트롤바

| 요소 | 동작 |
|---|---|
| **← 뒤로가기** | 기본화면으로 이동. 탐사 세션 유지, 복귀 배너 표시 |
| **루트 선택 드롭다운** | 내 루트 목록에서 실시간 변경. 변경 즉시 가이드 업데이트 |
| **탐사 종료 버튼** | 확인 다이얼로그 후 세션 종료 → 기본화면으로 이동 |

#### 탭 1 — 에고기프트 (기본 탭)

- 루트 목표 에고기프트 전체 리스트
- 선행 조건 미충족 기프트: 🔒 잠금 배지 + 조건 표시
- 미획득 기프트: 밝게, 상단
- 획득 완료 기프트: opacity 감소 + 하단 이동
- Phase 1: 카드 탭으로 획득 여부 수동 토글 / Phase 2: OCR 자동 반영
- 이미지 없는 Phase 1: `KeywordBadge`(키워드명 + 키워드 색상)로 표시

#### 탭 2 — 선택지

- 현재 층 및 다음 예상 이벤트의 선택지 가이드
- `recommended_choice_id` 기준 최적 선택지 Amber 색상으로 하이라이트
- 판정 죄종 / 임계값 표시

#### 탭 3 — 팩

- 루트상 방문할 팩 전체 목록
- 팩 한정 기프트 보유 팩: 상단 고정 + Amber 배지 강조
- 미방문 팩: 밝게, 상단 / 방문 완료 팩: opacity 감소 + 하단 이동
- Phase 1: 카드 탭으로 방문 여부 수동 토글

### 11.4. 루트 중간 변경 처리

- 변경 전까지 토글한 획득/방문 완료 데이터 세션에 보존
- 새 루트 목표 리스트와 기존 완료 데이터 대조 → 겹치는 항목 완료 상태로 표시
- 새 루트에만 있는 미완료 항목 상단에 추가
- `route_switched_at_floor` 필드에 변경 시점 층 번호 기록

---

## 12. 디자인 시스템 (Design System)

### 12.1. 브랜드 컨셉

**Charcoal Black** 중심의 다크 모드 전용 팔레트. 단테의 신곡에서 베르길리우스가 어두운 지옥과 연옥을 안내하듯, 차갑고 묵직한 어둠 속에서 Amber의 등불이 길을 비추는 시각적 서사를 지향합니다.

### 12.2. 컬러 토큰

| 토큰 | Hex | 용도 |
|---|---|---|
| `color-bg-base` | `#121315` | 메인 배경 (Deep Abyss) |
| `color-bg-surface` | `#25282C` | 카드, 팝업, 입력창 배경 (Card Surface) |
| `color-brand` | `#1C1E21` | 로고, 네비게이션 바 (Charcoal Black) |
| `color-accent` | `#E67E22` | 활성 상태, CTA 버튼, 최적 선택지 하이라이트 (Flame Amber) |
| `color-text-primary` | `#E1E4E6` | 본문, 헤드라인 (Ash White) |
| `color-text-muted` | `#90969D` | 힌트 텍스트, 부제목, 비활성 아이콘 (Muted Slate) |

> 📌 Muted Slate는 원안 `#888E95`에서 `#90969D`로 조정되었습니다.
> Card Surface 위 WCAG AA 기준(4.5:1) 미달(4.48) 검증 후 수정한 수치입니다. (→ 4.96)

### 12.3. 명도 대비 검증 결과 (WCAG 2.1)

| 조합 | 대비비 | AA (4.5) | AA Large (3.0) | AAA (7.0) |
|---|---|---|---|---|
| 본문 텍스트 on 메인 배경 | 14.55 | ✅ | ✅ | ✅ |
| 본문 텍스트 on 카드 | 11.59 | ✅ | ✅ | ✅ |
| 힌트 텍스트 on 메인 배경 | 5.62 | ✅ | ✅ | — |
| 힌트 텍스트 on 카드 | 4.96 | ✅ | ✅ | — |
| 액센트 on 메인 배경 | 6.53 | ✅ | ✅ | — |
| 액센트 on 카드 | 5.20 | ✅ | ✅ | — |
| 액센트 on 브랜드색 (버튼) | 5.86 | ✅ | ✅ | — |
| 본문 텍스트 on 브랜드색 | 13.08 | ✅ | ✅ | ✅ |

모든 조합이 WCAG 2.1 AA 기준을 통과합니다.

### 12.4. 키워드 배지 색상 (Phase 1 이미지 대체)

이미지가 없는 Phase 1에서는 `KeywordBadge` 컴포넌트가 키워드 색상 배지로 기프트를 시각적으로 구분합니다.

| 키워드 | 배지 색상 |
|---|---|
| 범용 | `#888E95` (Muted Slate) |
| 화상 | `#E74C3C` (Red) |
| 출혈 | `#C0392B` (Dark Red) |
| 진동 | `#9B59B6` (Purple) |
| 파열 | `#E67E22` (Amber) |
| 침잠 | `#2980B9` (Blue) |
| 호흡 | `#27AE60` (Green) |
| 충격 | `#F39C12` (Yellow) |

### 12.5. UI 적용 가이드

**스플래시 화면:** `color-bg-base` 배경 정중앙에 `color-text-primary`로 로고 심플 연출.

**네비게이션 바:** `color-brand` 배경, 활성 메뉴 아이콘에만 `color-accent` 점등.

**버튼:** 보조 버튼은 `color-bg-surface` 계열, 핵심 CTA(탐사 종료, 공유하기, 저장 등)에만 `color-accent` 적용.

**에고기프트 / 팩 상태 표현:**
- 미완료: `color-text-primary` 기준 정상 밝기
- 완료: opacity 0.35 + 리스트 하단 배치
- 선행 조건 미충족: 🔒 아이콘 + `color-text-muted` 처리

**선택지 하이라이트:** 최적 선택지 좌측 보더 또는 배경에 `color-accent` 적용.

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