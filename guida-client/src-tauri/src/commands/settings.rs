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
/// 키 이관(B-1) 준비 단계의 신규 uuid 임시 보관용. 시드를 JS 로 노출하지 않기 위함.
const KEYRING_USER_PENDING: &str = "device_uuid_pending";

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
    keychain_set(KEYRING_USER, uuid)
}

/// 임의 키체인 항목에 값을 기록한다 (best-effort).
fn keychain_set(user: &str, value: &str) -> bool {
    match keyring::Entry::new(KEYRING_SERVICE, user) {
        Ok(entry) => entry.set_password(value).is_ok(),
        Err(_) => false,
    }
}

/// 임의 키체인 항목을 읽는다. 비어있거나 백엔드 부재 시 None.
fn keychain_get(user: &str) -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user).ok()?;
    match entry.get_password() {
        Ok(s) if !s.trim().is_empty() => Some(s),
        _ => None,
    }
}

/// 임의 키체인 항목을 제거한다 (best-effort).
fn keychain_clear(user: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, user) {
        let _ = entry.delete_credential();
    }
}

/// 설정 JSON 의 uuid/uuid_sig 를 주어진 값으로 맞춰 파일에 기록한다.
/// ※ 키체인 폴백(미지원/보관 실패) 경로 전용. 키체인이 권위인 경우엔 호출하지 않으며,
///    설령 호출되어도 `write_data_file` 의 정규화가 uuid 를 제거한다.
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

/// 키체인이 권위(Found)면 평문 파일에 남은 raw uuid/uuid_sig 를 1회 제거한다(자가치유).
/// 실제 제거는 `write_data_file` 의 정규화(strip_uuid_for_persist)가 수행하므로,
/// 여기서는 비밀 필드가 있을 때만 재기록을 트리거한다.
fn scrub_file_uuid(app: &tauri::AppHandle, settings: &Value) -> Result<(), String> {
    let has_secret = settings.get("uuid").is_some() || settings.get("uuid_sig").is_some();
    if !has_secret {
        return Ok(());
    }
    let serialized =
        serde_json::to_string_pretty(settings).map_err(|e| format!("설정 직렬화 실패: {e}"))?;
    write_data_file(app.clone(), SETTINGS_FILE.into(), serialized)
}

/// 영구 저장용 설정 콘텐츠 정규화.
///   - 키체인이 권위(Found)면 평문 파일에 raw uuid/uuid_sig 를 남기지 않는다(C-2).
///   - 키체인 미지원/미보관 환경에서는 파일이 유일한 식별 소스이므로 그대로 둔다.
/// `fs::write_data_file` 가 `user_settings.json` 기록 직전 이 함수를 통과시킨다.
pub fn strip_uuid_for_persist(content: String) -> String {
    if !matches!(keychain_read(), KeychainState::Found(_)) {
        return content;
    }
    let mut value: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return content,
    };
    if let Value::Object(map) = &mut value {
        map.remove("uuid");
        map.remove("uuid_sig");
    }
    serde_json::to_string_pretty(&value).unwrap_or(content)
}

/// 저장된 설정 JSON 문자열을 반환한다. 없으면 `None`.
#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_data_file(app, SETTINGS_FILE.into())
}

/// 설정 JSON 문자열을 저장한다.
/// (raw uuid 정규화는 `write_data_file` 의 `strip_uuid_for_persist` 가 일괄 처리한다.)
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
        // 키체인 값이 진짜다. 평문 파일에 raw uuid 가 남아있으면 1회 제거(자가치유).
        // 모든 소비 경로(서명·derive_key)는 키체인 값을 쓰므로 파일 uuid 는 불필요하다.
        KeychainState::Found(uuid) => {
            scrub_file_uuid(&app, &settings)?;
            Ok(uuid)
        }

        // 키체인 비어있음: 기존 파일 uuid 마이그레이션 or 신규 발급 후 키체인 보관.
        KeychainState::Empty => {
            let uuid = file_uuid.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if keychain_write(&uuid) {
                // 키체인이 권위가 됨 → 평문 파일에서 raw uuid 제거.
                scrub_file_uuid(&app, &settings)?;
            } else {
                // 키체인 보관 실패 → 파일이 유일한 식별 소스이므로 uuid 를 파일에 유지.
                write_settings_uuid(&app, &mut settings, &uuid)?;
            }
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

/// 디바이스 UUID를 강제로 새로 발급하고 보호 저장소 및 user_settings.json에 동기화한다.
#[tauri::command]
pub fn reset_device_uuid(app: tauri::AppHandle) -> Result<String, String> {
    let new_uuid = uuid::Uuid::new_v4().to_string();
    let existing = read_data_file(app.clone(), SETTINGS_FILE.into())?;

    let mut settings: Value = match existing {
        Some(raw) if !raw.trim().is_empty() => {
            serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))
        }
        _ => Value::Object(Default::default()),
    };

    // OS 보호 저장소 덮어쓰기 (best-effort)
    if keychain_write(&new_uuid) {
        // 키체인이 권위 → 파일에 raw uuid 를 남기지 않고 잔재만 제거.
        scrub_file_uuid(&app, &settings)?;
    } else {
        // 키체인 미지원/실패 → 파일이 유일 소스이므로 서명과 함께 기록.
        write_settings_uuid(&app, &mut settings, &new_uuid)?;
    }

    Ok(new_uuid)
}

/// 주어진 uuid 를 권위 신원으로 설정한다(키체인 우선, 미지원 시 파일-서명 폴백).
/// 키체인이 동작하면 평문 파일에는 raw uuid 를 남기지 않는다(C-2).
fn set_authoritative_uuid(app: &tauri::AppHandle, uuid: &str) -> Result<(), String> {
    let existing = read_data_file(app.clone(), SETTINGS_FILE.into())?;
    let mut settings: Value = match existing {
        Some(raw) if !raw.trim().is_empty() => {
            serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))
        }
        _ => Value::Object(Default::default()),
    };

    if keychain_write(uuid) {
        scrub_file_uuid(app, &settings)?;
    } else {
        write_settings_uuid(app, &mut settings, uuid)?;
    }
    Ok(())
}

/// 백업 복구: 백업 페이로드의 device_uuid 를 권위 저장소(키체인)에 주입한다.
/// 복구 화면에서 데이터 기록·부팅 전에 호출해야 `ensure_device_uuid`/`derive_key`
/// 가 복구된 신원을 사용한다.
#[tauri::command]
pub fn restore_device_uuid(app: tauri::AppHandle, uuid: String) -> Result<(), String> {
    set_authoritative_uuid(&app, &uuid)
}

/// 키 이관(B-1) 준비 단계에서 생성한 신규 uuid 를 임시 보관한다. (시드 JS 비노출)
pub fn stash_pending_uuid(uuid: &str) -> bool {
    keychain_set(KEYRING_USER_PENDING, uuid)
}

/// 서버 이관이 성공한 뒤 호출. 임시 보관한 신규 uuid 로 권위 신원을 교체하고,
/// my_routes.json 을 구 키로 복호화 → 신규 키로 재암호화한다(키 변경에 따른 재키잉).
#[tauri::command]
pub fn commit_key_migration(app: tauri::AppHandle) -> Result<String, String> {
    let new_uuid = take_pending_uuid().ok_or("진행 중인 키 이관이 없습니다.")?;

    // 1) 현재(구) 키로 my_routes.json 복호화(read_data_file 이 투명 복호화).
    let routes = read_data_file(app.clone(), "my_routes.json".into())?;
    // 2) 권위 신원을 신규 uuid 로 교체(이후 derive_key 가 신규 키 사용).
    set_authoritative_uuid(&app, &new_uuid)?;
    // 3) 신규 키로 재암호화 기록.
    if let Some(content) = routes {
        write_data_file(app.clone(), "my_routes.json".into(), content)?;
    }
    // 4) 임시 보관 정리.
    keychain_clear(KEYRING_USER_PENDING);
    Ok(new_uuid)
}

/// 진행 중이던 키 이관을 취소(임시 보관 제거). 서버 이관 실패 시 호출.
#[tauri::command]
pub fn abort_key_migration() {
    keychain_clear(KEYRING_USER_PENDING);
}

/// 임시 보관한 신규 uuid 를 읽는다.
fn take_pending_uuid() -> Option<String> {
    keychain_get(KEYRING_USER_PENDING)
}

