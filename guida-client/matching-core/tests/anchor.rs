//! Layer 2 통합 검증 (계획서 M2).
//!
//! 실게임 캡처 전 **합성 보상창 프레임**으로 검증:
//!   1. 앵커(헤더·모서리)가 해상도(1080p/1440p/4K)에 걸쳐 NCC 로 정확히 탐지·임계 통과.
//!   2. 정렬 프레임은 교차검증 통과 → 그리드 기프트 식별 ≥99%·오탐 0.
//!   3. 앵커가 오정렬된 "전환 중" 프레임은 교차검증 기각 → 식별 미수행(100% 기각).
//!   4. 모호 슬롯 NCC 2차 판별이 정답 후보를 고른다.
//!
//! 실데이터(guida-server/data)가 없으면 skip.

use image::{Rgba, RgbaImage};
use matching_core as mc;
use mc::anchor::{
    cross_check, disambiguate_ncc, locate_anchors, verify_and_identify, CrossCheck, FrameOutcome,
    IdentifyOpts, Template, TemplateSet,
};
use mc::config::{Anchor, CrossCheck as CcCfg, Element, ScreenConfig};
use mc::geometry::{GameRect, NormPoint, NormRect};
use mc::identify::{IndexEntry, PhashIndex};
use std::path::PathBuf;

fn data_dir() -> Option<PathBuf> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../guida-server/data");
    base.join("gifts.json").exists().then_some(base)
}

// 앵커 배치(정규화): 중심 + footprint + search 윈도우.
const HEADER_CENTER: NormPoint = NormPoint { x: 0.45, y: 0.08 };
const HEADER_FP: (f32, f32) = (0.08, 0.05);
const HEADER_SR: [f32; 4] = [0.39, 0.04, 0.12, 0.08]; // 중심 (0.45,0.08)
const CORNER_CENTER: NormPoint = NormPoint { x: 0.15, y: 0.85 };
const CORNER_FP: (f32, f32) = (0.06, 0.06);
const CORNER_SR: [f32; 4] = [0.10, 0.80, 0.10, 0.10]; // 중심 (0.15,0.85)

// 그리드: 5열 1행, 화면 중앙대.
const GRID_ORIGIN: [f32; 2] = [0.25, 0.40];
const GRID_CELL: [f32; 2] = [0.10, 0.12];
const GRID_COLS: u32 = 5;

const PROFILES: [(&str, u32, u32, [i32; 4]); 3] = [
    ("1080p", 1920, 1080, [0, 0, 1920, 1080]),
    ("1440p", 2560, 1440, [0, 0, 2560, 1440]),
    ("4k", 3840, 2160, [0, 0, 3840, 2160]),
];

fn gr(p: [i32; 4]) -> GameRect {
    GameRect::new(p[0], p[1], p[2] as u32, p[3] as u32)
}

/// 그라디언트+체커 패턴의 앵커 템플릿(평탄하지 않아 NCC 피크가 뾰족).
fn make_patch(w: u32, h: u32, seed: u32) -> RgbaImage {
    let mut img = RgbaImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let gx = (x * 255 / w.max(1)) as u8;
            let gy = (y * 255 / h.max(1)) as u8;
            let block = (x * 4 / w.max(1)) + (y * 4 / h.max(1)) + seed;
            let b = if block & 1 == 1 { 210 } else { 50 };
            img.put_pixel(x, y, Rgba([gx, gy, b, 255]));
        }
    }
    img
}

fn templates() -> TemplateSet {
    let mut t = TemplateSet::new();
    t.insert("h".into(), Template::new(make_patch(64, 40, 1), HEADER_FP.0, HEADER_FP.1));
    t.insert("c".into(), Template::new(make_patch(48, 48, 9), CORNER_FP.0, CORNER_FP.1));
    t
}

fn paint_patch(canvas: &mut RgbaImage, g: GameRect, center: NormPoint, fp: (f32, f32), seed: u32) {
    let w = (fp.0 * g.w as f32).round().max(1.0) as u32;
    let h = (fp.1 * g.h as f32).round().max(1.0) as u32;
    let (cx, cy) = g.norm_to_px(center);
    let x0 = (cx - w as f32 / 2.0).round() as i64;
    let y0 = (cy - h as f32 / 2.0).round() as i64;
    let patch = make_patch(w, h, seed);
    image::imageops::overlay(canvas, &patch, x0, y0);
}

/// 합성 보상창 프레임 + 슬롯별 정답 gift_id. `corner_shift` 만큼 모서리 앵커를
/// x 방향으로 어긋나게 그려 "전환 중" 프레임을 만든다(교차검증 기각 대상).
fn synth_reward(
    fw: u32,
    fh: u32,
    g: GameRect,
    icons: &[(String, RgbaImage)],
    corner_shift: f32,
) -> (RgbaImage, Vec<(NormRect, String)>) {
    let mut canvas = RgbaImage::from_pixel(fw, fh, Rgba([0, 0, 0, 255]));
    for yy in 0..g.h {
        for xx in 0..g.w {
            let (px, py) = (g.x as u32 + xx, g.y as u32 + yy);
            if px < fw && py < fh {
                canvas.put_pixel(px, py, Rgba([58, 60, 63, 255]));
            }
        }
    }
    // 앵커.
    paint_patch(&mut canvas, g, HEADER_CENTER, HEADER_FP, 1);
    paint_patch(
        &mut canvas,
        g,
        NormPoint {
            x: CORNER_CENTER.x + corner_shift,
            y: CORNER_CENTER.y,
        },
        CORNER_FP,
        9,
    );

    // 그리드: 각 셀을 검정으로 깐 뒤 아이콘을 셀에 꽉 채워(squash) overlay
    // → 셀 = 슬롯 = 아이콘 경계, 투명부는 검정 평탄화(인덱스 규약과 일치).
    let mut labels = Vec::new();
    for (i, (id, icon)) in icons.iter().enumerate() {
        let c = i as u32 % GRID_COLS;
        let r = i as u32 / GRID_COLS;
        let slot = NormRect::new(
            GRID_ORIGIN[0] + c as f32 * GRID_CELL[0],
            GRID_ORIGIN[1] + r as f32 * GRID_CELL[1],
            GRID_CELL[0],
            GRID_CELL[1],
        );
        let (x, y, w, h) = g.norm_rect_to_px_clamped(&slot, fw, fh);
        for yy in y..y + h {
            for xx in x..x + w {
                canvas.put_pixel(xx, yy, Rgba([0, 0, 0, 255]));
            }
        }
        let resized = image::imageops::resize(icon, w, h, image::imageops::FilterType::Lanczos3);
        image::imageops::overlay(&mut canvas, &resized, x as i64, y as i64);
        labels.push((slot, id.clone()));
    }
    (canvas, labels)
}

fn reward_screen() -> ScreenConfig {
    ScreenConfig {
        screen_id: "reward".into(),
        name: "보상 결과창".into(),
        fingerprints: vec![],
        anchors: vec![
            Anchor {
                anchor_id: "header".into(),
                template_key: "h".into(),
                search_region: HEADER_SR,
                match_threshold: 0.6,
            },
            Anchor {
                anchor_id: "corner".into(),
                template_key: "c".into(),
                search_region: CORNER_SR,
                match_threshold: 0.6,
            },
        ],
        cross_check: Some(CcCfg {
            predict_from: "header".into(),
            verify: "corner".into(),
            max_error: 0.02,
        }),
        elements: vec![Element {
            element_id: "gift_grid".into(),
            element_type: "icon_grid".into(),
            origin: Some(GRID_ORIGIN),
            cell: Some(GRID_CELL),
            cols: Some(GRID_COLS),
            rows: Some(1),
            center_crop: Some(1.0),
            r#match: Some("phash".into()),
            ambiguity_margin: Some(18),
        }],
        transitions_allowed: vec![],
    }
}

fn build_index(data: &std::path::Path, gifts: &[mc::GiftRecord]) -> PhashIndex {
    let images = data.join("images");
    let entries: Vec<IndexEntry> = gifts
        .iter()
        .map(|g| IndexEntry {
            gift_id: g.id.clone(),
            hash: mc::hash::phash_with_crop(
                &image::open(mc::image_path(&images, &g.image_key)).unwrap().to_rgba8(),
                mc::DEFAULT_CENTER_CROP,
            ),
        })
        .collect();
    PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop: mc::DEFAULT_CENTER_CROP,
        patch_version: String::new(),
        entries,
    }
}

#[test]
fn anchors_locate_across_resolutions() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] data 없음");
        return;
    };
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");
    let icons: Vec<(String, RgbaImage)> = gifts
        .iter()
        .take(GRID_COLS as usize)
        .map(|g| {
            (g.id.clone(), image::open(mc::image_path(&images, &g.image_key)).unwrap().to_rgba8())
        })
        .collect();

    let screen = reward_screen();
    let tmpls = templates();

    for (tag, fw, fh, gp) in PROFILES {
        let g = gr(gp);
        let (frame, _) = synth_reward(fw, fh, g, &icons, 0.0);
        let matches = locate_anchors(&frame, &g, &screen, &tmpls);
        assert_eq!(matches.len(), 2, "[{tag}] 두 앵커 검출");
        for m in &matches {
            let exp = if m.anchor_id == "header" { HEADER_CENTER } else { CORNER_CENTER };
            let err = ((m.center.x - exp.x).powi(2) + (m.center.y - exp.y).powi(2)).sqrt();
            eprintln!("[{tag}] {} score={:.3} err={:.4}", m.anchor_id, m.score, err);
            assert!(m.passed, "[{tag}] {} 임계 미달 score={:.3}", m.anchor_id, m.score);
            assert!(err < 0.02, "[{tag}] {} 위치오차 {err:.4} 큼", m.anchor_id);
        }
        assert_eq!(cross_check(&screen, &matches, true), CrossCheck::Ok, "[{tag}] 정렬 프레임 통과");
    }
}

#[test]
fn aligned_frame_identifies_grid() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] data 없음");
        return;
    };
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");
    let index = build_index(&data, &gifts); // 전체 449 (현실 난이도)
    let icons: Vec<(String, RgbaImage)> = gifts
        .iter()
        .take(GRID_COLS as usize)
        .map(|g| {
            (g.id.clone(), image::open(mc::image_path(&images, &g.image_key)).unwrap().to_rgba8())
        })
        .collect();
    let screen = reward_screen();
    let tmpls = templates();
    let opts = IdentifyOpts::default();

    let mut total = 0;
    let mut correct = 0;
    for (tag, fw, fh, gp) in PROFILES {
        let g = gr(gp);
        let (frame, labels) = synth_reward(fw, fh, g, &icons, 0.0);
        match verify_and_identify(&frame, &g, &screen, &tmpls, &index, &opts) {
            FrameOutcome::Rejected(why) => panic!("[{tag}] 정렬 프레임이 기각됨: {why}"),
            FrameOutcome::Identified(results) => {
                assert_eq!(results.len(), labels.len(), "[{tag}] 슬롯 수");
                for (res, (_, gid)) in results.iter().zip(&labels) {
                    total += 1;
                    let top = &res.ident.top[0];
                    // 오답을 confident 하게 식별 = 자동 반영 오탐. panic 으로 즉시 실패.
                    if res.ident.rejected {
                        panic!("[{tag}] {gid} 미식별(dist={})", top.dist);
                    } else if top.gift_id == *gid {
                        correct += 1;
                    } else {
                        panic!("[{tag}] 오탐: {gid} → {} (dist={})", top.gift_id, top.dist);
                    }
                }
            }
        }
    }
    eprintln!("[anchor] 식별 {correct}/{total} (오탐 0)");
    assert_eq!(correct, total, "기프트 식별 100%");
}

#[test]
fn transition_frame_is_rejected() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] data 없음");
        return;
    };
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");
    let index = build_index(&data, &gifts);
    let icons: Vec<(String, RgbaImage)> = gifts
        .iter()
        .take(GRID_COLS as usize)
        .map(|g| {
            (g.id.clone(), image::open(mc::image_path(&images, &g.image_key)).unwrap().to_rgba8())
        })
        .collect();
    let screen = reward_screen();
    let tmpls = templates();
    let opts = IdentifyOpts::default();

    // 모서리 앵커를 0.10 어긋나게(전환 중 프레임) → 교차검증 기각, 식별 미수행.
    for (tag, fw, fh, gp) in PROFILES {
        let g = gr(gp);
        let (frame, _) = synth_reward(fw, fh, g, &icons, 0.10);
        match verify_and_identify(&frame, &g, &screen, &tmpls, &index, &opts) {
            FrameOutcome::Rejected(_) => {}
            FrameOutcome::Identified(_) => panic!("[{tag}] 전환 프레임이 기각되지 않음"),
        }
    }
}

#[test]
fn disambiguation_picks_correct_candidate() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] data 없음");
        return;
    };
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");
    // 첫 3개 기프트를 후보로, 슬롯 = 2번째 기프트의 약간 왜곡된 이미지.
    let refs: Vec<(String, RgbaImage)> = gifts
        .iter()
        .take(3)
        .map(|g| {
            let img = image::open(mc::image_path(&images, &g.image_key)).unwrap().to_rgba8();
            (g.id.clone(), mc::canonicalize(&img))
        })
        .collect();
    let truth = &refs[1];
    // 슬롯: 진짜 아이콘에 가벼운 노이즈.
    let slot = {
        let orig = image::open(mc::image_path(&images, &gifts[1].image_key)).unwrap().to_rgba8();
        mc::canonicalize(&mc::distort_noise(&mc::canonicalize(&orig), 10.0, 7))
    };
    let pick = disambiguate_ncc(&slot, &refs).expect("후보 선택");
    assert_eq!(pick, truth.0, "NCC 2차 판별이 정답 후보를 골라야 함");
}
