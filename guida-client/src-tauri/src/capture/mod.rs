//! Layer 0 캡처 — WGC 프레임 획득 + game rect 정규화의 입력단. (계획서 §2)
//!
//! - [`frame`]   : 프레임/소스 추상화(+ 합성 소스로 오프라인 검증)
//! - [`hwnd`]    : 게임 창 핸들·클라이언트 rect 추적 (windows 전용)
//! - [`wgc`]     : Windows Graphics Capture 세션 (windows 전용)

pub mod frame;

#[cfg(windows)]
pub mod hwnd;
#[cfg(windows)]
pub mod wgc;
