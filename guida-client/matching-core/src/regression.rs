//! 회귀 검증 세트 인프라. (계획서 §6)
//!
//! "어떻게 검증하느냐"의 답: 라벨된 프레임 세트에 전체 파이프라인(현재 Layer 0 game
//! rect + Layer 2 식별)을 돌려 지표(화면/식별 정확도·오탐)를 산출하고, 임계값 회귀를
//! CI에서 자동 검증한다. 실프레임 수집 전에도 **합성 프레임**으로 하니스를 가동한다.
//!
//! 목표 지표: 화면 ≥99% / 기프트 식별 ≥99% / 자동 반영 오탐 = 0.

use crate::geometry::{GameRect, NormRect};
use crate::identify::PhashIndex;
use crate::normalize::{detect_game_rect, DetectOpts};
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
    /// 화면 종류(M1). 현재 미사용이나 스키마에 포함.
    #[serde(default)]
    pub expected_screen: Option<String>,
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
    pub failures: Vec<String>,
}

impl Metrics {
    pub fn gamerect_pct(&self) -> f64 {
        pct(self.gamerect_within_tol, self.gamerect_total)
    }
    pub fn identify_pct(&self) -> f64 {
        pct(self.identify_correct, self.identify_total)
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
        gifts,
    };
    (label, canvas)
}
