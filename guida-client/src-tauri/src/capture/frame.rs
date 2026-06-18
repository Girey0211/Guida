//! 캡처 프레임 추상화 — 캡처 소스(WGC/합성)와 인식 파이프라인의 경계.
//!
//! 파이프라인은 `FrameSource` 만 알면 되므로, 실제 게임 없이 `SyntheticFrameSource`
//! 로 오프라인 검증이 가능하다(M0 game rect 검출 루프를 게임 없이 돌린다).

// SyntheticFrameSource/Frame::new 는 테스트·후속 마일스톤(M1~)에서 사용한다.
#![allow(dead_code)]

/// 한 캡처 프레임. 픽셀은 **RGBA8**(matching-core 정규화 입력과 동일 포맷).
/// WGC 원본은 BGRA 이므로 소스에서 RGBA 로 변환해 담는다.
#[derive(Clone)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// width*height*4 RGBA8.
    pub rgba: Vec<u8>,
}

impl Frame {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>) -> Self {
        debug_assert_eq!(rgba.len(), (width * height * 4) as usize);
        Self {
            width,
            height,
            rgba,
        }
    }

    /// BGRA(행 stride 포함) 버퍼에서 RGBA 프레임으로 변환.
    /// WGC 스테이징 텍스처는 행마다 `row_pitch` 바이트(≥ width*4)를 가질 수 있다.
    pub fn from_bgra_with_pitch(width: u32, height: u32, bgra: &[u8], row_pitch: usize) -> Self {
        let mut rgba = vec![0u8; (width * height * 4) as usize];
        let w = width as usize;
        for y in 0..height as usize {
            let src = y * row_pitch;
            let dst = y * w * 4;
            for x in 0..w {
                let s = src + x * 4;
                let d = dst + x * 4;
                // BGRA -> RGBA
                rgba[d] = bgra[s + 2];
                rgba[d + 1] = bgra[s + 1];
                rgba[d + 2] = bgra[s];
                rgba[d + 3] = bgra[s + 3];
            }
        }
        Self {
            width,
            height,
            rgba,
        }
    }
}

/// 캡처 소스 공통 인터페이스.
pub trait FrameSource: Send {
    /// 최신 프레임을 가져온다. 아직 새 프레임이 없으면 `Ok(None)`.
    fn next_frame(&mut self) -> Result<Option<Frame>, String>;
    /// 캡처 정지(리소스 해제).
    fn stop(&mut self);
}

/// 게임 없이 파이프라인을 검증하기 위한 합성 소스.
/// 미리 만든 RGBA 프레임들을 순환 반환한다.
pub struct SyntheticFrameSource {
    frames: Vec<Frame>,
    idx: usize,
}

impl SyntheticFrameSource {
    pub fn new(frames: Vec<Frame>) -> Self {
        Self { frames, idx: 0 }
    }
}

impl FrameSource for SyntheticFrameSource {
    fn next_frame(&mut self) -> Result<Option<Frame>, String> {
        if self.frames.is_empty() {
            return Ok(None);
        }
        let f = self.frames[self.idx % self.frames.len()].clone();
        self.idx += 1;
        Ok(Some(f))
    }
    fn stop(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgra_to_rgba_with_pitch() {
        // 2x1, row_pitch = 12 (패딩 4바이트). BGRA 픽셀 두 개.
        let bgra = vec![
            10, 20, 30, 40, // px0 B=10 G=20 R=30 A=40
            11, 21, 31, 41, // px1
            0, 0, 0, 0, // padding
        ];
        let f = Frame::from_bgra_with_pitch(2, 1, &bgra, 12);
        assert_eq!(&f.rgba[0..4], &[30, 20, 10, 40]); // RGBA px0
        assert_eq!(&f.rgba[4..8], &[31, 21, 11, 41]); // RGBA px1
    }

    #[test]
    fn synthetic_cycles() {
        let f = Frame::new(1, 1, vec![1, 2, 3, 4]);
        let mut s = SyntheticFrameSource::new(vec![f]);
        assert!(s.next_frame().unwrap().is_some());
        assert!(s.next_frame().unwrap().is_some()); // 순환
    }
}
