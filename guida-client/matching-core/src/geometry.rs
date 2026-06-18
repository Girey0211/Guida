//! Layer 0 지오메트리 — 정규화 좌표(0~1) ↔ 화면 픽셀 변환.
//!
//! 모든 매칭 좌표는 game rect 기준 **정규화(0~1)** 다(절대 픽셀 금지, 계획서 핵심원칙 #1).
//! game rect = 캡처 프레임 안에서 16:9 게임 콘텐츠가 실제로 그려진 픽셀 사각형
//! (레터박스/필러박스 검은 띠를 제외한 영역). 이 모듈은 그 사각형을 기준으로
//! 정규화↔픽셀 왕복 변환을 제공한다. (계획서 §2 utils/geometry.rs)

use serde::{Deserialize, Serialize};

/// 정규화 좌표 점 (game rect 기준, 0~1).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NormPoint {
    pub x: f32,
    pub y: f32,
}

/// 정규화 사각형 `[x, y, w, h]` (game rect 기준, 0~1). matching_config의 region 형식.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NormRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl NormRect {
    pub fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
    /// matching_config의 `[x,y,w,h]` 배열에서.
    pub fn from_array(a: [f32; 4]) -> Self {
        Self {
            x: a[0],
            y: a[1],
            w: a[2],
            h: a[3],
        }
    }
}

/// 캡처 프레임 안에서 게임 콘텐츠가 그려진 픽셀 사각형(= game rect).
/// 정규화 (0,0)=좌상단, (1,1)=우하단이 이 사각형의 모서리에 대응한다.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GameRect {
    /// 프레임 내 게임 콘텐츠 좌상단 x (픽셀).
    pub x: i32,
    /// 프레임 내 게임 콘텐츠 좌상단 y (픽셀).
    pub y: i32,
    /// 게임 콘텐츠 너비 (픽셀).
    pub w: u32,
    /// 게임 콘텐츠 높이 (픽셀).
    pub h: u32,
}

impl GameRect {
    pub fn new(x: i32, y: i32, w: u32, h: u32) -> Self {
        Self { x, y, w, h }
    }

    /// 종횡비 (w/h).
    pub fn aspect(&self) -> f32 {
        self.w as f32 / self.h as f32
    }

    /// 정규화 점 → 프레임 픽셀 좌표 (부동소수).
    pub fn norm_to_px(&self, n: NormPoint) -> (f32, f32) {
        (
            self.x as f32 + n.x * self.w as f32,
            self.y as f32 + n.y * self.h as f32,
        )
    }

    /// 프레임 픽셀 좌표 → 정규화 점.
    pub fn px_to_norm(&self, px: f32, py: f32) -> NormPoint {
        NormPoint {
            x: (px - self.x as f32) / self.w as f32,
            y: (py - self.y as f32) / self.h as f32,
        }
    }

    /// 정규화 사각형 → 프레임 픽셀 사각형 `(x, y, w, h)` (부동소수, 반올림 전).
    pub fn norm_rect_to_px(&self, r: &NormRect) -> (f32, f32, f32, f32) {
        let (x, y) = self.norm_to_px(NormPoint { x: r.x, y: r.y });
        (x, y, r.w * self.w as f32, r.h * self.h as f32)
    }

    /// 정규화 사각형 → 정수 픽셀 사각형 (크롭용, 반올림 + 프레임 클램프).
    pub fn norm_rect_to_px_clamped(
        &self,
        r: &NormRect,
        frame_w: u32,
        frame_h: u32,
    ) -> (u32, u32, u32, u32) {
        let (fx, fy, fw, fh) = self.norm_rect_to_px(r);
        let x0 = fx.round().clamp(0.0, frame_w as f32) as u32;
        let y0 = fy.round().clamp(0.0, frame_h as f32) as u32;
        let x1 = (fx + fw).round().clamp(0.0, frame_w as f32) as u32;
        let y1 = (fy + fh).round().clamp(0.0, frame_h as f32) as u32;
        (x0, y0, x1.saturating_sub(x0), y1.saturating_sub(y0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_norm_px() {
        // 4K 프레임에 21:9 모니터 → 16:9 게임이 필러박스로 들어간 상황 모사.
        let gr = GameRect::new(240, 0, 3360, 1890);
        for &(nx, ny) in &[(0.0, 0.0), (1.0, 1.0), (0.5, 0.5), (0.37, 0.82)] {
            let (px, py) = gr.norm_to_px(NormPoint { x: nx, y: ny });
            let back = gr.px_to_norm(px, py);
            assert!((back.x - nx).abs() < 1e-4, "x rt {nx} -> {}", back.x);
            assert!((back.y - ny).abs() < 1e-4, "y rt {ny} -> {}", back.y);
        }
    }

    #[test]
    fn roundtrip_sub_pixel() {
        // 정규화 좌표 왕복 변환 오차 1px 미만 (완료 기준).
        let gr = GameRect::new(0, 140, 2560, 1440);
        let r = NormRect::new(0.30, 0.35, 0.08, 0.10);
        let (fx, fy, fw, fh) = gr.norm_rect_to_px(&r);
        let n0 = gr.px_to_norm(fx, fy);
        let n1 = gr.px_to_norm(fx + fw, fy + fh);
        let (rx2, ry2, rw2, rh2) = gr.norm_rect_to_px(&NormRect::new(
            n0.x,
            n0.y,
            n1.x - n0.x,
            n1.y - n0.y,
        ));
        assert!((rx2 - fx).abs() < 1.0 && (ry2 - fy).abs() < 1.0);
        assert!((rw2 - fw).abs() < 1.0 && (rh2 - fh).abs() < 1.0);
    }
}
