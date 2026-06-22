//! Layer 2 앵커 — 템플릿 매칭으로 고정 UI 요소 탐지 + 다중 앵커 교차검증 + 요소 식별.
//! (계획서 M2, §5)
//!
//! Layer 1(화면 확정) 이후 돈다. 흐름:
//!   1. [`match_anchor`]   : 화면 고유 앵커(헤더·프레임 모서리 등)를 좁은 search 윈도우에서
//!                           **정규화 상관계수(NCC)** 템플릿 매칭으로 탐지(스케일 인지)
//!   2. [`cross_check`]    : 2차 앵커의 예측 위치 vs 실제 검출 위치 일치 검증 →
//!                           어긋나면 프레임 **기각**(전환 중/팝업 프레임 배제)
//!   3. [`icon_grid_slots`]: 요소 그리드를 정규화 슬롯들로 전개
//!   4. [`verify_and_identify`]: 게이트 통과 시 각 슬롯을 크롭→식별([`crate::identify`] 재사용)
//!   5. [`disambiguate_ncc`]: top-1/top-2 모호 시 레퍼런스와 NCC 2차 판별 (계획서 §5.3.2 [4])
//!
//! 순수 코어(게임/캡처 비의존): raw RGBA 프레임 + 템플릿/인덱스만 받는다 → 합성으로
//! 오프라인 검증. 템플릿 이미지는 런타임이 번들/CDN에서 로드해 [`TemplateSet`]으로 공급한다.
//!
//! **NCC 직접 구현 이유:** imageproc(계획서 §1.1 후보)는 무겁다. Layer 0 가 스케일을
//! ±2px 로 정규화하므로 search 윈도우가 좁고 템플릿이 작아, 작업 해상도를 캡(48px)한
//! 단순 NCC 슬라이딩으로 충분하다. (image_hasher 를 무거운 대안 대신 택한 §3 기조와 동일)

use crate::config::{Anchor, Element, ScreenConfig};
use crate::geometry::{GameRect, NormPoint, NormRect};
use crate::identify::{Identification, PhashIndex};
use image::RgbaImage;
use std::collections::HashMap;

/// NCC 작업 해상도 상한(템플릿 최대 변 px). 비용을 묶고 스케일 강건성을 준다.
const NCC_WORK_MAX: u32 = 48;

/// 앵커 템플릿: 레퍼런스 이미지 + game rect 기준 정규화 footprint.
/// 런타임이 expected px 로 리사이즈해 매칭한다(스케일 정규화).
#[derive(Debug, Clone)]
pub struct Template {
    /// game rect 기준 정규화 폭/높이(앵커가 화면에서 차지하는 비율).
    pub norm_w: f32,
    pub norm_h: f32,
    pub image: RgbaImage,
}

impl Template {
    pub fn new(image: RgbaImage, norm_w: f32, norm_h: f32) -> Self {
        Self {
            norm_w,
            norm_h,
            image,
        }
    }
}

/// template_key → 템플릿. 런타임이 채워 [`match_anchor`]에 넘긴다.
pub type TemplateSet = HashMap<String, Template>;

/// 앵커 1개의 검출 결과.
#[derive(Debug, Clone)]
pub struct AnchorMatch {
    pub anchor_id: String,
    /// 검출된 앵커 중심의 정규화 좌표(game rect 기준).
    pub center: NormPoint,
    /// NCC 점수 [-1, 1]. 높을수록 일치.
    pub score: f32,
    /// `score >= anchor.match_threshold`.
    pub passed: bool,
}

/// RGBA → 그레이스케일 luma(f32) 벡터.
fn to_gray(img: &RgbaImage) -> Vec<f32> {
    img.pixels()
        .map(|p| 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32)
        .collect()
}

/// `[x,y,w,h]` 정규화 사각형의 중심.
fn region_center(r: [f32; 4]) -> NormPoint {
    NormPoint {
        x: r[0] + r[2] / 2.0,
        y: r[1] + r[3] / 2.0,
    }
}

/// 앵커 1개를 search 윈도우에서 NCC 템플릿 매칭한다.
///
/// 템플릿을 현재 game rect 기준 expected px 로 리사이즈하고(스케일 정규화), search
/// 윈도우를 같은 작업 배율로 줄여 슬라이딩 NCC 의 피크를 찾는다. 템플릿이 없거나
/// 윈도우가 템플릿보다 작으면 `None`.
pub fn match_anchor(
    frame: &RgbaImage,
    gr: &GameRect,
    anchor: &Anchor,
    templates: &TemplateSet,
) -> Option<AnchorMatch> {
    let t = templates.get(&anchor.template_key)?;

    // expected 템플릿 px (현재 해상도에서 앵커가 차지하는 크기).
    let tw = (t.norm_w * gr.w as f32).round().max(1.0) as u32;
    let th = (t.norm_h * gr.h as f32).round().max(1.0) as u32;

    // 작업 배율(템플릿 최대 변을 NCC_WORK_MAX 로 캡).
    let f = (NCC_WORK_MAX as f32 / tw.max(th) as f32).min(1.0);
    let tw_w = ((tw as f32 * f).round() as u32).max(1);
    let th_w = ((th as f32 * f).round() as u32).max(1);

    // search 윈도우 px(프레임 클램프).
    let (wx0, wy0, wpw, wph) =
        gr.norm_rect_to_px_clamped(&NormRect::from_array(anchor.search_region), frame.width(), frame.height());
    if wpw == 0 || wph == 0 {
        return None;
    }
    let ww_w = ((wpw as f32 * f).round() as u32).max(1);
    let wh_w = ((wph as f32 * f).round() as u32).max(1);
    if ww_w < tw_w || wh_w < th_w {
        return None; // 윈도우가 템플릿보다 작음
    }

    // 템플릿/윈도우를 작업 해상도로 리사이즈 → 그레이.
    let tmpl_img = image::imageops::resize(&t.image, tw_w, th_w, crate::CANON_FILTER);
    let tmpl = to_gray(&tmpl_img);
    let window_crop = image::imageops::crop_imm(frame, wx0, wy0, wpw, wph).to_image();
    let window_img = image::imageops::resize(&window_crop, ww_w, wh_w, crate::CANON_FILTER);
    let window = to_gray(&window_img);

    let (sx, sy, score) = ncc_slide(&window, ww_w, wh_w, &tmpl, tw_w, th_w);

    // 작업 좌표 → 원본 윈도우 px → 프레임 px → 정규화 중심.
    let px = wx0 as f32 + (sx as f32) / f + tw as f32 / 2.0;
    let py = wy0 as f32 + (sy as f32) / f + th as f32 / 2.0;
    let center = gr.px_to_norm(px, py);

    Some(AnchorMatch {
        anchor_id: anchor.anchor_id.clone(),
        center,
        score,
        passed: score >= anchor.match_threshold,
    })
}

/// 슬라이딩 NCC. 윈도우(ww×wh)에서 템플릿(tw×th)의 최고 정규화 상관 위치를 찾는다.
/// 반환: (best_x, best_y, best_score). 점수는 [-1,1].
fn ncc_slide(
    window: &[f32],
    ww: u32,
    wh: u32,
    tmpl: &[f32],
    tw: u32,
    th: u32,
) -> (u32, u32, f32) {
    let (ww, wh, tw, th) = (ww as usize, wh as usize, tw as usize, th as usize);
    let n = (tw * th) as f32;

    // 템플릿 평균·정규화 상수(1회).
    let tmean = tmpl.iter().sum::<f32>() / n;
    let mut tnorm = 0.0f32;
    for &v in tmpl {
        let d = v - tmean;
        tnorm += d * d;
    }
    let tnorm = tnorm.sqrt();

    let mut best = (0u32, 0u32, f32::MIN);
    if tnorm == 0.0 || ww < tw || wh < th {
        return (0, 0, 0.0);
    }

    for oy in 0..=(wh - th) {
        for ox in 0..=(ww - tw) {
            // 윈도우 패치 평균.
            let mut wsum = 0.0f32;
            for ty in 0..th {
                let row = (oy + ty) * ww + ox;
                for tx in 0..tw {
                    wsum += window[row + tx];
                }
            }
            let wmean = wsum / n;

            // 공분산·분산.
            let mut num = 0.0f32;
            let mut wvar = 0.0f32;
            for ty in 0..th {
                let wrow = (oy + ty) * ww + ox;
                let trow = ty * tw;
                for tx in 0..tw {
                    let wd = window[wrow + tx] - wmean;
                    let td = tmpl[trow + tx] - tmean;
                    num += wd * td;
                    wvar += wd * wd;
                }
            }
            let denom = wvar.sqrt() * tnorm;
            let score = if denom > 0.0 { num / denom } else { 0.0 };
            if score > best.2 {
                best = (ox as u32, oy as u32, score);
            }
        }
    }
    best
}

/// 화면의 모든 앵커를 매칭한다(검출된 것만, 순서 보존).
pub fn locate_anchors(
    frame: &RgbaImage,
    gr: &GameRect,
    screen: &ScreenConfig,
    templates: &TemplateSet,
) -> Vec<AnchorMatch> {
    screen
        .anchors
        .iter()
        .filter_map(|a| match_anchor(frame, gr, a, templates))
        .collect()
}

/// 교차검증 결과.
#[derive(Debug, Clone, PartialEq)]
pub enum CrossCheck {
    /// 검사 통과(또는 cross_check 미설정).
    Ok,
    /// 기각 사유.
    Rejected(String),
}

/// 다중 앵커 교차검증 (계획서 M2). `predict_from` 앵커에서 `verify` 앵커 위치를
/// **설계상 상대 오프셋**(config search_region 중심차)으로 예측하고, 실제 검출 위치와
/// 비교한다. 오차가 `max_error`(정규화) 초과면 기각 → 전환 중/팝업/오정렬 프레임 배제.
pub fn cross_check(
    screen: &ScreenConfig,
    matches: &[AnchorMatch],
    threshold_gate: bool,
) -> CrossCheck {
    // 우선 모든 앵커가 임계값 통과했는지(threshold_gate=true 일 때).
    if threshold_gate {
        for a in &screen.anchors {
            match matches.iter().find(|m| m.anchor_id == a.anchor_id) {
                Some(m) if m.passed => {}
                Some(m) => {
                    return CrossCheck::Rejected(format!(
                        "앵커 '{}' 신뢰도 미달(score={:.3} < {:.3})",
                        a.anchor_id, m.score, a.match_threshold
                    ))
                }
                None => {
                    return CrossCheck::Rejected(format!("앵커 '{}' 미검출", a.anchor_id))
                }
            }
        }
    }

    let Some(cc) = &screen.cross_check else {
        return CrossCheck::Ok; // 교차검증 미설정 → 통과
    };

    let find = |id: &str| matches.iter().find(|m| m.anchor_id == id);
    let cfg = |id: &str| screen.anchors.iter().find(|a| a.anchor_id == id);
    let (Some(p_m), Some(v_m)) = (find(&cc.predict_from), find(&cc.verify)) else {
        return CrossCheck::Rejected(format!(
            "교차검증 앵커 미검출(predict={}, verify={})",
            cc.predict_from, cc.verify
        ));
    };
    let (Some(p_c), Some(v_c)) = (cfg(&cc.predict_from), cfg(&cc.verify)) else {
        return CrossCheck::Rejected("교차검증 앵커 정의 없음".into());
    };

    // 설계상 상대 오프셋(정규화).
    let exp = region_center(v_c.search_region);
    let from = region_center(p_c.search_region);
    let off = NormPoint {
        x: exp.x - from.x,
        y: exp.y - from.y,
    };
    // 예측 = 검출된 predict_from + 설계 오프셋.
    let pred = NormPoint {
        x: p_m.center.x + off.x,
        y: p_m.center.y + off.y,
    };
    let err = ((pred.x - v_m.center.x).powi(2) + (pred.y - v_m.center.y).powi(2)).sqrt();
    if err <= cc.max_error {
        CrossCheck::Ok
    } else {
        CrossCheck::Rejected(format!(
            "교차검증 오차 {:.4} > max_error {:.4}",
            err, cc.max_error
        ))
    }
}

/// icon_grid 요소를 정규화 슬롯 사각형들로 전개한다(행 우선).
/// 필수 필드(origin/cell/cols/rows) 누락 시 빈 벡터.
pub fn icon_grid_slots(e: &Element) -> Vec<NormRect> {
    let (Some(origin), Some(cell), Some(cols), Some(rows)) = (e.origin, e.cell, e.cols, e.rows)
    else {
        return Vec::new();
    };
    let mut slots = Vec::with_capacity((cols * rows) as usize);
    for r in 0..rows {
        for c in 0..cols {
            slots.push(NormRect::new(
                origin[0] + c as f32 * cell[0],
                origin[1] + r as f32 * cell[1],
                cell[0],
                cell[1],
            ));
        }
    }
    slots
}

/// 식별 파라미터(요소 식별).
#[derive(Debug, Clone, Copy)]
pub struct IdentifyOpts {
    pub k: usize,
    pub ambiguity_margin: u32,
    pub max_dist: u32,
    pub center_crop: f32,
}

impl Default for IdentifyOpts {
    fn default() -> Self {
        Self {
            k: 2,
            ambiguity_margin: 18, // M-pre 도출
            max_dist: 180,
            center_crop: crate::DEFAULT_CENTER_CROP,
        }
    }
}

/// 슬롯 1개 식별 결과.
#[derive(Debug, Clone)]
pub struct SlotResult {
    pub slot: NormRect,
    pub ident: Identification,
}

/// 프레임 처리 결과.
#[derive(Debug, Clone)]
pub enum FrameOutcome {
    /// 게이트 기각(앵커 미달/교차검증 실패). 식별 미수행.
    Rejected(String),
    /// 게이트 통과 → 요소 슬롯별 식별 결과.
    Identified(Vec<SlotResult>),
}

/// Layer 2 오케스트레이션: 앵커 탐지 → 신뢰도/교차검증 AND 게이트 → 통과 시 요소 슬롯
/// 크롭·식별. 기각되면 식별을 돌리지 않는다(전환 중 프레임 100% 배제, 계획서 M2 완료기준).
pub fn verify_and_identify(
    frame: &RgbaImage,
    gr: &GameRect,
    screen: &ScreenConfig,
    templates: &TemplateSet,
    index: &PhashIndex,
    opts: &IdentifyOpts,
) -> FrameOutcome {
    // 앵커 탐지 + 게이트.
    let matches = locate_anchors(frame, gr, screen, templates);
    if let CrossCheck::Rejected(why) = cross_check(screen, &matches, true) {
        return FrameOutcome::Rejected(why);
    }

    // 요소 슬롯 식별.
    let mut results = Vec::new();
    for e in &screen.elements {
        if e.element_type != "icon_grid" {
            continue;
        }
        let cc = e.center_crop.unwrap_or(opts.center_crop);
        for slot in icon_grid_slots(e) {
            let (x, y, w, h) = gr.norm_rect_to_px_clamped(&slot, frame.width(), frame.height());
            if w == 0 || h == 0 {
                continue;
            }
            let crop = image::imageops::crop_imm(frame, x, y, w, h).to_image();
            let canon = crate::center_crop_canon(&crop, cc);
            let ident = index.identify_canonical(&canon, opts.k, opts.ambiguity_margin, opts.max_dist);
            results.push(SlotResult { slot, ident });
        }
    }
    FrameOutcome::Identified(results)
}

/// 모호 슬롯 2차 판별 (계획서 §5.3.2 [4] "모호 시 템플릿 2차").
/// 정규화된 128² 슬롯과 top-k 후보 레퍼런스(이미 128² 정규화) 간 NCC 를 비교해
/// 최고 상관 후보의 gift_id 를 고른다. pHash 가 흔들리는 배지/등급변형에 보강.
pub fn disambiguate_ncc(slot_canon: &RgbaImage, candidates: &[(String, RgbaImage)]) -> Option<String> {
    let s = to_gray(slot_canon);
    let n = s.len() as f32;
    if n == 0.0 {
        return None;
    }
    let smean = s.iter().sum::<f32>() / n;
    let mut snorm = 0.0f32;
    for &v in &s {
        snorm += (v - smean).powi(2);
    }
    let snorm = snorm.sqrt();
    if snorm == 0.0 {
        return None;
    }

    let mut best: Option<(String, f32)> = None;
    for (id, cand) in candidates {
        if cand.width() != slot_canon.width() || cand.height() != slot_canon.height() {
            continue;
        }
        let c = to_gray(cand);
        let cmean = c.iter().sum::<f32>() / n;
        let mut num = 0.0f32;
        let mut cvar = 0.0f32;
        for i in 0..c.len() {
            let cd = c[i] - cmean;
            num += (s[i] - smean) * cd;
            cvar += cd * cd;
        }
        let denom = snorm * cvar.sqrt();
        let score = if denom > 0.0 { num / denom } else { 0.0 };
        if best.as_ref().map_or(true, |(_, b)| score > *b) {
            best = Some((id.clone(), score));
        }
    }
    best.map(|(id, _)| id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::CrossCheck as CcCfg;

    fn mk_anchor(id: &str, key: &str, sr: [f32; 4]) -> Anchor {
        Anchor {
            anchor_id: id.into(),
            template_key: key.into(),
            search_region: sr,
            match_threshold: 0.7,
        }
    }

    fn am(id: &str, x: f32, y: f32, score: f32, passed: bool) -> AnchorMatch {
        AnchorMatch {
            anchor_id: id.into(),
            center: NormPoint { x, y },
            score,
            passed,
        }
    }

    fn screen_with_cc() -> ScreenConfig {
        ScreenConfig {
            screen_id: "reward".into(),
            name: "reward".into(),
            fingerprints: vec![],
            anchors: vec![
                mk_anchor("header", "h", [0.40, 0.04, 0.10, 0.06]), // 중심 (0.45,0.07)
                mk_anchor("corner", "c", [0.10, 0.80, 0.10, 0.10]), // 중심 (0.15,0.85)
            ],
            cross_check: Some(CcCfg {
                predict_from: "header".into(),
                verify: "corner".into(),
                max_error: 0.01,
            }),
            elements: vec![],
            transitions_allowed: vec![],
        }
    }

    #[test]
    fn cross_check_passes_when_aligned() {
        let s = screen_with_cc();
        // 검출이 설계 중심과 정확히 일치 → 오차 0.
        let matches = vec![
            am("header", 0.45, 0.07, 0.95, true),
            am("corner", 0.15, 0.85, 0.95, true),
        ];
        assert_eq!(cross_check(&s, &matches, true), CrossCheck::Ok);
    }

    #[test]
    fn cross_check_rejects_misaligned() {
        let s = screen_with_cc();
        // corner 가 설계 위치에서 크게 벗어남(전환 중 프레임 모사) → 기각.
        let matches = vec![
            am("header", 0.45, 0.07, 0.95, true),
            am("corner", 0.30, 0.85, 0.95, true),
        ];
        assert!(matches!(cross_check(&s, &matches, true), CrossCheck::Rejected(_)));
    }

    #[test]
    fn cross_check_rejects_low_confidence_anchor() {
        let s = screen_with_cc();
        let matches = vec![
            am("header", 0.45, 0.07, 0.50, false), // 임계값 미달
            am("corner", 0.15, 0.85, 0.95, true),
        ];
        assert!(matches!(cross_check(&s, &matches, true), CrossCheck::Rejected(_)));
    }

    #[test]
    fn icon_grid_expands_row_major() {
        let e = Element {
            element_id: "g".into(),
            element_type: "icon_grid".into(),
            origin: Some([0.30, 0.35]),
            cell: Some([0.08, 0.10]),
            cols: Some(5),
            rows: Some(2),
            center_crop: Some(1.0),
            r#match: Some("phash".into()),
            ambiguity_margin: Some(18),
        };
        let slots = icon_grid_slots(&e);
        assert_eq!(slots.len(), 10);
        assert_eq!(slots[0], NormRect::new(0.30, 0.35, 0.08, 0.10));
        // 두 번째 열.
        assert_eq!(slots[1], NormRect::new(0.38, 0.35, 0.08, 0.10));
        // 두 번째 행 첫 칸.
        assert_eq!(slots[5], NormRect::new(0.30, 0.45, 0.08, 0.10));
    }
}
