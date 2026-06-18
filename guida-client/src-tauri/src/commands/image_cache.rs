//! 기프트 아이콘의 content-addressed 디스크 캐시 (phase2 dev plan §2·§4·§5 S3/S4).
//!
//! `%APPDATA%/Local/Guida/cache/images/<hash>.webp` 에 보관한다. 파일명이 곧
//! 콘텐츠 해시(hex)라 이름 충돌이 없고, 매니페스트 해시로 적중을 즉시 판정한다.
//!
//! 프런트는 매니페스트 해시(`sha256:<hex>`)에서 알고리즘 접두를 떼어 hex 만
//! 넘긴다(Windows 파일명에 ':' 사용 불가). 이미지 바이트는 base64 로 주고받아
//! webview 의 `data:` URL 로 표시한다(CSP 가 data: 를 허용).

use std::fs;
use std::path::PathBuf;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tauri::Manager;

/// 이미지 캐시 디렉토리(`Guida/cache/images/`)를 반환하고, 없으면 생성한다.
fn ensure_image_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .local_data_dir()
        .map_err(|e| format!("앱 데이터 경로를 확인할 수 없습니다: {e}"))?
        .join("Guida")
        .join("cache")
        .join("images");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("이미지 캐시 폴더 생성 실패: {e}"))?;
    }
    Ok(dir)
}

/// 해시 hex 가 캐시 파일명으로 안전한지 검증한다(경로 이탈·확장자 위조 차단).
/// 매니페스트 hex 는 [0-9a-f] 만 포함하므로 그 외 문자는 거부한다.
fn safe_hash_stem(hash: &str) -> Result<String, String> {
    // 혹시 "sha256:" 접두가 남아 와도 떼어낸다.
    let hex = hash.strip_prefix("sha256:").unwrap_or(hash);
    if hex.is_empty() || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("허용되지 않는 이미지 해시입니다.".into());
    }
    Ok(hex.to_ascii_lowercase())
}

/// 캐시에 있으면 base64(webp 바이트)를 반환한다. 없으면 None(미스).
#[tauri::command]
pub fn read_cached_image(app: tauri::AppHandle, hash: String) -> Result<Option<String>, String> {
    let dir = ensure_image_cache_dir(&app)?;
    let path = dir.join(format!("{}.webp", safe_hash_stem(&hash)?));
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| format!("이미지 캐시 읽기 실패: {e}"))?;
    Ok(Some(BASE64.encode(bytes)))
}

/// 검증을 통과한 base64(webp 바이트)를 캐시에 기록한다(content-addressed).
#[tauri::command]
pub fn write_cached_image(app: tauri::AppHandle, hash: String, base64: String) -> Result<(), String> {
    let dir = ensure_image_cache_dir(&app)?;
    let stem = safe_hash_stem(&hash)?;
    let bytes = BASE64
        .decode(base64.as_bytes())
        .map_err(|e| format!("이미지 base64 디코드 실패: {e}"))?;
    let path = dir.join(format!("{}.webp", stem));
    fs::write(&path, bytes).map_err(|e| format!("이미지 캐시 쓰기 실패: {e}"))
}

/// 캐시에 보관된 모든 이미지의 해시 hex 목록을 반환한다(orphan GC 판정용).
#[tauri::command]
pub fn list_cached_image_hashes(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = ensure_image_cache_dir(&app)?;
    let mut hashes = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("이미지 캐시 목록 조회 실패: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(stem) = name.strip_suffix(".webp") {
            hashes.push(stem.to_string());
        }
    }
    Ok(hashes)
}

/// 주어진 해시 hex 들의 캐시 파일을 삭제한다(orphan GC).
/// 삭제 실패(파일 잠금 등)는 비치명적이라 무시하고, 실제 삭제된 해시만 반환한다.
#[tauri::command]
pub fn delete_cached_images(app: tauri::AppHandle, hashes: Vec<String>) -> Result<Vec<String>, String> {
    let dir = ensure_image_cache_dir(&app)?;
    let mut deleted = Vec::new();
    for hash in hashes {
        let stem = match safe_hash_stem(&hash) {
            Ok(s) => s,
            Err(_) => continue, // 잘못된 해시는 건너뜀
        };
        let path = dir.join(format!("{}.webp", stem));
        if fs::remove_file(&path).is_ok() {
            deleted.push(stem);
        }
    }
    Ok(deleted)
}
