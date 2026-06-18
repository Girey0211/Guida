//! 게임 창 핸들(HWND)과 클라이언트 rect 추적. (계획서 §2 capture/hwnd.rs)
//!
//! - 제목 부분일치로 게임 창을 찾는다(기본: "Limbus").
//! - 클라이언트 영역의 화면 좌표 rect와 크기를 얻는다(오버레이 정합·캡처 영역 기준).
//! - DPI 를 얻는다(고DPI 환경 좌표 보정).
//!
//! 이 모듈은 WGC 와 독립적이며 windows 타깃에서만 빌드된다.

#![cfg(windows)]
// ClientRect/client_rect 는 M3 오버레이 정합(useOverlaySync)에서 사용 예정.
#![allow(dead_code)]

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, TRUE};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClientRect, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
};

/// 클라이언트 영역 정보(화면 좌표).
#[derive(Debug, Clone, Copy)]
pub struct ClientRect {
    /// 클라이언트 좌상단 화면 x.
    pub screen_x: i32,
    /// 클라이언트 좌상단 화면 y.
    pub screen_y: i32,
    pub width: u32,
    pub height: u32,
    /// 창 DPI(96=100%).
    pub dpi: u32,
}

struct FindCtx {
    needle_lower: String,
    found: Option<HWND>,
}

/// 제목에 `title_substring`(대소문자 무시)이 포함된 첫 가시 창을 찾는다.
pub fn find_window_by_title(title_substring: &str) -> Option<HWND> {
    let mut ctx = FindCtx {
        needle_lower: title_substring.to_lowercase(),
        found: None,
    };
    unsafe {
        let _ = EnumWindows(
            Some(enum_proc),
            LPARAM(&mut ctx as *mut FindCtx as isize),
        );
    }
    ctx.found
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut FindCtx);
    if !IsWindowVisible(hwnd).as_bool() {
        return TRUE; // 계속
    }
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return TRUE;
    }
    let mut buf = vec![0u16; (len + 1) as usize];
    let n = GetWindowTextW(hwnd, &mut buf);
    if n > 0 {
        let title = String::from_utf16_lossy(&buf[..n as usize]);
        if title.to_lowercase().contains(&ctx.needle_lower) {
            ctx.found = Some(hwnd);
            return BOOL(0); // 중단
        }
    }
    TRUE
}

/// 클라이언트 영역의 화면 좌표 rect + DPI 를 얻는다.
pub fn client_rect(hwnd: HWND) -> Result<ClientRect, String> {
    unsafe {
        let mut rc = RECT::default();
        GetClientRect(hwnd, &mut rc).map_err(|e| format!("GetClientRect 실패: {e}"))?;
        let width = (rc.right - rc.left).max(0) as u32;
        let height = (rc.bottom - rc.top).max(0) as u32;

        // 클라이언트 (0,0) 을 화면 좌표로 변환.
        let mut origin = POINT {
            x: rc.left,
            y: rc.top,
        };
        ClientToScreen(hwnd, &mut origin)
            .ok()
            .map_err(|e| format!("ClientToScreen 실패: {e}"))?;

        let dpi = GetDpiForWindow(hwnd);
        let dpi = if dpi == 0 { 96 } else { dpi };

        Ok(ClientRect {
            screen_x: origin.x,
            screen_y: origin.y,
            width,
            height,
            dpi,
        })
    }
}

/// 기본 게임 창 제목 후보.
pub const DEFAULT_GAME_TITLES: &[&str] = &["LimbusCompany", "Limbus Company", "Limbus"];

/// 기본 후보들로 게임 창을 찾는다.
pub fn find_game_window() -> Option<HWND> {
    for t in DEFAULT_GAME_TITLES {
        if let Some(h) = find_window_by_title(t) {
            return Some(h);
        }
    }
    None
}
