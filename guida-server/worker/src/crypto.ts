// 기존 routes.ts 의 node:crypto 기반 서명 검증/UUIDv5 를 WebCrypto 로 재작성.
// Cloudflare Workers 는 Ed25519 / SHA-1 / SHA-256 을 crypto.subtle 로 지원한다.

const NAMESPACE_DNS = hexToBytes('6ba7b8109dad11d180b400c04fd430c8');
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** 6자리 대문자 영숫자 코드 생성 (예: X7R2B9). */
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

/**
 * UUIDv5 (NAMESPACE_DNS, name). 기존 구현과 바이트 단위로 동일하게 유지해야
 * 기존에 발급된 uploader_uuid 와 일치한다. (name 의 UTF-8 바이트를 해싱)
 */
export async function uuidv5(name: string): Promise<string> {
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(NAMESPACE_DNS.length + nameBytes.length);
  data.set(NAMESPACE_DNS, 0);
  data.set(nameBytes, NAMESPACE_DNS.length);

  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytesToHex(hash.subarray(0, 16));
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}

export interface SignatureHeaders {
  pubkey?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
}

/** 폐기 여부 조회 콜백(B-1). 주입된 DB 핸들로 revoked_keys 를 조회한다. */
export type RevokedChecker = (pubkey: string) => Promise<boolean>;

/**
 * nonce 소비 콜백(A-4). 처음 보는 nonce 면 적재 후 true, 이미 쓰인 nonce 면 false 반환.
 * 리플레이(중복 nonce) 차단에 쓰인다.
 */
export type NonceConsumer = (nonce: string) => Promise<boolean>;

/** 서명 검증 부가 옵션(폐기 검사 + nonce 리플레이 차단). */
export interface VerifyOptions {
  isRevoked?: RevokedChecker;
  consumeNonce?: NonceConsumer;
}

/** 서명 타임스탬프 허용 창(±60초). 리플레이 가능 구간을 좁힌다(A-4). */
const SIGNATURE_WINDOW_MS = 60 * 1000;

/** raw Ed25519 공개키(hex) 로 메시지/서명(hex)을 검증한다(WebCrypto). */
export async function ed25519Verify(
  pubkeyHex: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    hexToBytes(pubkeyHex),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    publicKey,
    hexToBytes(signatureHex),
    new TextEncoder().encode(message),
  );
}

/** rawBody 의 sha256 hex. */
export async function sha256Hex(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Ed25519 요청 서명 검증. 성공 시 pubkey 로부터 파생한 uploader UUID 를 반환한다.
 * 메시지 포맷: `${action}:${timestamp}:${nonce}:${sha256hex(rawBody)}`.
 * `isRevoked` 가 주어지면 폐기된 공개키를(B-1), `consumeNonce` 가 주어지면 중복
 * nonce(리플레이)를 거부한다(A-4). 타임스탬프 허용 창은 ±60초.
 */
export async function verifyRequestSignature(
  headers: SignatureHeaders,
  rawBody: string,
  action: string,
  opts: VerifyOptions = {},
): Promise<string> {
  const { pubkey, timestamp: timestampStr, nonce, signature } = headers;

  if (!pubkey || !timestampStr || !nonce || !signature) {
    throw new Error('보안 서명 헤더가 누락되었습니다.');
  }

  const timestamp = parseInt(timestampStr, 10);
  const now = Date.now();
  if (isNaN(timestamp) || Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) {
    throw new Error('요청이 만료되었거나 타임스탬프가 유효하지 않습니다.');
  }

  const bodyHash = await sha256Hex(rawBody);
  const message = `${action}:${timestampStr}:${nonce}:${bodyHash}`;

  let isValid = false;
  try {
    isValid = await ed25519Verify(pubkey, message, signature);
  } catch (e) {
    throw new Error(`보안 검증 오류: ${(e as Error).message}`);
  }
  if (!isValid) {
    throw new Error('서명 검증에 실패했습니다.');
  }

  if (opts.isRevoked && (await opts.isRevoked(pubkey))) {
    throw new Error('폐기된 보안 키입니다. 키 갱신(이관) 후 다시 시도하세요.');
  }

  // 서명 유효성 확인 후에 nonce 를 소비한다(유효하지 않은 요청으로 nonce 가 소모되지 않게).
  if (opts.consumeNonce && !(await opts.consumeNonce(nonce))) {
    throw new Error('이미 처리된 요청입니다(리플레이가 감지되었습니다).');
  }

  return uuidv5(pubkey);
}
