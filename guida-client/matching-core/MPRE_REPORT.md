# M-pre 결과 리포트 — 매칭 코어 + 변별력 감사

> 범위: phase2_dev_plan.md 착수 체크리스트 M-pre 3개 항목.
> 산출물: `matching-core` 크레이트(tauri 비의존, 오프라인). 런타임 `src-tauri`와
> 빌드 도구가 공유할 SSOT 해시 코어.
> 재현: `cargo test --release` / `cargo run --release --features bench --bin bench_crates`
> / `cargo run --release --bin audit_collisions`

---

## 결론 한 줄

449개 기프트 아이콘은 선택한 pHash 구성으로 **충분히 변별 가능**하다(최소 inter-class
해밍 21bit, near-collision<20bit = 0). 접근법은 day-1 검증을 통과했고 M0로 진행 가능.

---

## M-pre #1 — 크레이트·파라미터 확정

`img_hash`와 `image_hasher`를 둘 다 설치해 449 실데이터로 벤치(`bench_crates`).

### 크레이트: **image_hasher 3.1.1**
- 두 크레이트는 변별력·강건성이 **사실상 동일**(image_hasher가 img_hash의 포크).
  예: gradient sz16 — minInter 11 vs 12, 현실 top1 99.84% vs 99.81%.
- 타이브레이커: image_hasher는 **image 0.25 공유**(런타임 스택과 동일, 듀얼 image 버전
  비대화 회피) + 유지보수 활발. img_hash는 image 0.23(구버전)에 고정.
- 패자 img_hash는 `bench` feature 뒤로 격리 → 런타임/도구 기본 빌드 미포함.

### 해시 파라미터: **DoubleGradient · 32×32 · DCT off · Lanczos3**
| 파라미터 | 값 | 근거 |
|---|---|---|
| algorithm | DoubleGradient | 동일 크기 대비 현실 top1 최고(99.90%) + near<12=0 |
| hash_size | 32×32 → **544bit** | sz16은 충돌(minInter 0, near<12=13). sz32에서 깨끗이 분리 |
| DCT | **off** | DCT는 minInter↑이나 crop/translation 강건성을 해침(stress 88→83%). 캡처 미세정렬 오차에 불리 |
| resize | Lanczos3 | 다운스케일 디테일 보존(변별력↑) |
| center_crop | 1.0(기본) | full/cc85/cc75 통계적 동률 → 정보손실 없는 전체. **M2에서 최종 확정·인덱스 재생성** |

SSOT: [src/hash.rs](src/hash.rs) — `HASH_VERSION = image_hasher/DoubleGradient/sz32/dct=off/lanczos3/v1`.
인덱스↔런타임 불일치는 이 버전 문자열 비교로 런타임에 검출(`PhashIndex::load`).

---

## M-pre #2 — identify 코어 + 합성 왜곡 자가 테스트

- 순수 매칭 코어: [src/identify.rs](src/identify.rs) — 정규화 슬롯/해시 → top-k gift_id +
  해밍 + 모호/기각 판정. 게임·캡처 비의존.
- 자가 테스트: [tests/distortion.rs](tests/distortion.rs) — 449개에 scale/crop/noise/
  badge/brightness 합성 후 복원 검증.

### 결과 (완료 기준 ≥ 99%)
```
현실 왜곡 복원 top-1 = 99.90% (3140/3143)   ✅ 통과
스트레스 왜곡 top-1  = 88.14% (1583/1796)   (헤드룸 참고)
```
현실 실패 3건은 전부 **색·등급 변형 시리즈**(아래 #3 near-collision과 동일 원인):
`아스라한 잔영→어두운 잔영`, `빛나는 잔영→찬란한 잔영`, `그림자 괴물→벼락가지`.

---

## M-pre #3 — 449 pairwise 변별력 감사 + ambiguity_margin

`audit_collisions` 실행. 리포트: [near_collisions.json](near_collisions.json).

### inter-class 해밍 분포 (서로 다른 두 아이콘, 100,576쌍)
```
min=21  p0.1%=108  p1%=156  p5%=183  median=232
near<8=0  near<12=0  near<16=0  near<20=0  near<24=1  near<40=5
```
**20bit 미만 near-collision = 0.** 변별력 충분.

### near-collision 쌍 (거리 < 40, 5쌍)
| dist | A | B | grade/keyword |
|---|---|---|---|
| 21 | 은빛 시계 케이스 | 회중시계: 타입 E | 2/진동 · 4/진동 |
| 25 | 빛바랜 시계 케이스 | 회중시계: 타입 Y | 2/진동 · 4/진동 |
| 34 | 빛바랜 건틀릿 | 황금빛 시간 | 1/범용 · 3/범용 |
| 34 | 아스라한 잔영 | 달의 잔영 | 2/범용 · 5/범용 |
| 39 | 빛나는 잔영 | 찬란한 잔영 | 3/범용 · 4/범용 |

계획서 예측대로 "시리즈·색만 다른 등급 변형"이 유일한 충돌 위험원.

### 권장 ambiguity_margin = **19**
- 정답 매칭의 top1-top2 마진 분포: p1%=19, median=143.
- 정답의 99%가 마진 > 19로 이김 → 정상 매칭은 거의 안 걸리고, 위 모호쌍만 2차 판별로 보냄.
- ⚠️ phase2_dev_plan §4의 placeholder `ambiguity_margin: 4`는 64bit 가정. **544bit 기준 19로 갱신** 필요.

### near-collision 대책 (완료 기준: 0이 아니면 대책 문서화)
5쌍 모두 거리 ≥ 21(>ambiguity_margin 19에 근접)이라 1차 게이트에서 모호로 분류되어
2차 판별로 넘어간다. 단계적 방어:
1. **ambiguity_margin=19 게이트** — top2-top1 ≤ 19면 자동확정 보류, 2차로.
2. **2차 판별(템플릿/컬러 히스토그램)** — 시리즈 변형은 색/등급 테두리가 다르므로
   `imageproc` 템플릿 상관 또는 컬러 히스토그램으로 구분(M2에서 해당 5쌍에 한해 적용).
3. **center_crop 재검토** — 시계/잔영 변형은 등급 테두리(보통 가장자리)가 다르므로,
   center_crop을 **낮추면(가장자리 더 포함)** 오히려 변별에 유리할 수 있음 → M2에서 이 5쌍으로
   center_crop 스윕 후 인덱스 재생성.
4. **N프레임 안정 + AND 게이트 + 수동 폴백** — 최종 안전망(오탐 > 미탐 원칙).

---

## 데이터 측 발견 (계획서 보정 필요)

- 레퍼런스 webp는 전부 RGBA지만 **실측 크기가 균일하지 않음**: 정확히 128×128은 287/449개,
  나머지는 제각각(일부 ~190×256 세로형). 계획서 §1.3·§7.1의 "128×128 실측" 전제는 부정확 →
  **리사이즈 정규화가 필수**(이미 `canonicalize`에서 처리). ph18 문서 문구 보정 권장.

---

## 다음 단계(이번 배치 범위 밖)

- M-pre #4: `build_phash_index` → `phash_index.json` 생성 (착수 체크리스트 4번째).
- 이후 M0(캡처+정규화) → M1 → M2(여기서 center_crop 최종 확정 + 5쌍 2차 판별 적용).
