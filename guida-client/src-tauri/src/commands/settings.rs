//! 앱 설정 및 디바이스 고유 UUID 관리 커맨드.
//!
//! 설정은 `user_settings.json`에 저장된다. 디바이스 UUID는 루트 추천 중복
//! 방지 및 "작성자 본인만 수정" 판정의 익명 키다.
//!
//! ## UUID 무결성 방어 (외부 변조 대응)
//! UUID 의 "진짜 값"은 평문 `user_settings.json` 이 아니라 **OS 보호 저장소**
//! (Windows 자격 증명 관리자 = DPAPI 로 사용자 계정에 묶여 암호화)에 보관한다.
//! 부팅 시:
//!  - 키체인 값이 진짜다. 평문 파일의 uuid 가 다르면(= 손으로 변조) 키체인
//!    값으로 **되돌려** 변조를 무력화한다.
//!  - 키체인이 비어있으면 기존 파일 uuid 를 1회 마이그레이션(없으면 신규 생성).
//!  - 키체인 백엔드를 못 쓰는 환경(타 플랫폼/테스트)에서는 파일-서명 기반
//!    무결성 검사로 폴백한다.

use super::fs::{read_data_file, write_data_file};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const SETTINGS_FILE: &str = "user_settings.json";

/// OS 키체인 식별자 (앱 번들 ID 기준).
const KEYRING_SERVICE: &str = "com.guida.app";
const KEYRING_USER: &str = "device_uuid";

/// 앱 내장 솔트. 진짜 비밀은 아니며, 키체인을 못 쓰는 폴백 경로에서 파일을
/// 손으로 고친 "외부 변조"를 탐지하기 위한 best-effort 무결성 토큰 계산용이다.
const UUID_INTEGRITY_SALT: &str = "guida.v1.device-uuid.integrity";

/// UUID 무결성 서명(결정적). 외부에서 uuid 값만 바꾸면 이 서명과 어긋난다.
/// `DefaultHasher::new()` 는 고정 키로 생성되어 실행 간 결과가 동일하다.
fn sign_uuid(uuid: &str) -> String {
    let mut hasher = DefaultHasher::new();
    UUID_INTEGRITY_SALT.hash(&mut hasher);
    "|".hash(&mut hasher);
    uuid.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// OS 키체인 조회 결과.
enum KeychainState {
    /// 보호 저장소에 유효한 uuid 가 있음 (진짜 값).
    Found(String),
    /// 백엔드는 동작하나 항목이 비어있음 (최초 실행/마이그레이션 대상).
    Empty,
    /// 키체인 백엔드를 쓸 수 없음 → 파일-서명 폴백.
    Unavailable,
}

/// OS 보호 저장소에서 uuid 를 읽는다.
fn keychain_read() -> KeychainState {
    let entry = match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(e) => e,
        Err(_) => return KeychainState::Unavailable,
    };
    match entry.get_password() {
        Ok(s) if !s.trim().is_empty() => KeychainState::Found(s),
        Ok(_) => KeychainState::Empty,
        Err(keyring::Error::NoEntry) => KeychainState::Empty,
        Err(_) => KeychainState::Unavailable,
    }
}

/// OS 보호 저장소에 uuid 를 기록한다 (best-effort).
fn keychain_write(uuid: &str) -> bool {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => entry.set_password(uuid).is_ok(),
        Err(_) => false,
    }
}

/// 설정 JSON 의 uuid/uuid_sig 를 주어진 값으로 맞춰 파일에 기록한다.
fn write_settings_uuid(
    app: &tauri::AppHandle,
    settings: &mut Value,
    uuid: &str,
) -> Result<(), String> {
    if let Value::Object(map) = settings {
        map.insert("uuid".into(), Value::String(uuid.to_string()));
        map.insert("uuid_sig".into(), Value::String(sign_uuid(uuid)));
    }
    let serialized =
        serde_json::to_string_pretty(settings).map_err(|e| format!("설정 직렬화 실패: {e}"))?;
    write_data_file(app.clone(), SETTINGS_FILE.into(), serialized)
}

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

/// 디바이스 UUID를 보장한다. OS 보호 저장소를 진짜 값의 권위로 삼아 평문
/// 파일 변조를 무력화하고, 키체인을 못 쓰는 환경에서는 파일-서명 무결성
/// 검사로 폴백한다. (자세한 정책은 파일 상단 모듈 주석 참고)
#[tauri::command]
pub fn ensure_device_uuid(app: tauri::AppHandle) -> Result<String, String> {
    let existing = read_data_file(app.clone(), SETTINGS_FILE.into())?;

    let mut settings: Value = match existing {
        Some(raw) if !raw.trim().is_empty() => {
            serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))
        }
        _ => Value::Object(Default::default()),
    };

    let file_uuid = settings
        .get("uuid")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    match keychain_read() {
        // 키체인 값이 진짜다. 파일이 어긋나면 되돌린다(변조 무력화).
        KeychainState::Found(uuid) => {
            let expected_sig = sign_uuid(&uuid);
            let file_sig = settings.get("uuid_sig").and_then(|v| v.as_str());
            let in_sync =
                file_uuid.as_deref() == Some(uuid.as_str()) && file_sig == Some(expected_sig.as_str());
            if !in_sync {
                write_settings_uuid(&app, &mut settings, &uuid)?;
            }
            Ok(uuid)
        }

        // 키체인 비어있음: 기존 파일 uuid 마이그레이션 or 신규 발급 후 키체인 보관.
        KeychainState::Empty => {
            let uuid = file_uuid.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            keychain_write(&uuid);
            write_settings_uuid(&app, &mut settings, &uuid)?;
            Ok(uuid)
        }

        // 폴백: 파일-서명 기반 무결성 검사 (키체인 미지원 환경).
        KeychainState::Unavailable => ensure_uuid_file_only(app, settings, file_uuid),
    }
}

/// 키체인을 못 쓰는 환경용 폴백: `user_settings.json` 의 uuid + uuid_sig 만으로
/// 무결성을 검사한다. 서명 불일치 시 변조로 보고 재발급, 서명 부재 시(레거시)
/// 기존 UUID 채택 후 서명만 기록한다.
fn ensure_uuid_file_only(
    app: tauri::AppHandle,
    mut settings: Value,
    file_uuid: Option<String>,
) -> Result<String, String> {
    if let Some(uuid) = file_uuid {
        let expected = sign_uuid(&uuid);
        let stored_sig = settings
            .get("uuid_sig")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        match stored_sig {
            // 서명 일치 → 정상
            Some(sig) if sig == expected => return Ok(uuid),
            // 레거시(서명 없음) → 기존 UUID 채택 후 서명 기록(마이그레이션)
            None => {
                write_settings_uuid(&app, &mut settings, &uuid)?;
                return Ok(uuid);
            }
            // 서명 불일치 → 외부 변조로 판단 → 아래에서 UUID 재발급
            _ => {}
        }
    }

    let new_uuid = uuid::Uuid::new_v4().to_string();
    write_settings_uuid(&app, &mut settings, &new_uuid)?;
    Ok(new_uuid)
}
