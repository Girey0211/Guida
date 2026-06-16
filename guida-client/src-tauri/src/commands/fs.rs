//! 모든 유저 데이터는 `%APPDATA%/Local/Guida/` 경로 아래에 보관된다.
//! 중요 데이터(my_routes.json)는 device_uuid를 키로 하는 AES-256-GCM 암호화를 적용하며,
//! 변조/키 불일치 감지 시 자동으로 자가 치유(빈 데이터로 재설정)를 적용한다.

use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};
use rand::RngCore;

/// 앱 데이터 디렉토리(`%APPDATA%/Local/Guida/`)를 반환하고, 없으면 생성한다.
fn ensure_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .local_data_dir()
        .map_err(|e| format!("앱 데이터 경로를 확인할 수 없습니다: {e}"))?
        .join("Guida");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("데이터 폴더 생성 실패: {e}"))?;
    }
    Ok(dir)
}

/// 파일명이 디렉토리 이탈(`..`, 절대경로)을 시도하지 않는지 검증한다.
fn safe_join(dir: PathBuf, name: &str) -> Result<PathBuf, String> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("허용되지 않는 파일명입니다.".into());
    }
    Ok(dir.join(name))
}

/// UUID와 솔트로부터 256비트 AES 키를 유도한다.
fn derive_key(uuid: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(uuid.as_bytes());
    hasher.update(b"guida.v1.storage.salt");
    hasher.finalize().into()
}

/// 데이터를 AES-256-GCM으로 암호화하여 12바이트 넌스(Nonce) + 암호문(Ciphertext) 형식으로 반환한다.
fn encrypt_data(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| format!("암호화 오류: {:?}", e))?;
    
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// 12바이트 넌스 + 암호문 형식의 바이너리 데이터를 복호화한다.
fn decrypt_data(encrypted_data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if encrypted_data.len() < 12 {
        return Err("암호화 데이터 길이가 너무 짧습니다.".into());
    }
    let cipher = Aes256Gcm::new(key.into());
    let (nonce_bytes, ciphertext) = encrypted_data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("복호화 오류: {:?}", e))
}

/// 데이터 디렉토리의 절대 경로 문자열을 반환한다.
#[tauri::command]
pub fn data_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = ensure_data_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// `Guida/<name>` JSON 파일을 읽어 문자열로 반환한다.
/// `my_routes.json` 파일의 경우 투명하게 복호화 및 마이그레이션/자가치유 처리를 수행한다.
#[tauri::command]
pub fn read_data_file(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = ensure_data_dir(&app)?;
    let path = safe_join(dir, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    
    if name != "my_routes.json" {
        return fs::read_to_string(&path)
            .map(Some)
            .map_err(|e| format!("파일 읽기 실패({name}): {e}"));
    }

    // my_routes.json 복호화 처리
    let bytes = fs::read(&path).map_err(|e| format!("파일 읽기 실패({name}): {e}"))?;
    if bytes.is_empty() {
        return Ok(Some("[]".to_string()));
    }

    // 1. 마이그레이션 지원: 평문 UTF-8 JSON(예: '[' 또는 '{'로 시작)이면 즉시 암호화하여 저장
    if let Ok(utf8_str) = std::str::from_utf8(&bytes) {
        let trimmed = utf8_str.trim();
        if trimmed.starts_with('[') || trimmed.starts_with('{') {
            let uuid = crate::commands::settings::ensure_device_uuid(app.clone())?;
            let key = derive_key(&uuid);
            let encrypted = encrypt_data(utf8_str.as_bytes(), &key)?;
            fs::write(&path, encrypted).map_err(|e| format!("마이그레이션 암호화 쓰기 실패: {e}"))?;
            return Ok(Some(utf8_str.to_string()));
        }
    }

    // 2. 암호화 파일 복호화
    let uuid = crate::commands::settings::ensure_device_uuid(app.clone())?;
    let key = derive_key(&uuid);
    match decrypt_data(&bytes, &key) {
        Ok(decrypted_bytes) => {
            let decrypted_str = String::from_utf8(decrypted_bytes)
                .map_err(|e| format!("복호화 데이터 UTF-8 변환 실패: {e}"))?;
            Ok(Some(decrypted_str))
        }
        Err(e) => {
            // 3. 자가 치유(Self-healing): 복호화 실패 시 변조/키유실로 판단하여 빈 배열([])로 초기화 후 저장
            eprintln!("경고: 복호화 실패 ({e:?}). 루트 데이터를 재설정(초기화)합니다.");
            let empty_json = "[]";
            let encrypted = encrypt_data(empty_json.as_bytes(), &key)?;
            fs::write(&path, encrypted).map_err(|e| format!("자가치유 쓰기 실패: {e}"))?;
            Ok(Some(empty_json.to_string()))
        }
    }
}

/// `Guida/<name>` JSON 파일에 문자열을 기록한다(덮어쓰기).
/// `my_routes.json` 파일의 경우 투명하게 AES-256-GCM 암호화하여 기록한다.
#[tauri::command]
pub fn write_data_file(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let dir = ensure_data_dir(&app)?;
    let path = safe_join(dir, &name)?;
    
    if name != "my_routes.json" {
        // user_settings.json 은 키체인이 권위인 경우 raw device_uuid 를 평문으로
        // 남기지 않도록 정규화한다(C-2). 그 외 파일/폴백 환경은 원본 그대로 기록.
        let content = if name == "user_settings.json" {
            crate::commands::settings::strip_uuid_for_persist(content)
        } else {
            content
        };
        return fs::write(&path, content).map_err(|e| format!("파일 쓰기 실패({name}): {e}"));
    }

    // my_routes.json 암호화 처리
    let uuid = crate::commands::settings::ensure_device_uuid(app.clone())?;
    let key = derive_key(&uuid);
    let encrypted = encrypt_data(content.as_bytes(), &key)?;
    fs::write(&path, encrypted).map_err(|e| format!("파일 쓰기 실패({name}): {e}"))
}

/// 특정 로그 파일에 텍스트 라인을 추가 기입한다.
/// 파일 크기가 2MB를 초과하는 경우, `.old` 파일로 교체하고 새 파일을 시작한다.
#[tauri::command]
pub fn append_log_file(app: tauri::AppHandle, name: String, line: String) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    // 로그 파일명의 이탈 시도를 막는다
    let dir = ensure_data_dir(&app)?;
    let path = safe_join(dir, &name)?;

    // 2MB 용량 검사 및 로테이션
    if path.exists() {
        if let Ok(metadata) = fs::metadata(&path) {
            if metadata.len() > 2 * 1024 * 1024 {
                let mut old_path = path.clone();
                old_path.set_extension("log.old");
                let _ = fs::rename(&path, &old_path);
            }
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("로그 파일 열기 실패: {e}"))?;

    writeln!(file, "{}", line).map_err(|e| format!("로그 파일 쓰기 실패: {e}"))?;
    Ok(())
}

/// 로그가 저장된 로컬 데이터 디렉토리를 OS 기본 탐색기/파인더로 연다.
#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = ensure_data_dir(&app)?;
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("탐색기 실행 실패: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Finder 실행 실패: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("디렉토리 열기 실패: {e}"))?;
    }
    
    Ok(())
}


