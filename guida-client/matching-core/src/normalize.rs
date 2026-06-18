//! Layer 0 정규화 — 캡처 프레임에서 **game rect 확정**.
//!
//! 캡처한 게임 창은 게임 종횡비(16:9)와 창 종횡비가 다르면 가장자리에 검은 띠
//! (레터박스=상하, 필러박스=좌우)가 생긴다. 이 모듈은 그 검은 띠를 스캔해 실제
//! 콘텐츠 사각형(game rect)을 찾고, 기대 종횡비로 보정한다. (계획서 M0)
//!
//! 순수 함수(게임/WGC 비의존) — raw RGBA 프레임만 받는다. 따라서 합성 프레임으로
//! 모든 해상도/창모드를 오프라인 검증할 수 있다.

use crate::geometry::GameRect;

/// game rect 검출 옵션.
#[derive(Debug, Clone, Copy)]
pub struct DetectOpts {
    /// 픽셀이 "검은 띠"로 간주되는 밝기 상한 (max(r,g,b) ≤ 이 값).
    pub dark_thresh: u8,
    /// 한 행/열이 "띠"로 판정되려면 이 비율 이상이 어두워야 한다 (0~1).
    pub bar_frac: f32,
    /// 기대 종횡비(w/h). 지정 시 검출 사각형을 이 비율로 스냅(중앙 정렬)해 ±몇 px 오차 흡수.
    pub expected_aspect: Option<f32>,
}

impl Default for DetectOpts {
    fn default() -> Self {
        Self {
            dark_thresh: 16,
            bar_frac: 0.995,
            expected_aspect: Some(16.0 / 9.0),
        }
    }
}

#[inline]
fn is_dark(px: &[u8], thresh: u8) -> bool {
    // RGBA. 알파는 무시(불투명 캡처 가정), RGB 최댓값으로 판정.
    px[0].max(px[1]).max(px[2]) <= thresh
}

/// 한 행 전체가 검은 띠인지.
fn row_is_bar(rgba: &[u8], w: u32, y: u32, x0: u32, x1: u32, o: &DetectOpts) -> bool {
    let mut dark = 0u32;
    let mut total = 0u32;
    let row = (y * w * 4) as usize;
    for x in x0..x1 {
        let i = row + (x * 4) as usize;
        if is_dark(&rgba[i..i + 4], o.dark_thresh) {
            dark += 1;
        }
        total += 1;
    }
    total > 0 && (dark as f32 / total as f32) >= o.bar_frac
}

/// 한 열 전체가 검은 띠인지.
fn col_is_bar(rgba: &[u8], w: u32, x: u32, y0: u32, y1: u32, o: &DetectOpts) -> bool {
    let mut dark = 0u32;
    let mut total = 0u32;
    for y in y0..y1 {
        let i = ((y * w + x) * 4) as usize;
        if is_dark(&rgba[i..i + 4], o.dark_thresh) {
            dark += 1;
        }
        total += 1;
    }
    total > 0 && (dark as f32 / total as f32) >= o.bar_frac
}

/// 캡처 프레임(raw RGBA8, w×h)에서 game rect를 검출한다.
///
/// 1) 상/하 레터박스, 좌/우 필러박스를 스캔해 콘텐츠 외곽을 찾고
/// 2) `expected_aspect` 지정 시 그 종횡비의 최대 사각형을 외곽 안에 중앙 정렬로 스냅한다.
///
/// 콘텐츠가 전혀 없으면(전부 검정) `None`.
pub fn detect_game_rect(rgba: &[u8], w: u32, h: u32, o: &DetectOpts) -> Option<GameRect> {
    if w == 0 || h == 0 || rgba.len() < (w * h * 4) as usize {
        return None;
    }

    // 1) 상하 레터박스 스캔 (전체 폭 기준)
    let mut top = 0u32;
    while top < h && row_is_bar(rgba, w, top, 0, w, o) {
        top += 1;
    }
    if top >= h {
        return None; // 전부 검정
    }
    let mut bottom = h - 1;
    while bottom > top && row_is_bar(rgba, w, bottom, 0, w, o) {
        bottom -= 1;
    }

    // 2) 좌우 필러박스 스캔 (검출된 세로 구간 기준)
    let mut left = 0u32;
    while left < w && col_is_bar(rgba, w, left, top, bottom + 1, o) {
        left += 1;
    }
    if left >= w {
        return None;
    }
    let mut right = w - 1;
    while right > left && col_is_bar(rgba, w, right, top, bottom + 1, o) {
        right -= 1;
    }

    let cx = left as i32;
    let cy = top as i32;
    let cw = right - left + 1;
    let ch = bottom - top + 1;

    match o.expected_aspect {
        Some(aspect) => Some(snap_to_aspect(cx, cy, cw, ch, aspect)),
        None => Some(GameRect::new(cx, cy, cw, ch)),
    }
}

/// 외곽 사각형 안에 주어진 종횡비의 최대 사각형을 중앙 정렬로 맞춘다.
/// 스캔이 안티앨리어싱/미세 띠로 몇 px 어긋나도 종횡비로 보정해 일관성을 확보.
fn snap_to_aspect(x: i32, y: i32, w: u32, h: u32, aspect: f32) -> GameRect {
    let cur = w as f32 / h as f32;
    if cur > aspect {
        // 너무 넓음 → 너비를 줄여 높이에 맞춤
        let nw = (h as f32 * aspect).round() as u32;
        let nx = x + ((w - nw) / 2) as i32;
        GameRect::new(nx, y, nw, h)
    } else {
        // 너무 높음 → 높이를 줄여 너비에 맞춤
        let nh = (w as f32 / aspect).round() as u32;
        let ny = y + ((h - nh) / 2) as i32;
        GameRect::new(x, ny, w, nh)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::GameRect;

    /// w×h 검은 프레임에 (gx,gy,gw,gh) 위치에 회색 콘텐츠를 채운 합성 프레임 생성.
    fn synth(w: u32, h: u32, g: GameRect) -> Vec<u8> {
        let mut buf = vec![0u8; (w * h * 4) as usize];
        for yy in 0..g.h {
            for xx in 0..g.w {
                let px = (g.x as u32 + xx).min(w - 1);
                let py = (g.y as u32 + yy).min(h - 1);
                let i = ((py * w + px) * 4) as usize;
                buf[i] = 128;
                buf[i + 1] = 130;
                buf[i + 2] = 127;
                buf[i + 3] = 255;
            }
        }
        buf
    }

    fn assert_close(got: GameRect, exp: GameRect, tol: i32) {
        let d = |a: i32, b: i32| (a - b).abs();
        assert!(
            d(got.x, exp.x) <= tol
                && d(got.y, exp.y) <= tol
                && d(got.w as i32, exp.w as i32) <= tol
                && d(got.h as i32, exp.h as i32) <= tol,
            "got {got:?} exp {exp:?} tol {tol}"
        );
    }

    const TOL: i32 = 2; // 완료 기준: ±2px

    #[test]
    fn fullscreen_1080p_exact_16_9() {
        // 16:9 모니터 풀스크린 → 띠 없음, 전체가 game rect.
        let exp = GameRect::new(0, 0, 1920, 1080);
        let buf = synth(1920, 1080, exp);
        let gr = detect_game_rect(&buf, 1920, 1080, &DetectOpts::default()).unwrap();
        assert_close(gr, exp, TOL);
    }

    #[test]
    fn fullscreen_1440p() {
        let exp = GameRect::new(0, 0, 2560, 1440);
        let buf = synth(2560, 1440, exp);
        let gr = detect_game_rect(&buf, 2560, 1440, &DetectOpts::default()).unwrap();
        assert_close(gr, exp, TOL);
    }

    #[test]
    fn fullscreen_4k() {
        let exp = GameRect::new(0, 0, 3840, 2160);
        let buf = synth(3840, 2160, exp);
        let gr = detect_game_rect(&buf, 3840, 2160, &DetectOpts::default()).unwrap();
        assert_close(gr, exp, TOL);
    }

    #[test]
    fn ultrawide_21_9_pillarbox() {
        // 21:9(3440×1440) 모니터에 16:9 게임 → 좌우 필러박스.
        // 16:9 콘텐츠 높이 1440 → 너비 2560, 좌우 (3440-2560)/2=440 띠.
        let exp = GameRect::new(440, 0, 2560, 1440);
        let buf = synth(3440, 1440, exp);
        let gr = detect_game_rect(&buf, 3440, 1440, &DetectOpts::default()).unwrap();
        assert_close(gr, exp, TOL);
    }

    #[test]
    fn windowed_letterbox() {
        // 창모드: 창 클라이언트가 1600×1000 (16:10) → 16:9 게임은 상하 레터박스.
        // 너비 1600 → 16:9 높이 900, 상하 (1000-900)/2=50 띠.
        let exp = GameRect::new(0, 50, 1600, 900);
        let buf = synth(1600, 1000, exp);
        let gr = detect_game_rect(&buf, 1600, 1000, &DetectOpts::default()).unwrap();
        assert_close(gr, exp, TOL);
    }

    #[test]
    fn aspect_snap_corrects_few_px_noise() {
        // 콘텐츠 외곽이 종횡비에서 3px 어긋나도 스냅이 16:9로 보정.
        let buf = synth(1920, 1080, GameRect::new(0, 0, 1920, 1083.min(1080)));
        let gr = detect_game_rect(&buf, 1920, 1080, &DetectOpts::default()).unwrap();
        // 16:9로 스냅되었는지 (종횡비 오차 작음)
        assert!((gr.aspect() - 16.0 / 9.0).abs() < 0.01, "aspect {}", gr.aspect());
    }

    #[test]
    fn all_black_returns_none() {
        let buf = vec![0u8; 1920 * 1080 * 4];
        assert!(detect_game_rect(&buf, 1920, 1080, &DetectOpts::default()).is_none());
    }
}
