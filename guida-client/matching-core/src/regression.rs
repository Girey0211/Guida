//! 회귀 검증 세트 인프라. (계획서 §6)
//!
//! "어떻게 검증하느냐"의 답: 라벨된 프레임 세트에 전체 파이프라인(현재 Layer 0 game
//! rect + Layer 2 식별)을 돌려 지표(화면/식별 정확도·오탐)를 산출하고, 임계값 회귀를
//! CI에서 자동 검증한다. 실프레임 수집 전에도 **합성 프레임**으로 하니스를 가동한다.
//!
//! 목표 지표: 화면 ≥99% / 기프트 식별 ≥99% / 자동 반영 오탐 = 0.

use crate::anchor::{verify_and_identify, FrameOutcome, IdentifyOpts, TemplateSet};
use crate::config::MatchingConfig;
use crate::geometry::{GameRect, NormPoint, NormRect};
use crate::identify::PhashIndex;
use crate::normalize::{detect_game_rect, DetectOpts};
use crate::screen::classify;
use image::RgbaImage;
use serde::{Deserialize, Serialize};

/// 한 기프트 슬롯 라벨: gift_id + game rect 기준 정규화 슬롯 사각형.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiftSlotLabel {
    pub gift_id: String,
    /// `[x, y, w, h]` 정규화(game rect 기준).
    pub slot: [f32; 4],
}

/// 한 프레임 라벨(정답 주석).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameLabel {
    /// 프레임 이미지 경로(manifest 디렉토리 기준 상대) 또는 합성 식별자.
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub dpi: u32,
    /// "1080p" / "1440p" / "4k" / "ultrawide" / "windowed" 등.
    #[serde(default)]
    pub resolution_tag: String,
    /// 기대 game rect `[x, y, w, h]`(픽셀). None 이면 game rect 검증 생략.
    #[serde(default)]
    pub game_rect: Option<[i32; 4]>,
    /// 화면 종류(M1). config 기반 파이프라인에서 화면 분류 정답으로 사용.
    #[serde(default)]
    pub expected_screen: Option<String>,
    /// 전환 중/팝업 프레임 표시. true 면 화면 미상 또는 Layer 2 기각이 정답(계획서 M2 완료기준).
    #[serde(default)]
    pub is_transition: bool,
    /// 등장 기프트 슬롯들.
    #[serde(default)]
    pub gifts: Vec<GiftSlotLabel>,
}

/// 회귀 매니페스트.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RegressionManifest {
    pub frames: Vec<FrameLabel>,
}

/// 집계 지표.
#[derive(Debug, Default, Clone)]
pub struct Metrics {
    pub gamerect_total: usize,
    pub gamerect_within_tol: usize,
    pub identify_total: usize,
    pub identify_correct: usize,
    /// 라벨에 없는데 high-confidence 로 잘못 식별(자동 반영 오탐 대용).
    pub false_positives: usize,
    /// Layer 1 화면 분류(계획서 M1). expected_screen 라벨이 있는 프레임만 집계.
    pub screen_total: usize,
    pub screen_correct: usize,
    /// 라벨과 다른 화면으로 confident 분류(화면 오탐).
    pub screen_false_positives: usize,
    /// config 기반 파이프라인: 전환 프레임 총수 / 그 중 올바르게 기각된 수(계획서 M2).
    pub transition_total: usize,
    pub transition_correctly_rejected: usize,
    /// Layer 2 게이트(앵커/교차검증)에 의해 기각된 비전환 프레임 수.
    pub gate_rejected_frames: usize,
    pub failures: Vec<String>,
}

impl Metrics {
    pub fn gamerect_pct(&self) -> f64 {
        pct(self.gamerect_within_tol, self.gamerect_total)
    }
    pub fn identify_pct(&self) -> f64 {
        pct(self.identify_correct, self.identify_total)
    }
    pub fn screen_pct(&self) -> f64 {
        pct(self.screen_correct, self.screen_total)
    }
    pub fn transition_pct(&self) -> f64 {
        pct(self.transition_correctly_rejected, self.transition_total)
    }
}

fn pct(num: usize, den: usize) -> f64 {
    if den == 0 {
        100.0
    } else {
        num as f64 / den as f64 * 100.0
    }
}

/// 검증 옵션.
#[derive(Debug, Clone, Copy)]
pub struct RunOpts {
    /// game rect 허용 오차(px). 완료 기준 ±2px.
    pub gamerect_tol: i32,
    /// 식별 모호 마진(이하면 모호). M-pre 권장 19.
    pub ambiguity_margin: u32,
    /// 식별 거리 캡(초과 시 미식별=기각). M-pre 측정 현실 왜곡 p99_intra=156·max=187 →
    /// true gift 가 최근접이어도 절대거리가 큰 경우가 있어 180 으로 둔다(너무 낮으면 미탐 급증).
    pub max_dist: u32,
    pub center_crop: f32,
}

impl Default for RunOpts {
    fn default() -> Self {
        Self {
            gamerect_tol: 2,
            ambiguity_margin: 19,
            max_dist: 180,
            center_crop: crate::DEFAULT_CENTER_CROP,
        }
    }
}

/// 프레임 1장에 파이프라인을 돌려 지표에 누적한다.
pub fn run_frame(
    label: &FrameLabel,
    img: &RgbaImage,
    index: &PhashIndex,
    opts: &RunOpts,
    m: &mut Metrics,
) {
    let dopts = DetectOpts::default();
    let detected = detect_game_rect(img.as_raw(), img.width(), img.height(), &dopts);

    // Layer 0: game rect 검증
    if let Some(exp) = label.game_rect {
        m.gamerect_total += 1;
        let exp = GameRect::new(exp[0], exp[1], exp[2] as u32, exp[3] as u32);
        match detected {
            Some(gr) if rect_close(gr, exp, opts.gamerect_tol) => m.gamerect_within_tol += 1,
            other => m
                .failures
                .push(format!("[{}] game rect {other:?} != {exp:?}", label.path)),
        }
    }

    // Layer 2: 식별 검증 (검출된 game rect 기준으로 슬롯 크롭)
    let gr = detected.unwrap_or_else(|| GameRect::new(0, 0, img.width(), img.height()));
    for slot in &label.gifts {
        m.identify_total += 1;
        let nr = NormRect::from_array(slot.slot);
        let (x, y, w, h) = gr.norm_rect_to_px_clamped(&nr, img.width(), img.height());
        if w == 0 || h == 0 {
            m.failures.push(format!("[{}] 슬롯 크롭 0 크기", label.path));
            continue;
        }
        let crop = image::imageops::crop_imm(img, x, y, w, h).to_image();
        let canon = crate::center_crop_canon(&crop, opts.center_crop);
        let res = index.identify_canonical(&canon, 2, opts.ambiguity_margin, opts.max_dist);
        let top = &res.top[0];
        if res.rejected {
            // 미식별: 라벨이 있으므로 미탐(실패로 기록하되 오탐은 아님).
            m.failures
                .push(format!("[{}] {} 미식별(dist={})", label.path, slot.gift_id, top.dist));
        } else if top.gift_id == slot.gift_id {
            m.identify_correct += 1;
        } else {
            // 라벨과 다른 것을 confident 하게 식별 → 오탐.
            if !res.ambiguous {
                m.false_positives += 1;
            }
            m.failures.push(format!(
                "[{}] {} → {} (dist={}, ambiguous={})",
                label.path, slot.gift_id, top.gift_id, top.dist, res.ambiguous
            ));
        }
    }
}

/// 한 프레임을 Layer 1 화면 분류(region-pHash)해 `expected_screen` 라벨과 대조한다.
/// (계획서 M1) 라벨에 `expected_screen` 이 없으면 skip. config 의 지문이 이 프레임의
/// 캡처 환경에서 생성된 것이어야 의미 있다(실프레임/라벨 세트용).
pub fn run_frame_screen(
    label: &FrameLabel,
    img: &RgbaImage,
    config: &MatchingConfig,
    m: &mut Metrics,
) {
    let Some(expected) = label.expected_screen.as_deref() else {
        return;
    };
    let dopts = DetectOpts::default();
    let gr = detect_game_rect(img.as_raw(), img.width(), img.height(), &dopts)
        .unwrap_or_else(|| GameRect::new(0, 0, img.width(), img.height()));
    m.screen_total += 1;
    let res = crate::screen::classify(img, &gr, config);
    match res.screen_id.as_deref() {
        Some(got) if got == expected => m.screen_correct += 1,
        Some(got) => {
            m.screen_false_positives += 1;
            m.failures
                .push(format!("[{}] 화면 {expected} → {got} (오분류)", label.path));
        }
        None => m
            .failures
            .push(format!("[{}] 화면 {expected} → 미분류", label.path)),
    }
}

/// **config 기반 전체 파이프라인**을 라벨 프레임 1장에 돌린다 (Layer 0→1→2).
/// 저작 도구로 만든 `matching_config.json` + `templates.json` 을 실프레임에 적용해
/// 화면 분류·앵커 게이트·그리드 식별을 한 번에 검증한다. (M3 없이 데이터 검증 루프)
///
/// 정책(런타임과 동일한 end-to-end):
/// - 전환 프레임(`is_transition`): 화면 미상 또는 Layer 2 기각이면 정답.
/// - 비전환: 화면 분류를 `expected_screen` 과 대조 → 분류된(없으면 expected) 화면으로
///   `verify_and_identify`. 게이트 통과 시 그리드 결과를 라벨 기프트에 **공간 매칭**해 식별 평가.
pub fn run_frame_pipeline(
    label: &FrameLabel,
    img: &RgbaImage,
    config: &MatchingConfig,
    templates: &TemplateSet,
    index: &PhashIndex,
    opts: &RunOpts,
    m: &mut Metrics,
) {
    let dopts = DetectOpts::default();
    let gr = detect_game_rect(img.as_raw(), img.width(), img.height(), &dopts)
        .unwrap_or_else(|| GameRect::new(0, 0, img.width(), img.height()));

    // Layer 0: game rect 검증(라벨 있으면).
    if let Some(exp) = label.game_rect {
        m.gamerect_total += 1;
        let exp = GameRect::new(exp[0], exp[1], exp[2] as u32, exp[3] as u32);
        if rect_close(gr, exp, opts.gamerect_tol) {
            m.gamerect_within_tol += 1;
        } else {
            m.failures.push(format!("[{}] game rect {gr:?} != {exp:?}", label.path));
        }
    }

    let id_opts = IdentifyOpts {
        k: 2,
        ambiguity_margin: opts.ambiguity_margin,
        max_dist: opts.max_dist,
        center_crop: opts.center_crop,
    };

    // Layer 1: 화면 분류.
    let cls = classify(img, &gr, config).screen_id;

    // 전환 프레임: 미상 또는 Layer 2 기각이 정답.
    if label.is_transition {
        m.transition_total += 1;
        let rejected = match cls.as_deref() {
            None => true,
            Some(sid) => match config.screen(sid) {
                Some(sc) => matches!(
                    verify_and_identify(img, &gr, sc, templates, index, &id_opts),
                    FrameOutcome::Rejected(_)
                ),
                None => true,
            },
        };
        if rejected {
            m.transition_correctly_rejected += 1;
        } else {
            m.failures
                .push(format!("[{}] 전환 프레임 미기각(분류={:?})", label.path, cls));
        }
        return;
    }

    // 비전환: 화면 분류 정확도.
    if let Some(exp_screen) = label.expected_screen.as_deref() {
        m.screen_total += 1;
        match cls.as_deref() {
            Some(got) if got == exp_screen => m.screen_correct += 1,
            Some(got) => {
                m.screen_false_positives += 1;
                m.failures.push(format!("[{}] 화면 {exp_screen} → {got}", label.path));
            }
            None => m.failures.push(format!("[{}] 화면 {exp_screen} → 미분류", label.path)),
        }
    }

    // Layer 2: 분류된(없으면 expected) 화면의 앵커 게이트 + 그리드 식별.
    let Some(sid) = cls.as_deref().or(label.expected_screen.as_deref()) else {
        return;
    };
    let Some(sc) = config.screen(sid) else {
        return;
    };
    if sc.elements.is_empty() {
        return; // 식별할 요소 없는 화면(탐사/선택지 등)
    }

    match verify_and_identify(img, &gr, sc, templates, index, &id_opts) {
        FrameOutcome::Rejected(why) => {
            m.gate_rejected_frames += 1;
            if !label.gifts.is_empty() {
                // 기프트가 있어야 할 프레임이 기각됨 → 미탐.
                m.failures.push(format!("[{}] 게이트 기각: {why}", label.path));
            }
        }
        FrameOutcome::Identified(results) => {
            // 라벨 기프트 → 그리드 결과 슬롯 공간 매칭.
            for gl in &label.gifts {
                m.identify_total += 1;
                let lc = rect_center(gl.slot);
                match results.iter().find(|r| center_in(lc, &r.slot)) {
                    Some(r) if r.ident.rejected => m
                        .failures
                        .push(format!("[{}] {} 미식별(dist={})", label.path, gl.gift_id, r.ident.top[0].dist)),
                    Some(r) if r.ident.top[0].gift_id == gl.gift_id => m.identify_correct += 1,
                    Some(r) => {
                        if !r.ident.ambiguous {
                            m.false_positives += 1;
                        }
                        m.failures.push(format!(
                            "[{}] {} → {} (dist={}, ambiguous={})",
                            label.path, gl.gift_id, r.ident.top[0].gift_id, r.ident.top[0].dist, r.ident.ambiguous
                        ));
                    }
                    None => m.failures.push(format!(
                        "[{}] {} 슬롯에 매칭 그리드 칸 없음 — config 그리드 좌표 확인",
                        label.path, gl.gift_id
                    )),
                }
            }
            // 빈 칸에 confident 식별 = 오탐.
            for r in &results {
                let rc = NormPoint {
                    x: r.slot.x + r.slot.w / 2.0,
                    y: r.slot.y + r.slot.h / 2.0,
                };
                let covers = label
                    .gifts
                    .iter()
                    .any(|gl| center_in(rc, &NormRect::from_array(gl.slot)));
                if !covers && !r.ident.rejected && !r.ident.ambiguous {
                    m.false_positives += 1;
                    m.failures.push(format!(
                        "[{}] 빈 칸 오탐 → {} (dist={})",
                        label.path, r.ident.top[0].gift_id, r.ident.top[0].dist
                    ));
                }
            }
        }
    }
}

/// `[x,y,w,h]` 정규화 사각형의 중심.
fn rect_center(r: [f32; 4]) -> NormPoint {
    NormPoint {
        x: r[0] + r[2] / 2.0,
        y: r[1] + r[3] / 2.0,
    }
}

/// 점이 사각형 안에 있는지.
fn center_in(p: NormPoint, r: &NormRect) -> bool {
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

fn rect_close(a: GameRect, b: GameRect, tol: i32) -> bool {
    (a.x - b.x).abs() <= tol
        && (a.y - b.y).abs() <= tol
        && (a.w as i32 - b.w as i32).abs() <= tol
        && (a.h as i32 - b.h as i32).abs() <= tol
}

// ---------------------------------------------------------------------------
// 합성 시드: 실프레임 수집 전에도 하니스를 가동·CI 검증하기 위한 라벨된 프레임 생성.
// 레터박스/필러박스 캔버스에 기프트 아이콘을 격자로 배치해 game rect + 식별을 모두 검증.
// ---------------------------------------------------------------------------

/// 합성 프레임 1장 + 라벨 생성.
///
/// `frame_w/h` 캔버스에 `game_rect` 영역을 회색으로 채우고(나머지는 검은 띠),
/// 그 안에 `icons`(=(gift_id, RgbaImage))를 5열 격자로 배치한다.
pub fn synth_frame(
    tag: &str,
    frame_w: u32,
    frame_h: u32,
    game_rect: GameRect,
    icons: &[(String, RgbaImage)],
) -> (FrameLabel, RgbaImage) {
    let mut canvas = RgbaImage::from_pixel(frame_w, frame_h, image::Rgba([0, 0, 0, 255]));
    // game rect 영역 배경(어둡지 않은 회색 — 검은 띠와 구분).
    for yy in 0..game_rect.h {
        for xx in 0..game_rect.w {
            let px = game_rect.x as u32 + xx;
            let py = game_rect.y as u32 + yy;
            if px < frame_w && py < frame_h {
                canvas.put_pixel(px, py, image::Rgba([60, 62, 64, 255]));
            }
        }
    }

    // 5열 격자. 셀은 픽셀상 정사각(16:9 game rect 기준 cell_h=cell_w*16/9).
    // 아이콘은 **원본 종횡비를 보존**해 셀에 맞춘다(인덱스가 원본→128² 한 번만 squash
    // 하므로, 합성도 한 번만 squash 되도록 네이티브 비율로 렌더해야 충실). 슬롯 라벨 =
    // 렌더된 아이콘의 실제 경계.
    let cols = 5u32;
    let cell_w = 0.09f32;
    let cell_h = cell_w * 16.0 / 9.0; // 0.16, 픽셀 정사각
    let origin_x = 0.235f32;
    let origin_y = 0.30f32;
    let icon_frac = 0.80f32; // 셀 안에서 아이콘 최대 변 비율

    let gw = game_rect.w as f32;
    let gh = game_rect.h as f32;
    let cell_px = cell_w * gw; // 정사각 셀 한 변(px)
    let target = (cell_px * icon_frac).max(1.0); // 아이콘 최대 변(px)

    let mut gifts = Vec::new();
    for (i, (gift_id, icon)) in icons.iter().enumerate() {
        let c = (i as u32) % cols;
        let r = (i as u32) / cols;
        let cell_x_px = game_rect.x as f32 + (origin_x + c as f32 * cell_w) * gw;
        let cell_y_px = game_rect.y as f32 + (origin_y + r as f32 * cell_h) * gh;

        // 원본 종횡비 유지하며 셀에 맞춤.
        let (ow, oh) = (icon.width() as f32, icon.height() as f32);
        let scale = target / ow.max(oh);
        let iw = ((ow * scale).round() as u32).max(1);
        let ih = ((oh * scale).round() as u32).max(1);
        let resized =
            image::imageops::resize(icon, iw, ih, image::imageops::FilterType::Lanczos3);

        // 셀 중앙 정렬.
        let ox = (cell_x_px + (cell_px - iw as f32) / 2.0).round() as i64;
        let oy = (cell_y_px + (cell_px - ih as f32) / 2.0).round() as i64;

        // 슬롯 라벨 = 렌더된 아이콘 경계(정규화).
        let inx = (ox as f32 - game_rect.x as f32) / gw;
        let iny = (oy as f32 - game_rect.y as f32) / gh;
        gifts.push(GiftSlotLabel {
            gift_id: gift_id.clone(),
            slot: [inx, iny, iw as f32 / gw, ih as f32 / gh],
        });

        // 인덱스가 알파를 검정에 평탄화하므로, 슬롯을 검정으로 깔아 투명 영역을 일치시킨다.
        for yy in 0..ih {
            for xx in 0..iw {
                let cxp = ox + xx as i64;
                let cyp = oy + yy as i64;
                if cxp >= 0 && cyp >= 0 && (cxp as u32) < frame_w && (cyp as u32) < frame_h {
                    canvas.put_pixel(cxp as u32, cyp as u32, image::Rgba([0, 0, 0, 255]));
                }
            }
        }
        image::imageops::overlay(&mut canvas, &resized, ox, oy);
    }

    let label = FrameLabel {
        path: format!("synthetic://{tag}"),
        width: frame_w,
        height: frame_h,
        dpi: 96,
        resolution_tag: tag.to_string(),
        game_rect: Some([game_rect.x, game_rect.y, game_rect.w as i32, game_rect.h as i32]),
        expected_screen: Some("reward".into()),
        is_transition: false,
        gifts,
    };
    (label, canvas)
}
