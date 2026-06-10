use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};
use ed25519_dalek::{SigningKey, Signer};
use base64::{prelude::BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use rand::RngCore;

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

/// Helper to derive AES-256 key from recovery_code for backups
fn derive_backup_key(recovery_code: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(recovery_code.as_bytes());
    hasher.update(b"guida.v1.backup.salt");
    hasher.finalize().into()
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
        
    let key = derive_backup_key(&recovery_code);
    let cipher = Aes256Gcm::new(&key.into());
    
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("백업 암호화 실패: {:?}", e))?;
        
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
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
        
    if combined.len() < 12 {
        return Err("백업 데이터의 형식이 유효하지 않습니다(너무 짧음).".into());
    }
    
    let key = derive_backup_key(&recovery_code);
    let cipher = Aes256Gcm::new(&key.into());
    
    let (nonce_bytes, ciphertext) = combined.split_at(12);
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
