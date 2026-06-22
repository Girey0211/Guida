//! 회귀 하니스 자가 검증 (계획서 §6).
//!
//! 실프레임 수집 전, 합성 프레임(5개 해상도 프로파일)으로 전체 파이프라인
//! (Layer 0 game rect + Layer 2 식별)을 돌려 하니스가 작동하고 목표 지표를
//! 만족함을 확인한다. 실데이터 없으면 skip(CI 가드).

use image::{Rgba, RgbaImage};
use matching_core as mc;
use mc::anchor::{Template, TemplateSet};
use mc::config::{Anchor, CrossCheck as CcCfg, Element, Fingerprint, MatchingConfig, ScreenConfig};
use mc::geometry::{GameRect, NormPoint, NormRect};
use mc::identify::{IndexEntry, PhashIndex};
use mc::regression::{
    run_frame, run_frame_pipeline, synth_frame, FrameLabel, GiftSlotLabel, Metrics, RunOpts,
};
use mc::screen::region_phash;
use std::path::PathBuf;

fn data_dir() -> Option<PathBuf> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../guida-server/data");
    base.join("gifts.json").exists().then_some(base)
}

#[test]
fn synthetic_pipeline_meets_targets() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] guida-server/data 없음");
        return;
    };
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");

    // 전체 449 인덱스(현실적 식별 난이도).
    let entries: Vec<IndexEntry> = gifts
        .iter()
        .map(|g| IndexEntry {
            gift_id: g.id.clone(),
            hash: mc::hash::phash_with_crop(
                &image::open(mc::image_path(&images, &g.image_key))
                    .unwrap()
                    .to_rgba8(),
                mc::DEFAULT_CENTER_CROP,
            ),
        })
        .collect();
    let index = PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop: mc::DEFAULT_CENTER_CROP,
        patch_version: String::new(),
        entries,
    };

    // 10개 아이콘을 5개 해상도 프로파일에 배치.
    let icons: Vec<(String, image::RgbaImage)> = gifts
        .iter()
        .take(10)
        .map(|g| {
            (
                g.id.clone(),
                image::open(mc::image_path(&images, &g.image_key))
                    .unwrap()
                    .to_rgba8(),
            )
        })
        .collect();

    let profiles = [
        ("1080p", 1920, 1080, GameRect::new(0, 0, 1920, 1080)),
        ("1440p", 2560, 1440, GameRect::new(0, 0, 2560, 1440)),
        ("4k", 3840, 2160, GameRect::new(0, 0, 3840, 2160)),
        ("ultrawide", 3440, 1440, GameRect::new(440, 0, 2560, 1440)),
        ("windowed", 1600, 1000, GameRect::new(0, 50, 1600, 900)),
    ];

    let opts = RunOpts::default();
    let mut m = Metrics::default();
    for (tag, fw, fh, gr) in profiles {
        let (label, img) = synth_frame(tag, fw, fh, gr, &icons);
        run_frame(&label, &img, &index, &opts, &mut m);
    }

    eprintln!(
        "[regression] game rect {:.1}% ({}/{}), 식별 {:.1}% ({}/{}), 오탐 {}",
        m.gamerect_pct(),
        m.gamerect_within_tol,
        m.gamerect_total,
        m.identify_pct(),
        m.identify_correct,
        m.identify_total,
        m.false_positives
    );
    for f in m.failures.iter().take(20) {
        eprintln!("  fail: {f}");
    }

    assert_eq!(m.gamerect_total, 5, "5개 프로파일");
    assert!(m.gamerect_pct() >= 99.0, "game rect {:.1}% < 99%", m.gamerect_pct());
    assert!(m.identify_pct() >= 99.0, "식별 {:.1}% < 99%", m.identify_pct());
    assert_eq!(m.false_positives, 0, "자동 반영 오탐 0이어야 함");
}

// ---------------------------------------------------------------------------
// config 기반 전체 파이프라인(run_frame_pipeline) 검증.
// 저작 도구로 만들 데이터(지문/앵커/그리드)를 합성 프레임으로 모사해, M3 없이
// 화면 분류 + 앵커 게이트 + 그리드 식별 + 전환 기각이 한 러너로 검증됨을 확인한다.
// ---------------------------------------------------------------------------

const FP_REGION: [f32; 4] = [0.02, 0.02, 0.20, 0.10];
const HEADER_CENTER: NormPoint = NormPoint { x: 0.45, y: 0.08 };
const HEADER_FP: (f32, f32) = (0.08, 0.05);
const HEADER_SR: [f32; 4] = [0.37, 0.03, 0.16, 0.10]; // 중심 (0.45,0.08)
const CORNER_CENTER: NormPoint = NormPoint { x: 0.15, y: 0.85 };
const CORNER_FP: (f32, f32) = (0.06, 0.06);
const CORNER_SR: [f32; 4] = [0.09, 0.79, 0.12, 0.12]; // 중심 (0.15,0.85)
const GRID_ORIGIN: [f32; 2] = [0.25, 0.40];
const GRID_CELL: [f32; 2] = [0.10, 0.12];
const GRID_COLS: u32 = 5;

fn patch(w: u32, h: u32, seed: u32) -> RgbaImage {
    let mut img = RgbaImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let gx = (x * 255 / w.max(1)) as u8;
            let gy = (y * 255 / h.max(1)) as u8;
            let b = if ((x * 4 / w.max(1)) + (y * 4 / h.max(1)) + seed) & 1 == 1 { 210 } else { 50 };
            img.put_pixel(x, y, Rgba([gx, gy, b, 255]));
        }
    }
    img
}

fn paint_patch(c: &mut RgbaImage, g: GameRect, center: NormPoint, fp: (f32, f32), seed: u32) {
    let w = (fp.0 * g.w as f32).round().max(1.0) as u32;
    let h = (fp.1 * g.h as f32).round().max(1.0) as u32;
    let (cx, cy) = g.norm_to_px(center);
    let p = patch(w, h, seed);
    image::imageops::overlay(c, &p, (cx - w as f32 / 2.0).round() as i64, (cy - h as f32 / 2.0).round() as i64);
}

/// reward 프레임 합성: 지문영역 패턴 + 앵커 2개 + 기프트 그리드. corner_shift 로 전환 모사.
fn synth_reward(
    g: GameRect,
    icons: &[(String, RgbaImage)],
    corner_shift: f32,
) -> (RgbaImage, Vec<GiftSlotLabel>) {
    let (fw, fh) = (g.x as u32 + g.w, g.y as u32 + g.h);
    let mut c = RgbaImage::from_pixel(fw, fh, Rgba([0, 0, 0, 255]));
    for yy in 0..g.h {
        for xx in 0..g.w {
            c.put_pixel(g.x as u32 + xx, g.y as u32 + yy, Rgba([58, 60, 63, 255]));
        }
    }
    // 지문 영역: 4×4 비트 패턴(균일색 아님).
    let (rx, ry, rw, rh) = g.norm_rect_to_px_clamped(&NormRect::from_array(FP_REGION), fw, fh);
    let (cw, ch) = ((rw / 4).max(1), (rh / 4).max(1));
    let pat = 0b1010_0101_1010_0101u16;
    for bit in 0..16u32 {
        if (pat >> bit) & 1 == 1 {
            for yy in ry + (bit / 4) * ch..(ry + (bit / 4 + 1) * ch).min(ry + rh) {
                for xx in rx + (bit % 4) * cw..(rx + (bit % 4 + 1) * cw).min(rx + rw) {
                    c.put_pixel(xx, yy, Rgba([220, 200, 40, 255]));
                }
            }
        }
    }
    // 앵커.
    paint_patch(&mut c, g, HEADER_CENTER, HEADER_FP, 1);
    paint_patch(&mut c, g, NormPoint { x: CORNER_CENTER.x + corner_shift, y: CORNER_CENTER.y }, CORNER_FP, 9);
    // 그리드.
    let mut labels = Vec::new();
    for (i, (id, icon)) in icons.iter().enumerate() {
        let slot = NormRect::new(
            GRID_ORIGIN[0] + (i as u32 % GRID_COLS) as f32 * GRID_CELL[0],
            GRID_ORIGIN[1],
            GRID_CELL[0],
            GRID_CELL[1],
        );
        let (x, y, w, h) = g.norm_rect_to_px_clamped(&slot, fw, fh);
        for yy in y..y + h {
            for xx in x..x + w {
                c.put_pixel(xx, yy, Rgba([0, 0, 0, 255]));
            }
        }
        let r = image::imageops::resize(icon, w, h, image::imageops::FilterType::Lanczos3);
        image::imageops::overlay(&mut c, &r, x as i64, y as i64);
        labels.push(GiftSlotLabel { gift_id: id.clone(), slot: [slot.x, slot.y, slot.w, slot.h] });
    }
    (c, labels)
}

fn reward_config(frame: &RgbaImage, g: GameRect) -> (MatchingConfig, TemplateSet) {
    let phash = region_phash(frame, &g, &NormRect::from_array(FP_REGION)).unwrap();
    let cfg = MatchingConfig {
        schema_version: "1.0".into(),
        game_aspect_ratio: "16:9".into(),
        patch_version: "pipeline-test".into(),
        screens: vec![ScreenConfig {
            screen_id: "reward".into(),
            name: "reward".into(),
            fingerprints: vec![Fingerprint { region: FP_REGION, phash, tolerance: 40 }],
            anchors: vec![
                Anchor { anchor_id: "header".into(), template_key: "h".into(), search_region: HEADER_SR, match_threshold: 0.6 },
                Anchor { anchor_id: "corner".into(), template_key: "c".into(), search_region: CORNER_SR, match_threshold: 0.6 },
            ],
            cross_check: Some(CcCfg { predict_from: "header".into(), verify: "corner".into(), max_error: 0.03 }),
            elements: vec![Element {
                element_id: "grid".into(), element_type: "icon_grid".into(),
                origin: Some(GRID_ORIGIN), cell: Some(GRID_CELL), cols: Some(GRID_COLS), rows: Some(1),
                center_crop: Some(1.0), r#match: Some("phash".into()), ambiguity_margin: Some(18),
            }],
            transitions_allowed: vec![],
        }],
    };
    let mut t = TemplateSet::new();
    t.insert("h".into(), Template::new(patch(64, 40, 1), HEADER_FP.0, HEADER_FP.1));
    t.insert("c".into(), Template::new(patch(48, 48, 9), CORNER_FP.0, CORNER_FP.1));
    (cfg, t)
}

#[test]
fn config_pipeline_classifies_gates_and_identifies() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] data 없음");
        return;
    };
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");
    let icons: Vec<(String, RgbaImage)> = gifts
        .iter()
        .take(GRID_COLS as usize)
        .map(|gg| (gg.id.clone(), image::open(mc::image_path(&images, &gg.image_key)).unwrap().to_rgba8()))
        .collect();
    let index = {
        let entries: Vec<IndexEntry> = gifts
            .iter()
            .map(|gg| IndexEntry {
                gift_id: gg.id.clone(),
                hash: mc::hash::phash_with_crop(
                    &image::open(mc::image_path(&images, &gg.image_key)).unwrap().to_rgba8(),
                    mc::DEFAULT_CENTER_CROP,
                ),
            })
            .collect();
        PhashIndex { hash_version: mc::hash::HASH_VERSION.into(), center_crop: mc::DEFAULT_CENTER_CROP, patch_version: String::new(), entries }
    };

    let g = GameRect::new(0, 0, 1920, 1080);
    let (frame, slots) = synth_reward(g, &icons, 0.0);
    let (cfg, tmpls) = reward_config(&frame, g);
    let opts = RunOpts::default();

    // 정렬 프레임.
    let label = FrameLabel {
        path: "synthetic://reward".into(),
        width: 1920, height: 1080, dpi: 96, resolution_tag: "1080p".into(),
        game_rect: Some([0, 0, 1920, 1080]),
        expected_screen: Some("reward".into()),
        is_transition: false,
        gifts: slots,
    };
    let mut m = Metrics::default();
    run_frame_pipeline(&label, &frame, &cfg, &tmpls, &index, &opts, &mut m);
    eprintln!(
        "[pipeline] 화면 {}/{}, 식별 {}/{}, 오탐 {}, 실패 {:?}",
        m.screen_correct, m.screen_total, m.identify_correct, m.identify_total, m.false_positives, m.failures
    );
    assert_eq!(m.screen_correct, 1, "화면 분류 정답");
    assert_eq!(m.identify_correct, m.identify_total, "그리드 전부 식별");
    assert_eq!(m.identify_total, GRID_COLS as usize, "5슬롯");
    assert_eq!(m.false_positives, 0, "오탐 0");
    assert_eq!(m.gate_rejected_frames, 0, "정렬 프레임은 게이트 통과");

    // 전환 프레임(모서리 앵커 오정렬).
    let (tframe, tslots) = synth_reward(g, &icons, 0.12);
    let tlabel = FrameLabel {
        path: "synthetic://transition".into(),
        width: 1920, height: 1080, dpi: 96, resolution_tag: "1080p".into(),
        game_rect: Some([0, 0, 1920, 1080]),
        expected_screen: None,
        is_transition: true,
        gifts: tslots,
    };
    let mut tm = Metrics::default();
    run_frame_pipeline(&tlabel, &tframe, &cfg, &tmpls, &index, &opts, &mut tm);
    assert_eq!(tm.transition_total, 1);
    assert_eq!(tm.transition_correctly_rejected, 1, "전환 프레임 100% 기각");
}
