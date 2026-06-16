use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use sha2::{Digest, Sha256};
use ed25519_dalek::{SigningKey, Signer};
use base64::{prelude::BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use rand::RngCore;

/// 백업 블롭 규격. 복구 코드 → AES 키 파생에 느린 KDF 를 쓰고 백업마다 임의 솔트를
/// 블롭 헤더에 포함한다.
///   - v3(현행, 기록): 메모리-하드 Argon2id. GPU/ASIC 병렬 브루트포스 내성을 높인다.
///   - v2(레거시, 복호화 전용): PBKDF2-HMAC-SHA256 600k. 브라우저(WebCrypto) 경로 및
///     과거 v2 블롭과의 복원 호환을 위해 복호화만 지원한다.
const BACKUP_BLOB_VERSION_V2: u8 = 2;
const BACKUP_BLOB_VERSION_V3: u8 = 3;
const PBKDF2_ITERATIONS: u32 = 600_000;
const BACKUP_SALT_LEN: usize = 16;
const BACKUP_NONCE_LEN: usize = 12;

/// Argon2id 파라미터(v3). OWASP 권장 하한대(메모리 19 MiB, 반복 2, 병렬 1)로,
/// 데스크톱에서 체감 지연 없이 메모리-하드 비용을 부과한다. 출력은 AES-256 키 32바이트.
const ARGON2_MEM_KIB: u32 = 19_456; // 19 MiB
const ARGON2_TIME_COST: u32 = 2;
const ARGON2_LANES: u32 = 1;

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

/// 복구 코드 정규화(클라이언트와 동일): trim + 대문자.
fn normalize_recovery_code(recovery_code: &str) -> String {
    recovery_code.trim().to_uppercase()
}

/// v3 AES-256 키 파생: Argon2id(메모리-하드) + 백업별 랜덤 솔트.
fn derive_backup_key_argon2(recovery_code: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let normalized = normalize_recovery_code(recovery_code);
    let params = Params::new(ARGON2_MEM_KIB, ARGON2_TIME_COST, ARGON2_LANES, Some(32))
        .map_err(|e| format!("Argon2 파라미터 오류: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(normalized.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Argon2 키 파생 실패: {e}"))?;
    Ok(key)
}

/// v2 AES-256 키 파생(레거시 복호화 전용): PBKDF2-HMAC-SHA256 + 백업별 랜덤 솔트.
fn derive_backup_key_pbkdf2(recovery_code: &str, salt: &[u8]) -> [u8; 32] {
    let normalized = normalize_recovery_code(recovery_code);
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

/// 현재 시각(ms). 서버 타임스탬프 창(±60초) 판정에 쓰인다.
fn current_millis() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 신원 이관(B-1) 요청 페이로드. 구 키·신규 키 두 서명을 함께 담는다.
#[derive(Serialize)]
pub struct MigrationRequest {
    /// 서버로 그대로 전송할 요청 바디(JSON 문자열). new_pubkey 를 포함해 서명에 바인딩됨.
    pub body: String,
    pub timestamp: String,
    /// 리플레이 방지 1회용 nonce(A-4). 구/신 서명 메시지에 함께 바인딩되며 헤더로 전송된다.
    pub nonce: String,
    pub old_pubkey: String,
    pub old_signature: String,
    pub new_pubkey: String,
    pub new_signature: String,
}

/// 키 이관 시작: 신규 신원을 생성하고 구/신 두 키로 동일 메시지를 서명한 요청을 만든다.
/// 신규 uuid(시드)는 JS 로 노출하지 않고 키체인에 임시 보관한다(commit_key_migration 에서 확정).
#[tauri::command]
pub fn begin_key_migration(app: tauri::AppHandle) -> Result<MigrationRequest, String> {
    let current_uuid = crate::commands::settings::ensure_device_uuid(app.clone())?;
    let old_key = derive_signing_key(&current_uuid);
    let old_pubkey = to_hex(old_key.verifying_key().as_bytes());

    // 신규 신원 생성 및 파생.
    let new_uuid = uuid::Uuid::new_v4().to_string();
    let new_key = derive_signing_key(&new_uuid);
    let new_pubkey = to_hex(new_key.verifying_key().as_bytes());

    // 신규 uuid(시드) 임시 보관. 키체인 미지원 환경이면 이관 불가.
    if !crate::commands::settings::stash_pending_uuid(&new_uuid) {
        return Err("보안 저장소를 사용할 수 없어 키 이관을 시작할 수 없습니다.".into());
    }

    // 서명 메시지: migrate:ts:nonce:sha256(body). body 에 new_pubkey 가 들어가 구↔신을
    // 바인딩하고, nonce 로 리플레이를 차단한다(A-4).
    let timestamp = current_millis();
    let nonce = uuid::Uuid::new_v4().to_string();
    let body = format!("{{\"new_pubkey\":\"{}\"}}", new_pubkey);
    let hash = Sha256::digest(body.as_bytes());
    let body_hash = to_hex(hash.as_slice());
    let message = format!("migrate:{}:{}:{}", timestamp, nonce, body_hash);

    let old_signature = to_hex(&old_key.sign(message.as_bytes()).to_bytes());
    let new_signature = to_hex(&new_key.sign(message.as_bytes()).to_bytes());

    Ok(MigrationRequest {
        body,
        timestamp: timestamp.to_string(),
        nonce,
        old_pubkey,
        old_signature,
        new_pubkey,
        new_signature,
    })
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

    // 백업마다 랜덤 솔트 생성 → Argon2id(v3)로 AES 키 파생.
    let mut salt = [0u8; BACKUP_SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_backup_key_argon2(&recovery_code, &salt)?;
    let cipher = Aes256Gcm::new(&key.into());

    let mut nonce_bytes = [0u8; BACKUP_NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("백업 암호화 실패: {:?}", e))?;

    // 블롭 = version(1) || salt(16) || nonce(12) || ciphertext
    let mut combined = Vec::with_capacity(1 + BACKUP_SALT_LEN + BACKUP_NONCE_LEN + ciphertext.len());
    combined.push(BACKUP_BLOB_VERSION_V3);
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

    // version(1) || salt(16) || nonce(12) || ciphertext.
    //   v3 → Argon2id, v2 → PBKDF2(레거시). V1(고정 솔트/SHA-256) 이하는 복원 불가.
    let header_len = 1 + BACKUP_SALT_LEN + BACKUP_NONCE_LEN;
    let version = combined.first().copied().unwrap_or(0);
    if combined.len() <= header_len
        || (version != BACKUP_BLOB_VERSION_V3 && version != BACKUP_BLOB_VERSION_V2)
    {
        return Err("지원하지 않는 백업 형식입니다(V2/V3 전용).".into());
    }

    let salt = &combined[1..1 + BACKUP_SALT_LEN];
    let nonce_bytes = &combined[1 + BACKUP_SALT_LEN..header_len];
    let ciphertext = &combined[header_len..];

    let key = if version == BACKUP_BLOB_VERSION_V3 {
        derive_backup_key_argon2(&recovery_code, salt)?
    } else {
        derive_backup_key_pbkdf2(&recovery_code, salt)
    };
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
