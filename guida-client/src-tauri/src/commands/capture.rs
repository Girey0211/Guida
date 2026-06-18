//! 캡처 시작/정지 커맨드 + game rect 정규화 루프. (계획서 §2 commands/capture.rs, M0)
//!
//! FE→Rust: `start_capture` / `stop_capture` (invoke).
//! Rust→FE: `capture://game-rect` 이벤트(emit)로 매 프레임 정규화 결과 전달.
//!
//! 루프는 3~4fps throttle 로 WGC 프레임을 받아 matching-core 의 game rect 검출을
//! 돌리고 결과를 emit 한다. 이후 마일스톤(M1~)에서 같은 루프에 화면/요소 인식을 얹는다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager};

/// 캡처 루프 실행 상태(앱 전역 1개).
#[derive(Default)]
pub struct CaptureState {
    running: Arc<AtomicBool>,
}

/// game rect 검출 결과 이벤트 페이로드.
#[derive(Serialize, Clone)]
pub struct GameRectEvent {
    /// 검출 성공 여부.
    pub detected: bool,
    /// 캡처 프레임 크기.
    pub frame_w: u32,
    pub frame_h: u32,
    // game rect (검출 실패 시 0).
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// 캡처 throttle 주기(ms). ~3.5fps. (계획서 M0: 3~4fps)
const THROTTLE_MS: u64 = 280;

#[cfg(windows)]
#[tauri::command]
pub fn start_capture(app: tauri::AppHandle) -> Result<(), String> {
    use crate::capture::frame::FrameSource;
    use crate::capture::{hwnd, wgc};

    let state = app.state::<CaptureState>();
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("이미 캡처 중입니다.".into());
    }
    let running = state.running.clone();

    // 게임 창 탐색(메인 스레드에서). HWND 자체는 Send 가 아니므로 isize 로 넘긴다.
    let hwnd = hwnd::find_game_window().ok_or_else(|| {
        running.store(false, Ordering::SeqCst);
        "게임 창을 찾지 못했습니다. 게임을 borderless 로 실행해 주세요.".to_string()
    })?;
    let hwnd_raw = hwnd.0 as isize;

    std::thread::spawn(move || {
        // 캡처 스레드는 WinRT/COM MTA 로 초기화.
        unsafe {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let hwnd = windows::Win32::Foundation::HWND(hwnd_raw as *mut _);
        let mut cap = match wgc::WgcCapture::new(hwnd) {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("capture://error", e);
                running.store(false, Ordering::SeqCst);
                return;
            }
        };

        while running.load(Ordering::SeqCst) {
            match cap.next_frame() {
                Ok(Some(frame)) => {
                    let ev = detect_and_build(&frame);
                    let _ = app.emit("capture://game-rect", ev);
                }
                Ok(None) => {}
                Err(e) => {
                    let _ = app.emit("capture://error", e);
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(THROTTLE_MS));
        }
        cap.stop();
        running.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// 한 프레임에 game rect 검출을 돌려 이벤트 페이로드로 만든다.
#[cfg(windows)]
fn detect_and_build(frame: &crate::capture::frame::Frame) -> GameRectEvent {
    use matching_core::normalize::{detect_game_rect, DetectOpts};
    match detect_game_rect(&frame.rgba, frame.width, frame.height, &DetectOpts::default()) {
        Some(gr) => GameRectEvent {
            detected: true,
            frame_w: frame.width,
            frame_h: frame.height,
            x: gr.x,
            y: gr.y,
            w: gr.w,
            h: gr.h,
        },
        None => GameRectEvent {
            detected: false,
            frame_w: frame.width,
            frame_h: frame.height,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
        },
    }
}

#[tauri::command]
pub fn stop_capture(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<CaptureState>();
    state.running.store(false, Ordering::SeqCst);
    Ok(())
}

/// 게임 창이 현재 떠 있는지(설정 UX 용).
#[cfg(windows)]
#[tauri::command]
pub fn is_game_window_present() -> bool {
    crate::capture::hwnd::find_game_window().is_some()
}

// --- 비 windows 빌드용 스텁(컴파일 호환) ---
#[cfg(not(windows))]
#[tauri::command]
pub fn start_capture(_app: tauri::AppHandle) -> Result<(), String> {
    Err("이 플랫폼은 화면 캡처를 지원하지 않습니다.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn is_game_window_present() -> bool {
    false
}
