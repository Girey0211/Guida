mod commands;
mod utils;

use commands::{fs as gfs, settings, crypto};

use tauri::{Manager, Emitter};

/// Tauri 앱 진입점. JS에서 호출 가능한 IPC 커맨드를 등록한다.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        // 앱 자동 업데이트(서명 검증 후 설치) + 설치 후 재시작.
        // 데스크톱 전용 플러그인이라 desktop 빌드에서만 등록한다.
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _shortcut, event| {
                            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                                if let Some(overlay) = app.get_webview_window("overlay") {
                                    if let Ok(true) = overlay.is_visible() {
                                        let _ = app.emit("toggle-overlay-click-through", ());
                                    }
                                }
                            }
                        })
                        .build(),
                )?;

                // Try to register the global shortcut 'F9' gracefully.
                // If it fails (e.g., another application already registered it), we log the error but don't crash.
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
                if let Ok(shortcut) = "f9".parse::<Shortcut>() {
                    if let Err(e) = app.global_shortcut().register(shortcut) {
                        eprintln!("Failed to register global shortcut F9: {}", e);
                    }
                }
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 파일 시스템: %APPDATA%/Local/Guida/ 하위 JSON 읽기/쓰기
            gfs::read_data_file,
            gfs::write_data_file,
            gfs::data_dir_path,
            gfs::append_log_file,
            gfs::open_log_dir,
            // 설정 및 디바이스 UUID 관리
            settings::load_settings,
            settings::save_settings,
            settings::ensure_device_uuid,
            settings::reset_device_uuid,
            settings::restore_device_uuid,
            settings::commit_key_migration,
            settings::abort_key_migration,
            // 암호화 및 서명
            crypto::get_device_keys,
            crypto::sign_api_request,
            crypto::encrypt_backup,
            crypto::decrypt_backup,
            crypto::begin_key_migration,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Guida application");
}
