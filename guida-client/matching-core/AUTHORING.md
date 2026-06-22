# 매칭 데이터 저작 가이드 (`author` 도구)

매칭 코어(M-pre~M2)는 합성 데이터로 검증을 마쳤지만, 실게임에 물리려면 **알고리즘이
만들 수 없는 데이터** 두 가지를 캡처에서 작성해야 한다. 이 도구가 그 수작업을
스크립트화한다. 사람이 하는 건 **캡처 + 정규화 좌표 지정**뿐이고, 해시·크롭은 런타임과
동일 구현으로 자동 생성된다.

| 산출물 | 무엇 | 런타임 소비처 |
|---|---|---|
| `matching_config.json` 의 `phash` | 화면별 UI 크롬 region-pHash 지문 | `screen::classify` (Layer 1) |
| 앵커 템플릿 PNG + `templates.json` | 보상창 헤더·모서리 등 고정 UI 패치 | `anchor::load_template_set` → `match_anchor` (Layer 2) |

> 모든 좌표는 **game rect 기준 정규화(0~1)** `[x, y, w, h]`. 절대 픽셀 금지(핵심원칙 #1).

---

## 0. 준비: 캡처

- **borderless 창모드**로 게임 실행(독점 전체화면은 WGC 캡처가 까다로움).
- 각 화면(`base_explore` / `choice` / `reward` / `start_end` …)을 PNG로 캡처. **클라이언트
  영역만**(타이틀바 제외). 가능하면 여러 해상도(1080p/1440p/4K)에서 한 장씩.
- game rect 검출은 자동(레터박스/필러박스 스캔). 검은 띠가 없으면 전체 프레임을 쓴다.

## 1. `captures.json` 작성

캡처 위치 기준 상대 경로. `templates[].region` 은 앵커의 **타이트한** 경계.

```json
{
  "captures": [
    { "screen_id": "reward", "frame": "captures/reward_1080p.png" }
  ],
  "templates": [
    { "template_key": "anchor_reward_header", "from_screen": "reward",
      "region": [0.42, 0.05, 0.10, 0.06] }
  ]
}
```

## 2. draft `matching_config.json` 작성

화면·지문 `region` 좌표를 채우고 `phash` 는 `""` 로 둔다(도구가 채움). 스키마는
[`matching_config.sample.json`](matching_config.sample.json) 참고.

```json
{
  "schema_version": "1.0", "game_aspect_ratio": "16:9", "patch_version": "2.7",
  "screens": [{
    "screen_id": "reward", "name": "보상 결과창",
    "fingerprints": [ { "region": [0.40, 0.04, 0.20, 0.06], "phash": "", "tolerance": 12 } ],
    "anchors": [ { "anchor_id": "header", "template_key": "anchor_reward_header",
                   "search_region": [0.38, 0.03, 0.16, 0.10], "match_threshold": 0.85 } ],
    "transitions_allowed": ["base_explore"]
  }]
}
```

## 3. 좌표 눈으로 확인 (`preview`)

지정한 좌표가 실제 프레임의 의도한 영역을 덮는지 박스를 그려 확인한다(지문=초록,
앵커 search=주황).

```bash
cargo run --bin author -- preview matching_config.json reward captures/reward_1080p.png preview.png
```

박스가 어긋나면 좌표를 고치고 다시 본다. 여기서 맞춰두면 뒤 단계가 한 번에 된다.

## 4. 지문 생성 (`fingerprints`)

캡처에서 region-pHash 를 떠 `phash` 를 채우고, 결과를 검증한 뒤 저장한다.

```bash
cargo run --bin author -- fingerprints draft_config.json captures.json matching_config.json
```

- 캡처가 없는 화면은 건너뛴다(로그에 표시). 모든 화면을 채우려면 캡처를 더 추가.
- 출력 config 는 `validate()` 통과(phash 길이 = 런타임 해시 68B 정합)를 보장.

## 5. 템플릿 생성 (`templates`)

앵커 영역을 크롭·경량화해 PNG + 인덱스를 `out_dir` 에 쓴다.

```bash
cargo run --bin author -- templates captures.json templates_out/
# → templates_out/anchor_reward_header.png, templates_out/templates.json
```

런타임은 `anchor::load_template_set("templates_out/", "templates_out/templates.json")` 로
그대로 로드한다.

---

## 6. 검증·튜닝 루프 (M3 없이 데이터만으로)

만든 데이터를 **라벨된 실프레임**에 돌려 전체 파이프라인(Layer 0→1→2)을 한 번에 측정한다.
오버레이(M3) 없이도 인식 정확도는 여기서 전부 검증된다.

### 6.1. 라벨 작성 (`regression/manifest.json`)

```json
{
  "frames": [
    { "path": "frames/reward_1080p.png", "width": 1920, "height": 1080, "dpi": 96,
      "resolution_tag": "1080p", "game_rect": [0,0,1920,1080],
      "expected_screen": "reward",
      "gifts": [ { "gift_id": "gift_xxx", "slot": [0.25,0.40,0.10,0.12] } ] },

    { "path": "frames/transition_01.png", "width": 1920, "height": 1080,
      "expected_screen": null, "is_transition": true, "gifts": [] }
  ]
}
```

- `expected_screen`: 화면 분류 정답. `is_transition: true` 면 **미상/기각이 정답**(전환 중 프레임).
- `gifts[].slot`: 등장 기프트의 정규화 경계. 파이프라인 그리드 결과와 공간 매칭해 평가.

### 6.2. 실행

```bash
cargo run --release --bin run_regression -- \
  phash_index.json ../../guida-server/data/gifts.json ../../guida-server/data/images \
  regression matching_config.json templates_out/
```

`matching_config.json` 인자를 주면 **config 기반 전체 파이프라인**으로 돈다(화면 분류 +
앵커 게이트 + 그리드 식별 + 전환 기각). 출력 지표:

```text
화면 분류 : N/N = 99%+ , 화면 오탐 0
식별      : N/N = 99%+
전환 기각 : N/N = 100%
오탐      : 0
```

### 6.3. 튜닝

목표(화면 ≥99% / 식별 ≥99% / 자동 반영 오탐 0 / 전환 100% 기각) 미달 시 조정:

- 화면 오분류 → 지문 `tolerance`, 지문 region 위치
- 앵커 기각 과다 → `match_threshold`, `cross_check.max_error`, 템플릿 영역
- 식별 오탐 → `ambiguity_margin`(M-pre 권장 18), `max_dist`
- 깜빡임에 흔들림 → 히스테리시스 N(런타임 `StateMachineConfig.commit_frames`)

패치로 UI가 바뀌면 캡처를 다시 떠 §1부터. 코드 수정이 아니라 **데이터 PR**.

> ⚠️ 도구가 쓰는 해시는 런타임 `screen::region_phash` / `hash::phash_canonical` 과
> 동일 구현이다(SSOT). 절대 별도 해시로 지문을 만들지 말 것 — 분류가 통째로 어긋난다.
