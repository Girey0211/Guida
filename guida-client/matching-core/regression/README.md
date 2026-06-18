# 회귀 검증 세트 (계획서 §6)

라벨된 실(實)프레임에 매칭 파이프라인을 돌려 화면/식별 정확도·오탐을 측정하고
임계값 회귀를 CI에서 자동 검증한다. **목표: 화면 ≥99% / 식별 ≥99% / 자동 반영 오탐 0.**

## 디렉토리 구조

```
regression/
├── README.md          # 이 문서
├── manifest.json      # 프레임 라벨(정답 주석) — 수집 후 작성
└── frames/            # 캡처 PNG (git 비추적, 용량 큼)
    ├── reward_1080p_01.png
    └── ...
```

`manifest.json` 이 없으면 러너는 **합성 시드**로 스모크 검증을 수행한다(실프레임 수집 전에도 하니스 가동).

## 수집 가이드 (§6)

각 주요 화면(기본탐사 / 선택지 / 보상 / 시작·종료)을 아래 환경에서 캡처:
- 해상도: 1080p / 1440p / 4K / 울트라와이드(21:9) / 여러 창 크기
- DPI: 100 / 125 / 150 %

## manifest.json 스키마

```json
{
  "frames": [
    {
      "path": "frames/reward_1080p_01.png",
      "width": 1920,
      "height": 1080,
      "dpi": 96,
      "resolution_tag": "1080p",
      "game_rect": [0, 0, 1920, 1080],
      "expected_screen": "reward",
      "gifts": [
        { "gift_id": "gift_만년_화롯불", "slot": [0.30, 0.35, 0.072, 0.072] }
      ]
    }
  ]
}
```

| 필드 | 의미 |
|---|---|
| `path` | manifest 기준 상대 경로 (PNG) |
| `game_rect` | 기대 game rect `[x,y,w,h]`(픽셀). 검출값과 ±2px 비교. null 이면 game rect 검증 생략 |
| `expected_screen` | 화면 종류(M1에서 사용) |
| `gifts[].slot` | game rect 기준 정규화 `[x,y,w,h]`. 이 영역을 크롭해 식별 |

## 실행

```bash
# 합성 스모크 (실프레임 없을 때)
cargo run --release --bin run_regression

# 실프레임 매니페스트로 CI 게이트 (목표 미달 시 exit 1)
cargo run --release --bin run_regression -- phash_index.json \
  ../../guida-server/data/gifts.json ../../guida-server/data/images regression
```

## 파라미터 (M-pre 도출)

- game rect 허용 오차: **±2px**
- `ambiguity_margin`: **18** (top2-top1 ≤ 18 → 2차 판별)
- 식별 거리 캡 `max_dist`: **180** (현실 왜곡 p99_intra=156·max=187 기준)
- `center_crop`: 1.0 (M2에서 실프레임으로 최종 확정)
