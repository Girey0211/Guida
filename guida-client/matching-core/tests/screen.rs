//! Layer 1 화면 인식 통합 검증 (계획서 M1).
//!
//! 실게임 녹화 전, **합성 프레임**으로 두 가지를 오프라인 검증한다:
//!   1. region-pHash 분류가 해상도/창모드(스케일)에 불변 — 1080p 에서 만든 지문으로
//!      1440p/4K/울트라와이드/창모드 프레임을 정확히 분류 (식별 정확도 ≥99%, 오탐 0).
//!   2. 히스테리시스+상태 머신이 모사 플레이 시퀀스에서 합법 전이만 커밋하고
//!      깜빡임/불법 점프를 흡수·기각.

use image::{Rgba, RgbaImage};
use matching_core as mc;
use mc::config::{Fingerprint, MatchingConfig, ScreenConfig};
use mc::geometry::{GameRect, NormRect};
use mc::screen::{classify, region_phash, Commit, StateMachine, StateMachineConfig};

/// 지문 영역. 화면 상단 중앙 UI 크롬을 모사.
const FP_REGION: [f32; 4] = [0.38, 0.04, 0.24, 0.14];

/// game rect 를 회색으로 채우고, 지문 영역에 screen 별 고유 패턴(4×4 셀 비트맵)을
/// 칠한 합성 프레임을 만든다. 패턴은 균일색이 아니라 구조적 그라디언트를 만들어
/// region-pHash(DoubleGradient)가 화면 간 변별되게 한다.
fn synth_screen(frame_w: u32, frame_h: u32, gr: GameRect, pattern: u16) -> RgbaImage {
    let mut canvas = RgbaImage::from_pixel(frame_w, frame_h, Rgba([0, 0, 0, 255]));
    for yy in 0..gr.h {
        for xx in 0..gr.w {
            let px = gr.x as u32 + xx;
            let py = gr.y as u32 + yy;
            if px < frame_w && py < frame_h {
                canvas.put_pixel(px, py, Rgba([60, 62, 64, 255]));
            }
        }
    }
    let region = NormRect::from_array(FP_REGION);
    let (rx, ry, rw, rh) = gr.norm_rect_to_px_clamped(&region, frame_w, frame_h);
    // 영역 배경(중간 회색).
    for yy in ry..ry + rh {
        for xx in rx..rx + rw {
            canvas.put_pixel(xx, yy, Rgba([95, 95, 100, 255]));
        }
    }
    // 4×4 격자에서 pattern 의 set 비트 셀을 밝게 칠함 → 화면 고유 레이아웃.
    let (cols, rows) = (4u32, 4u32);
    let cw = (rw / cols).max(1);
    let ch = (rh / rows).max(1);
    for bit in 0..16u32 {
        if (pattern >> bit) & 1 == 1 {
            let (c, r) = (bit % cols, bit / cols);
            let x0 = rx + c * cw;
            let y0 = ry + r * ch;
            for yy in y0..(y0 + ch).min(ry + rh) {
                for xx in x0..(x0 + cw).min(rx + rw) {
                    canvas.put_pixel(xx, yy, Rgba([225, 205, 50, 255]));
                }
            }
        }
    }
    canvas
}

/// 해밍 거리가 충분히 떨어진 4개 패턴(화면당 1개).
const PATTERNS: [(&str, u16); 4] = [
    ("base_explore", 0b1100_0011_1100_0011),
    ("choice", 0b0011_1100_0011_1100),
    ("reward", 0b1010_0101_1010_0101),
    ("start_end", 0b0110_1001_1001_0110),
];

/// 해상도 프로파일(태그, frame_w, frame_h, game_rect).
const PROFILES: [(&str, u32, u32, [i32; 4]); 5] = [
    ("1080p", 1920, 1080, [0, 0, 1920, 1080]),
    ("1440p", 2560, 1440, [0, 0, 2560, 1440]),
    ("4k", 3840, 2160, [0, 0, 3840, 2160]),
    ("ultrawide", 3440, 1440, [440, 0, 2560, 1440]),
    ("windowed", 1600, 1000, [0, 50, 1600, 900]),
];

fn gr(p: [i32; 4]) -> GameRect {
    GameRect::new(p[0], p[1], p[2] as u32, p[3] as u32)
}

/// 1080p 프레임에서 각 화면의 지문(region-pHash)을 떠 config 를 만든다.
/// tolerance 는 cross-resolution 자기 거리는 통과시키되 화면 간 거리는 막도록 설정.
fn build_config(tolerance: u32) -> MatchingConfig {
    let g = gr(PROFILES[0].3); // 1080p 기준 지문
    let region = NormRect::from_array(FP_REGION);
    let screens = PATTERNS
        .iter()
        .map(|(id, pat)| {
            let frame = synth_screen(1920, 1080, g, *pat);
            let ph = region_phash(&frame, &g, &region).expect("지문 영역 크롭 성공");
            // 전이 그래프: base⇄choice→reward→base, start_end→base.
            let allowed: Vec<String> = match *id {
                "base_explore" => vec!["choice".into(), "start_end".into()],
                "choice" => vec!["base_explore".into(), "reward".into()],
                "reward" => vec!["base_explore".into()],
                "start_end" => vec!["base_explore".into()],
                _ => vec![],
            };
            ScreenConfig {
                screen_id: id.to_string(),
                name: id.to_string(),
                fingerprints: vec![Fingerprint {
                    region: FP_REGION,
                    phash: ph,
                    tolerance,
                }],
                anchors: vec![],
                cross_check: None,
                elements: vec![],
                transitions_allowed: allowed,
            }
        })
        .collect();
    MatchingConfig {
        schema_version: "1.0".into(),
        game_aspect_ratio: "16:9".into(),
        patch_version: "synthetic".into(),
        screens,
    }
}

#[test]
fn region_phash_is_scale_invariant_and_discriminative() {
    // 먼저 거리 구조를 측정해 합리적 tolerance 를 고른다.
    let cfg_probe = build_config(u32::MAX);
    let region = NormRect::from_array(FP_REGION);
    let mut max_self = 0u32; // 동일 화면 cross-resolution 최대 거리
    let mut min_cross = u32::MAX; // 다른 화면 간 최소 거리

    for (i, (id, pat)) in PATTERNS.iter().enumerate() {
        for (tag, fw, fh, gp) in PROFILES {
            let g = gr(gp);
            let frame = synth_screen(fw, fh, g, *pat);
            let q = region_phash(&frame, &g, &region).unwrap();
            for (j, sc) in cfg_probe.screens.iter().enumerate() {
                let d = mc::hamming(&q, &sc.fingerprints[0].phash);
                if i == j {
                    max_self = max_self.max(d);
                } else {
                    min_cross = min_cross.min(d);
                }
                let _ = (id, tag);
            }
        }
    }
    eprintln!("[screen] max self-dist={max_self}, min cross-dist={min_cross}");
    assert!(
        max_self < min_cross,
        "화면 변별 실패: self {max_self} ≥ cross {min_cross}"
    );

    // tolerance = self 와 cross 중간값.
    let tolerance = (max_self + min_cross) / 2;
    let cfg = build_config(tolerance);

    // 모든 (화면 × 해상도) 프레임을 정확히 분류해야 함(식별 ≥99% → 여기선 100%).
    let mut total = 0;
    let mut correct = 0;
    for (id, pat) in PATTERNS {
        for (tag, fw, fh, gp) in PROFILES {
            let g = gr(gp);
            let frame = synth_screen(fw, fh, g, pat);
            let res = classify(&frame, &g, &cfg);
            total += 1;
            match res.screen_id.as_deref() {
                Some(got) if got == id => correct += 1,
                // 오분류 = 화면 오탐. panic 으로 즉시 실패(오탐 0 보장).
                Some(got) => panic!("[{tag}] {id} → 오분류 {got}"),
                None => panic!("[{tag}] {id} → 미분류"),
            }
        }
    }
    assert_eq!(correct, total, "모든 프레임 정확 분류(오탐 0)");

    // 미상 프레임(지문 영역이 빈 회색)은 어느 화면에도 매칭되지 않아야 함.
    let g = gr(PROFILES[0].3);
    let blank = synth_screen(1920, 1080, g, 0); // 패턴 없음
    let res = classify(&blank, &g, &cfg);
    assert!(
        res.screen_id.is_none(),
        "빈 화면이 {:?} 로 오분류됨",
        res.screen_id
    );
}

#[test]
fn simulated_play_sequence_transitions_are_correct() {
    // classify + 상태 머신을 합성 프레임 시퀀스에 돌려 화면 전환 검출을 검증.
    let cfg = {
        // 위 테스트가 고른 tolerance 와 동일 절차.
        let probe = build_config(u32::MAX);
        let region = NormRect::from_array(FP_REGION);
        let mut max_self = 0u32;
        let mut min_cross = u32::MAX;
        for (i, (_, pat)) in PATTERNS.iter().enumerate() {
            for (_, fw, fh, gp) in PROFILES {
                let g = gr(gp);
                let q = region_phash(&synth_screen(fw, fh, g, *pat), &g, &region).unwrap();
                for (j, sc) in probe.screens.iter().enumerate() {
                    let d = mc::hamming(&q, &sc.fingerprints[0].phash);
                    if i == j {
                        max_self = max_self.max(d);
                    } else {
                        min_cross = min_cross.min(d);
                    }
                }
            }
        }
        build_config((max_self + min_cross) / 2)
    };

    let g = gr(PROFILES[1].3); // 1440p 로 플레이한다고 가정
    let n = 4u32;
    let mut sm = StateMachine::new(&cfg, StateMachineConfig { commit_frames: n });

    // 한 화면을 m 프레임 공급하며 상태 머신 반응을 모은다.
    let feed = |sm: &mut StateMachine, pat: u16, m: u32| -> Vec<Commit> {
        let frame = synth_screen(2560, 1440, g, pat);
        (0..m)
            .map(|_| {
                let raw = classify(&frame, &g, &cfg).screen_id;
                sm.on_frame(raw)
            })
            .collect()
    };

    let pat = |id: &str| PATTERNS.iter().find(|(n, _)| *n == id).unwrap().1;

    // 모사 시퀀스: base_explore → choice → reward → base_explore.
    feed(&mut sm, pat("base_explore"), n);
    assert_eq!(sm.current(), Some("base_explore"));

    feed(&mut sm, pat("choice"), n);
    assert_eq!(sm.current(), Some("choice"));

    // 깜빡임: reward 가 n-1 프레임만(미달) → 아직 choice.
    if n > 1 {
        feed(&mut sm, pat("reward"), n - 1);
        assert_eq!(sm.current(), Some("choice"), "안정 미달 전환 무시");
    }
    // reward 안정 → 커밋.
    feed(&mut sm, pat("reward"), n);
    assert_eq!(sm.current(), Some("reward"));

    // reward → base_explore 합법.
    feed(&mut sm, pat("base_explore"), n);
    assert_eq!(sm.current(), Some("base_explore"));

    // 불법 점프 시도: base_explore → reward (allowed=[choice,start_end]) → 기각.
    let commits = feed(&mut sm, pat("reward"), n + 2);
    assert!(
        commits.iter().any(|c| matches!(c, Commit::Rejected { .. })),
        "불법 전이는 기각되어야 함"
    );
    assert_eq!(sm.current(), Some("base_explore"), "불법 점프로 화면 안 바뀜");
}
