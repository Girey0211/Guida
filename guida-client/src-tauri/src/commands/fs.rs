//! 로컬 파일 시스템 제어 커맨드.
//!
//! 모든 유저 데이터는 `%APPDATA%/LimbusGuide/` 경로 아래에 평문 JSON 파일로
//! 보관된다. 게임 프로세스에는 전혀 관여하지 않는 Read-Only 설계를 따른다.

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// 앱 데이터 디렉토리(`%APPDATA%/LimbusGuide/`)를 반환하고, 없으면 생성한다.
fn ensure_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로를 확인할 수 없습니다: {e}"))?;
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

/// 데이터 디렉토리의 절대 경로 문자열을 반환한다.
#[tauri::command]
pub fn data_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = ensure_data_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// `LimbusGuide/<name>` JSON 파일을 읽어 문자열로 반환한다.
/// 파일이 없으면 `None`을 의미하는 빈 옵션 대신 에러 대신 `null`을 반환한다.
#[tauri::command]
pub fn read_data_file(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let dir = ensure_data_dir(&app)?;
    let path = safe_join(dir, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("파일 읽기 실패({name}): {e}"))
}

/// `LimbusGuide/<name>` JSON 파일에 문자열을 기록한다(덮어쓰기).
#[tauri::command]
pub fn write_data_file(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let dir = ensure_data_dir(&app)?;
    let path = safe_join(dir, &name)?;
    fs::write(&path, content).map_err(|e| format!("파일 쓰기 실패({name}): {e}"))
}
