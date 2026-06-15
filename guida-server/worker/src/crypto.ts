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
  signature?: string;
}

/**
 * Ed25519 요청 서명 검증. 성공 시 pubkey 로부터 파생한 uploader UUID 를 반환한다.
 * 메시지 포맷: `${action}:${timestamp}:${sha256hex(rawBody)}` (기존과 동일).
 */
export async function verifyRequestSignature(
  headers: SignatureHeaders,
  rawBody: string,
  action: string,
): Promise<string> {
  const { pubkey, timestamp: timestampStr, signature } = headers;

  if (!pubkey || !timestampStr || !signature) {
    throw new Error('보안 서명 헤더가 누락되었습니다.');
  }

  const timestamp = parseInt(timestampStr, 10);
  const now = Date.now();
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
    throw new Error('요청이 만료되었거나 타임스탬프가 유효하지 않습니다.');
  }

  const bodyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
  const bodyHash = bytesToHex(new Uint8Array(bodyDigest));
  const message = `${action}:${timestampStr}:${bodyHash}`;

  try {
    // 32바이트 raw Ed25519 공개키를 그대로 import (WebCrypto 는 raw 포맷 지원).
    const publicKey = await crypto.subtle.importKey(
      'raw',
      hexToBytes(pubkey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    const isValid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      hexToBytes(signature),
      new TextEncoder().encode(message),
    );

    if (!isValid) {
      throw new Error('서명 검증에 실패했습니다.');
    }
  } catch (e) {
    throw new Error(`보안 검증 오류: ${(e as Error).message}`);
  }

  return uuidv5(pubkey);
}
