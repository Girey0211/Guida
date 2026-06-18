# 🛠️ Guida — Phase 2 개발 계획서

> **범위:** 이미지 매칭 기반 보상 인식 + 화면 인식 + 오버레이 실시간 반영
> **전제:** Phase 1(루트 작성/공유/오버레이 참조 패널)은 완료 상태
> **읽는 대상:** 이 계획을 받아 구현하는 에이전트 또는 개발자
> **상위 문서:** `README.md` (특히 §5.3 보상 인식, §5.4 화면 전환, §9 기술 명세)

이 문서는 README의 "무엇을"에 대한 "어떻게/어떤 순서로"입니다. README와 충돌 시 README의 스키마/제약(§9.2 No Memory Touch / No Input Injection)이 우선합니다.

---

## 0. 설계 요지 (1분 요약)

인식은 **coarse-to-fine 4레이어**로 쌓는다. 비싼 인식은 싼 게이트를 통과한 뒤에만 돈다.

```
Layer 0  정규화      게임 렌더 사각형(game rect) 확정 → 정규화 좌표(0~1) 변환 산출
Layer 1  화면 인식    region-pHash 지문 + 히스테리시스 + 상태 머신으로 "지금 어느 화면인가" 확정
Layer 2  요소 인식    확정된 화면의 앵커 검증 → 요소 크롭 → pHash 식별(+템플릿 2차)
Layer 3  반영/오버레이 신뢰도 AND 게이트 → 멱등 반영 → 오버레이 정합 표시
```

핵심 원칙 5가지:
1. **모든 좌표는 정규화(0~1).** 절대 픽셀 좌표 금지.
2. **매칭 설정은 코드가 아니라 데이터(`matching_config.json`).** UI 변경 = 코드 수정이 아니라 설정 PR.
3. **오탐(잘못 반영) > 미탐(수동 확인 유도).** 확신 없으면 자동 확정하지 않는다.
4. **회귀 검증 세트로 모든 해상도/DPI를 자동 테스트.** "되는 것 같다"가 아니라 측정.
5. **런타임 순서 ≠ 개발 순서.** 위 4레이어는 *매 프레임 실행* 순서(coarse→fine)다. 반면 *개발 착수* 순서는 "가장 불확실하고 가장 종속성 큰 결정을 먼저 못박는다"를 따른다. 이 프로젝트에서 가장 큰 미검증 리스크는 캡처도 앵커도 아니라 **"pHash가 449개 아이콘을 실제로 변별하는가"**이며, 이 코어는 게임·WGC 없이 레포의 449개 webp만으로 검증 가능하다. 따라서 매칭 코어를 모든 캡처/화면 작업보다 먼저(M-pre) 검증한다.

---

## 1. 기술 스택

### 1.1. Rust 측 (`src-tauri/`)

| 용도 | 크레이트 | 비고 |
|---|---|---|
| 화면 캡처 | `windows` (Windows Graphics Capture API) | borderless 권장. exclusive fullscreen 미지원 안내 |
| 이미지 디코딩/리사이즈 | `image` | webp 레퍼런스, 캡처 프레임 처리 |
| perceptual hash | **M-pre에서 확정** — `img_hash` vs `image_hasher` 벤치 후 선택 | region-pHash(화면), 아이콘 pHash(요소) 공용. `img_hash` 유지보수 정체 가능성 → 포크 `image_hasher` 후보. 선택 기준은 "유지보수 활발함"이 아니라 **449개 변별력 벤치 결과**(§3 M-pre) |
| 템플릿 매칭 | `imageproc` | 앵커 탐색, 2차 판별, (보류) 디짓 매칭 |
| 직렬화 | `serde`, `serde_json` | `matching_config.json` 로드 |

> ❌ OpenCV / Tesseract / 한글 traineddata 미사용 (경량 기조 §1, 15MB 목표 유지).

### 1.2. Frontend 측 (`src/`)

| 용도 | 스택 | 비고 |
|---|---|---|
| 오버레이 창 | Tauri v2 투명 + always-on-top 윈도우 | click-through 토글(전역 단축키) |
| 상태 | Zustand (`playStore`, `appStore`) | 인식 결과 수신 → 세션 반영 |
| Rust 호출/이벤트 | Tauri command + event | Rust→FE는 event emit, FE→Rust는 invoke |

### 1.3. 데이터 측 (CDN / 빌드 산출물)

| 파일 | 생성 시점 | 내용 |
|---|---|---|
| `phash_index.json` | **M-pre에서 빌드 도구 확정**, 이후 이미지 에셋 빌드 시 생성 | 449 기프트 아이콘(128×128 RGBA webp 실측)을 동일 크기로 정규화 후 pHash. ⚠️ 생성기와 런타임 `identify.rs`는 **반드시 동일 크레이트·동일 파라미터** (불일치 시 449개 전체 매칭 붕괴) |
| `matching_config.json` | 수동/반자동 작성, 패치 시 갱신 | 화면별 앵커·요소 영역·scene 지문 (정규화 좌표) |

---

## 2. 모듈 구조 (목표 트리)

README §4의 `src-tauri/src/matching/`를 다음과 같이 확정한다.

```
src-tauri/src/
├── capture/
│   ├── wgc.rs            # WGC 세션 관리, 프레임 획득
│   └── hwnd.rs           # 게임 창 핸들/클라이언트 rect 추적
├── matching/
│   ├── normalize.rs      # Layer 0: game rect 산출, 정규화 변환
│   ├── screen.rs         # Layer 1: region-pHash 지문, 히스테리시스, 상태 머신
│   ├── anchor.rs         # Layer 2: 앵커 탐색 + 다중 앵커 교차검증
│   ├── identify.rs       # Layer 2: 아이콘 pHash 매칭 + 템플릿 2차 판별 (코어는 M-pre에서 선검증)
│   ├── config.rs         # matching_config.json 로드/검증 (serde)
│   └── pipeline.rs       # 레이어 오케스트레이션, throttle 루프
├── commands/
│   ├── capture.rs        # FE 노출 커맨드 (시작/정지/권한)
│   └── recognition.rs    # 인식 결과 event emit
└── utils/
    └── geometry.rs       # 정규화 좌표 ↔ 화면 좌표 변환 헬퍼

tools/                    # 빌드/검증용 (런타임 비포함)
├── build_phash_index.rs  # 449 webp → phash_index.json. identify.rs와 동일 해시 구현 공유 필수
└── audit_collisions.rs   # M-pre: 449 pairwise 해밍 거리 감사, near-collision 리포트

src/
├── components/overlay/
│   ├── OverlayWindow.tsx     # 투명 창, click-through 토글
│   ├── GuideHighlight.tsx    # 정규화 좌표 기반 하이라이트 렌더
│   └── ManualConfirm.tsx     # 저신뢰 시 수동 확인 UI (신규)
└── hooks/
    ├── useRecognition.ts     # Rust event 구독 → playStore 반영 (신규)
    └── useOverlaySync.ts      # 게임 창 rect 추적 → 오버레이 위치 동기화 (신규)
```

---

## 3. 개발 순서 (마일스톤)

각 마일스톤은 **독립 검증 가능**하도록 끊었다. 앞 단계가 안정되기 전 다음으로 넘어가지 말 것. 순서를 지키는 것이 이 프로젝트의 성패다 — 특히 M-pre와 M0~M2.

### M-pre. 매칭 코어 + 변별력 감사 `오프라인 · 게임 불필요`

이 기술의 핵심 리스크(pHash가 449개를 실제로 변별하는가)와 가장 종속성 큰 결정(크레이트·해시 파라미터)을 **캡처/화면 작업 이전에** 확정한다. 레포의 449개 webp만 있으면 되며 게임도 WGC도 필요 없다. 여기서 접근법이 깨지면 day-1에 알아야 한다(M2까지 가서 알면 이미 늦다).

- **크레이트·파라미터 확정:** `img_hash` vs `image_hasher`를 둘 다 깔아 449개 실데이터로 벤치. 해시 알고리즘(pHash/dHash 등)·해시 크기(64bit→부족 시 128/256bit) 결정. **선택 기준은 유지보수 활발함이 아니라 변별력 결과.**
- **`identify.rs` 순수 매칭 코어:** 게임 의존 없는 함수로 먼저 구현 (입력 128×128 이미지 → top-k gift_id + 해밍 거리)
- **합성 왜곡 자가 테스트:** 레퍼런스에 스케일/크롭/노이즈/배지 오버레이를 합성 적용 후 원본으로 복원되는지 검증
- **449 pairwise 변별력 감사 (필수):** 449개 해시 전체의 pairwise 최소 해밍 거리 분포를 뽑아 **near-collision 리포트** 생성("조각" 시리즈·색만 다른 등급 변형 등이 충돌 위험). 충돌이 있으면 해시 크기↑ 또는 컬러 히스토그램 보조를 day-1에 결정. **이 분포가 §4의 `ambiguity_margin` 값을 정한다** (감사 전에는 placeholder)
- **`build_phash_index.rs`:** 확정된 동일 구현으로 `phash_index.json` 생성
- **완료 기준:** 크레이트·파라미터 확정. 합성 왜곡 복원 정확도 ≥ 99%. near-collision 쌍이 0이거나, 0이 아니면 각 쌍에 대한 2차 판별/해시 보강 대책이 문서화됨. `ambiguity_margin` 권장값이 분포 근거와 함께 도출됨.

### M0. 캡처 + 정규화 토대 `Layer 0`
- WGC로 게임 창 프레임 획득, 3~4fps throttle 루프
- HWND 클라이언트 rect + 가장자리 검은 띠(레터박스) 스캔으로 **game rect 확정**
- `(offset_x, offset_y, scale)` 변환 산출, 정규화↔화면 헬퍼 구현
- **완료 기준:** 1080p/1440p/4K/울트라와이드/창모드에서 game rect가 ±2px 내로 일관 검출. 정규화 좌표 왕복 변환 오차 1px 미만.

### M1. 화면 인식 게이트 `Layer 1`
- 화면별 UI 크롬 영역 **region-pHash 지문** 정의(우선 3~4개 주요 화면: 기본탐사 / 선택지 / 보상 / 시작·종료)
- **히스테리시스:** 연속 N프레임(3~5) 동일 판정 시에만 전환 커밋
- **상태 머신:** 합법 전이만 허용, 불가능 점프는 기각
- **완료 기준:** 데모 플레이 녹화에서 화면 전환 검출 정확도 ≥ 99%, 오탐(잘못된 전환) 0에 수렴. 전환 애니메이션/팝업 깜빡임에 흔들리지 않음.

### M2. 앵커 검증 + 요소 식별 `Layer 2`

> 식별 코어(`identify.rs`)와 `phash_index.json`은 M-pre에서 이미 검증됨. 여기서는 **앵커·크롭·실프레임 연동**에 집중한다.

- 화면별 레이아웃 템플릿(앵커 + 요소 영역) 로드
- 1차 앵커를 예상 위치 주변 작은 윈도우에서 템플릿 매칭 → 변환 정밀 보정
- **다중 앵커 교차검증:** 2차 앵커 위치 예측 vs 실제 검출 일치 확인, 어긋나면 프레임 기각
- 보상창 아이콘 슬롯 크롭(중앙 영역) → **128×128로 리사이즈**(인덱스와 동일 크기) → `phash_index.json`과 해밍 거리 매칭 → 모호 시 `imageproc` 템플릿 2차
- **완료 기준:** 회귀 세트(§6)에서 기프트 식별 정확도 ≥ 99%, 오탐 0. 화면 전환 중 프레임은 100% 기각.

### M3. 반영 + 오버레이 `Layer 3`
- **AND 게이트:** 화면 확정 ∧ 앵커 교차검증 통과 ∧ 매칭 신뢰도 ∧ N프레임 안정 → 반영
- **멱등 반영:** `(session, scene-instance)` 키 또는 보상셋 해시로 dedupe
- 인식 결과 event → `useRecognition` → `playStore`(`acquired_gifts` 등), `verified: true` / `verified_method: "image_match"`
- 오버레이 하이라이트를 정규화→화면 변환으로 정합, 게임 창 이동/리사이즈 추적
- click-through 토글(전역 단축키), 저신뢰 시 `ManualConfirm` 폴백
- **완료 기준:** 동일 보상 1회만 반영(중복 0). 오버레이가 창 이동/리사이즈/해상도 변경에 정확히 따라붙음. 자동 반영 오탐 0.

### M4. 화면 전환 자동화 `README §5.4`
- M1 상태 머신 재사용: 탐사 시작 감지 → 기본화면→플레이화면, 종료 감지 → 복귀
- **완료 기준:** 시작/종료 자동 전환 오탐 0, 누락 ≤ 1%.

### M5. 베타 안정화
- 설정에 캡처 권한 명시 요청 + borderless 권장 안내(§9.2)
- 저신뢰/실패 텔레메트리(로컬 로그)로 오인식 케이스 수집 → `matching_config.json` 튜닝
- VirusTotal 스캔 링크 첨부 후 릴리즈(§10.1)

> 의존성: **M-pre → M0 → M1 → M2 → M3.** M-pre는 게임 불필요하므로 즉시 착수 가능. M4는 M1 이후 병행 가능. M5는 M3 이후. (M-pre가 막히면 접근법 자체를 재고하므로 가장 먼저 끝낸다.)

---

## 4. `matching_config.json` 스키마 (초안)

화면별 매칭 규칙을 코드 밖으로 분리. 패치로 UI가 바뀌면 이 파일만 PR. 모든 좌표는 **정규화(0~1)**, 게임 rect 기준.

```json
{
  "schema_version": "1.0",
  "game_aspect_ratio": "16:9",
  "patch_version": "2.7",
  "screens": [
    {
      "screen_id": "reward",
      "name": "보상 결과창",
      "fingerprints": [
        { "region": [0.40, 0.04, 0.20, 0.06], "phash": "a1b2c3d4...", "tolerance": 10 }
      ],
      "anchors": [
        { "anchor_id": "header_icon", "template_key": "anchor_reward_header",
          "search_region": [0.42, 0.05, 0.16, 0.08], "match_threshold": 0.85 },
        { "anchor_id": "frame_corner", "template_key": "anchor_reward_corner",
          "search_region": [0.10, 0.78, 0.10, 0.10], "match_threshold": 0.85 }
      ],
      "cross_check": { "predict_from": "header_icon", "verify": "frame_corner", "max_error": 0.01 },
      "elements": [
        { "element_id": "gift_slot_grid", "type": "icon_grid",
          "origin": [0.30, 0.35], "cell": [0.08, 0.10], "cols": 5, "rows": 2,
          "center_crop": 0.70, "match": "phash", "ambiguity_margin": 4 }
      ],
      "transitions_allowed": ["base_explore", "choice"]
    }
  ]
}
```

> ⚠️ `ambiguity_margin: 4`는 **placeholder**다. 실제 값은 M-pre의 449 pairwise 변별력 감사 분포에서 도출한다 (감사 전에 임의로 정하면 안 됨).

| 필드 | 설명 |
|---|---|
| `fingerprints[].region` | `[x, y, w, h]` 정규화. UI 크롬처럼 화면마다 안 변하는 영역 |
| `fingerprints[].tolerance` | region-pHash 해밍 거리 허용치 (화면 판정용) |
| `anchors[].search_region` | 앵커를 찾을 좁은 윈도우. 미세 스케일 오차 흡수 |
| `anchors[].match_threshold` | 템플릿 정규화 상관계수 임계값 |
| `cross_check` | 한 앵커로 다른 앵커 위치를 예측·검증. `max_error` 초과 시 프레임 기각 |
| `elements[].type` | `icon_grid` / `single_icon` 등. 크롭 격자 정의 |
| `elements[].center_crop` | 아이콘 중앙 비율만 사용(배지/프레임 회피) |
| `elements[].ambiguity_margin` | top-1/top-2 해밍 거리 차가 이 값 이하면 모호 → 템플릿 2차. **값은 M-pre 변별력 감사 분포에서 도출** |
| `transitions_allowed` | 상태 머신 합법 전이 화이트리스트 |

> 템플릿 이미지(`template_key`)는 이미지 에셋과 함께 CDN/번들 관리. `phash_index.json`과 별개.

---

## 5. 신뢰도 게이트 의사코드

```
on_frame(frame):
    rect = normalize.detect_game_rect(frame)          # Layer 0
    if rect is None: return

    screen = screen.classify(frame, rect, config)     # Layer 1 (region-pHash)
    screen = state_machine.commit(screen)             # 히스테리시스 + 합법 전이
    if screen is unstable: return

    cfg = config.for(screen)
    xf = anchor.locate_and_refine(frame, rect, cfg)   # Layer 2 1차 앵커
    if not anchor.cross_check(frame, xf, cfg): return # 다중 앵커 교차검증 실패 → 기각

    results = identify.match_elements(frame, xf, cfg) # pHash (+모호 시 템플릿 2차)

    if all_confident(results) and stable_for(N_frames):   # Layer 3 AND 게이트
        if not seen(session, scene_instance):             # 멱등
            playStore.apply(results)                      # verified: true
            mark_seen(session, scene_instance)
    else:
        overlay.request_manual_confirm(results)           # 저신뢰 폴백
```

---

## 6. 회귀 검증 세트 (필수 인프라)

"어떻게 검증하느냐"의 답. M2 시작 전 구축. (M-pre의 합성 왜곡 자가 테스트는 *식별 코어*만 검증하는 별개 단계 — 이 회귀 세트는 캡처~반영 전 파이프라인을 실환경 프레임으로 검증한다.)

- **수집:** 각 주요 화면을 1080p / 1440p / 4K / 울트라와이드(21:9) / 여러 창 크기 / DPI 100·125·150%에서 캡처
- **라벨링:** 프레임별 정답(화면 종류, 등장 기프트 id 목록) 주석
- **자동 테스트:** 파이프라인을 라벨 세트에 돌려 화면 정확도·식별 정확도·오탐율 산출. 앵커/임계값 변경 시 CI에서 회귀 자동 검증
- **목표 지표:** 화면 인식 ≥ 99% / 기프트 식별 ≥ 99% / 자동 반영 오탐 = 0

---

## 7. 제약 & 리스크

### 7.1. 준수 (README §9.2)
- 🚫 게임 프로세스 메모리 접근(`OpenProcess` 등) 금지 — 캡처만
- 🚫 마우스/키보드 주입 금지 — **전역 단축키 수신은 허용**(받는 건 OK)
- ✅ 캡처 권한 명시 요청 + borderless 권장 안내
- ✅ 이미지 에셋/템플릿은 Project Moon 정책·ToS 검토 후 도입(§9.2)
- ✅ **128×128 일관성:** 레퍼런스(128×128 RGBA 실측)·`phash_index.json`·런타임 크롭 리사이즈를 모두 128×128로 통일
- ✅ **단일 해시 구현:** `build_phash_index.rs`와 런타임 `identify.rs`는 동일 크레이트·동일 파라미터 공유 (CI에서 인덱스 재생성 후 diff 검증으로 강제)

### 7.2. 리스크와 완화
| 리스크 | 완화 |
|---|---|
| **449개 pHash 변별력 부족** (near-collision) | **M-pre에서 day-1 감사** → 충돌 시 해시 크기↑/컬러 히스토그램 보조를 즉시 결정 |
| 인덱스 생성기 ↔ 런타임 해시 구현 불일치 | 동일 크레이트·파라미터 강제 + CI diff 검증 |
| **앵커 안정화가 시간 대부분 소모** (예상된 난관) | M0 정규화로 변수 제거 + 회귀 세트로 측정 기반 튜닝 |
| 아이콘 위 배지/프레임/체크마크로 pHash 흔들림 | `center_crop`으로 중앙만 사용 + 모호 시 템플릿 2차 |
| exclusive fullscreen 캡처 실패 | 설정에서 borderless 안내, 미충족 시 인식 비활성 + 고지 |
| 패치로 UI 좌표/아이콘 변경 | `matching_config.json` / `phash_index.json` PR로 즉시 대응(README §10.3) |
| 보상창 다중 프레임 중복 반영 | scene-instance 멱등 키 |
| 오인식으로 잘못된 자동 반영 | AND 게이트 + 교차검증 + 저신뢰 수동 폴백(오탐보다 미탐 우선) |

---

## 8. 착수 체크리스트

- [x] **M-pre: 크레이트 벤치(`img_hash` vs `image_hasher`) + 해시 파라미터 확정** → image_hasher / DoubleGradient·32×32·DCT off·Lanczos3 (544bit). 근거: `matching-core/MPRE_REPORT.md`
- [x] **M-pre: `identify.rs` 코어 + 합성 왜곡 자가 테스트** → 현실 왜곡 복원 top-1 99.90% (≥99% 통과)
- [x] **M-pre: 449 pairwise 변별력 감사 → near-collision 리포트 + `ambiguity_margin` 도출** → min inter 20bit, near<20=0, **ambiguity_margin=18**(검정 평탄화 반영 후). 리포트: `matching-core/near_collisions.json`
- [x] **M-pre: `build_phash_index.rs` → `phash_index.json` 생성** → 449개·544bit·91.9KB, 자기검증(self-dist=0) 통과. `matching-core/phash_index.json`
- [x] M0: WGC 캡처 + game rect 정규화 → **검출 코어 ±2px 검증 완료**(matching-core normalize/geometry, 1080p/1440p/4K/울트라와이드/창모드 합성 프레임). WGC/HWND 캡처 글루는 src-tauri 구현·컴파일 완료, **라이브 캡처는 게임 실행 환경에서 검증 필요**
- [x] 회귀 세트 수집/라벨링 인프라 구축 → 라벨 스키마+러너+합성 시드(`matching-core/src/regression.rs`, `run_regression` 바이너리, `regression/`). 합성 스모크: 화면 100%·식별 100%·오탐 0
- [ ] M1: region-pHash 지문 + 히스테리시스 + 상태 머신
- [ ] `matching_config.json` 스키마 확정 + 로더/검증(serde)
- [ ] M2: 앵커 탐색 + 다중 앵커 교차검증 + 아이콘 크롭/식별 연동
- [ ] M3: AND 게이트 + 멱등 반영 + 오버레이 정합 + 수동 폴백
- [ ] M4: 시작/종료 자동 전환
- [ ] M5: 권한 UX, 텔레메트리 튜닝, 릴리즈

---

*이 문서는 Guida Phase 2의 실행 계획서이며, README.md의 living spec에 종속된다.*