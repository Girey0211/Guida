//! 앱 설정 및 디바이스 고유 UUID 관리 커맨드.
//!
//! 설정은 `user_settings.json`에 저장된다. 최초 실행 시 디바이스 UUID를
//! 생성하여 영구 보관하며, 이는 루트 추천 중복 방지의 기준이 된다.

use super::fs::{read_data_file, write_data_file};
use serde_json::Value;

const SETTINGS_FILE: &str = "user_settings.json";

/// 저장된 설정 JSON 문자열을 반환한다. 없으면 `None`.
#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_data_file(app, SETTINGS_FILE.into())
}

/// 설정 JSON 문자열을 저장한다.
#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, content: String) -> Result<(), String> {
    write_data_file(app, SETTINGS_FILE.into(), content)
}

/// 디바이스 UUID를 보장한다. 설정 파일에 이미 있으면 그대로 반환하고,
/// 없으면 새로 생성하여 설정에 병합 저장 후 반환한다.
#[tauri::command]
pub fn ensure_device_uuid(app: tauri::AppHandle) -> Result<String, String> {
    let existing = read_data_file(app.clone(), SETTINGS_FILE.into())?;

    let mut settings: Value = match existing {
        Some(raw) if !raw.trim().is_empty() => {
            serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))
        }
        _ => Value::Object(Default::default()),
    };

    if let Some(uuid) = settings.get("uuid").and_then(|v| v.as_str()) {
        if !uuid.is_empty() {
            return Ok(uuid.to_string());
        }
    }

    let new_uuid = uuid::Uuid::new_v4().to_string();
    if let Value::Object(map) = &mut settings {
        map.insert("uuid".into(), Value::String(new_uuid.clone()));
    }

    let serialized =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("설정 직렬화 실패: {e}"))?;
    write_data_file(app, SETTINGS_FILE.into(), serialized)?;

    Ok(new_uuid)
}
