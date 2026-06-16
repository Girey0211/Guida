use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};
use ed25519_dalek::{SigningKey, Signer};
use base64::{prelude::BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use rand::RngCore;

/// 백업 v2 규격. 복구 코드 → AES 키 파생에 느린 KDF(PBKDF2-HMAC-SHA256)를 쓰고
/// 백업마다 임의 솔트를 블롭 헤더에 포함한다. 클라이언트(WebCrypto)와 동일 파라미터.
const PBKDF2_ITERATIONS: u32 = 600_000;
const BACKUP_BLOB_VERSION: u8 = 2;
const BACKUP_SALT_LEN: usize = 16;
const BACKUP_NONCE_LEN: usize = 12;

#[derive(Serialize)]
pub struct RestoreResult {
    pub device_uuid: String,
    pub settings_json: String,
    pub routes_json: String,
}

/// Helper to convert bytes to a hex string
fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Helper to derive Ed25519 keypair deterministically from device_uuid
fn derive_signing_key(device_uuid: &str) -> SigningKey {
    let mut hasher = Sha256::new();
    hasher.update(device_uuid.as_bytes());
    let seed: [u8; 32] = hasher.finalize().into();
    SigningKey::from_bytes(&seed)
}

/// Helper to derive AES-256 key from recovery_code for backups (v2: PBKDF2-HMAC-SHA256 + 랜덤 솔트).
/// 복구 코드는 클라이언트와 동일하게 trim + 대문자 정규화 후 사용한다.
fn derive_backup_key(recovery_code: &str, salt: &[u8]) -> [u8; 32] {
    let normalized = recovery_code.trim().to_uppercase();
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(normalized.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// Tauri command to retrieve the device public key and validation signature
/// Returns (pubkey_hex, verification_sig_hex) where verification_sig signs device_uuid
#[tauri::command]
pub fn get_device_keys(app: tauri::AppHandle) -> Result<(String, String), String> {
    let uuid = crate::commands::settings::ensure_device_uuid(app)?;
    let signing_key = derive_signing_key(&uuid);
    let pubkey = to_hex(signing_key.verifying_key().as_bytes());
    
    // Sign the device_uuid as a validation test
    let signature = to_hex(&signing_key.sign(uuid.as_bytes()).to_bytes());
    Ok((pubkey, signature))
}

/// Tauri command to sign a message using the derived device private key
#[tauri::command]
pub fn sign_api_request(app: tauri::AppHandle, message: String) -> Result<String, String> {
    let uuid = crate::commands::settings::ensure_device_uuid(app)?;
    let signing_key = derive_signing_key(&uuid);
    let signature = signing_key.sign(message.as_bytes());
    Ok(to_hex(&signature.to_bytes()))
}

#[derive(Serialize)]
struct BackupPayload {
    device_uuid: String,
    settings: String,
    routes: String,
}

#[derive(Deserialize)]
struct BackupPayloadDecrypted {
    device_uuid: String,
    settings: String,
    routes: String,
}

/// Tauri command to encrypt settings and routes using the recovery code
#[tauri::command]
pub fn encrypt_backup(
    app: tauri::AppHandle,
    recovery_code: String,
    settings_json: String,
    routes_json: String,
) -> Result<String, String> {
    let uuid = crate::commands::settings::ensure_device_uuid(app)?;
    let payload = BackupPayload {
        device_uuid: uuid,
        settings: settings_json,
        routes: routes_json,
    };
    
    let plaintext = serde_json::to_string(&payload)
        .map_err(|e| format!("백업 데이터 직렬화 실패: {e}"))?;

    // 백업마다 랜덤 솔트 생성 → PBKDF2 로 AES 키 파생.
    let mut salt = [0u8; BACKUP_SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_backup_key(&recovery_code, &salt);
    let cipher = Aes256Gcm::new(&key.into());

    let mut nonce_bytes = [0u8; BACKUP_NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("백업 암호화 실패: {:?}", e))?;

    // 블롭 = version(1) || salt(16) || nonce(12) || ciphertext
    let mut combined = Vec::with_capacity(1 + BACKUP_SALT_LEN + BACKUP_NONCE_LEN + ciphertext.len());
    combined.push(BACKUP_BLOB_VERSION);
    combined.extend_from_slice(&salt);
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64_STANDARD.encode(combined))
}

/// Tauri command to decrypt a backup using the recovery code
#[tauri::command]
pub fn decrypt_backup(
    _app: tauri::AppHandle,
    recovery_code: String,
    encrypted_blob: String,
) -> Result<RestoreResult, String> {
    let combined = BASE64_STANDARD
        .decode(encrypted_blob.trim())
        .map_err(|e| format!("Base64 디코딩 실패: {e}"))?;

    // V2 전용: version(1) || salt(16) || nonce(12) || ciphertext. V1 블롭은 복원 불가.
    let header_len = 1 + BACKUP_SALT_LEN + BACKUP_NONCE_LEN;
    if combined.len() <= header_len || combined[0] != BACKUP_BLOB_VERSION {
        return Err("지원하지 않는 백업 형식입니다(V2 전용).".into());
    }

    let salt = &combined[1..1 + BACKUP_SALT_LEN];
    let nonce_bytes = &combined[1 + BACKUP_SALT_LEN..header_len];
    let ciphertext = &combined[header_len..];

    let key = derive_backup_key(&recovery_code, salt);
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    let decrypted_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("백업 복호화 실패 (복구 코드가 틀렸거나 변조됨): {:?}", e))?;
        
    let decrypted_str = String::from_utf8(decrypted_bytes)
        .map_err(|e| format!("복호화 데이터 UTF-8 인코딩 실패: {e}"))?;
        
    let payload: BackupPayloadDecrypted = serde_json::from_str(&decrypted_str)
        .map_err(|e| format!("복합 백업 구조 분석 실패: {e}"))?;
        
    Ok(RestoreResult {
        device_uuid: payload.device_uuid,
        settings_json: payload.settings,
        routes_json: payload.routes,
    })
}
