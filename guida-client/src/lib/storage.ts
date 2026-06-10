/**
 * 로컬 저장소 추상화 계층.
 *
 * Tauri 데스크톱에서는 Rust IPC 커맨드를 통해 `%APPDATA%/LimbusGuide/` 하위
 * JSON 파일을 읽고 쓴다. 일반 브라우저(Vite dev)에서는 localStorage로
 * 폴백하여 동일한 인터페이스로 동작한다 — 덕분에 Rust 없이도 전체 흐름을
 * 검증할 수 있다.
 */

import { isTauri } from "./env";
import { generateUuid } from "./utils";

const LS_PREFIX = "guida:file:";

/** Tauri invoke 핸들을 동적으로 가져온다 (브라우저 번들에서 안전) */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** 이름붙은 JSON 파일을 문자열로 읽는다. 없으면 null. */
export async function readFile(name: string): Promise<string | null> {
  if (isTauri()) {
    return (await invoke<string | null>("read_data_file", { name })) ?? null;
  }
  return localStorage.getItem(LS_PREFIX + name);
}

/** 이름붙은 JSON 파일에 문자열을 쓴다(덮어쓰기). */
export async function writeFile(name: string, content: string): Promise<void> {
  if (isTauri()) {
    await invoke<void>("write_data_file", { name, content });
    return;
  }
  localStorage.setItem(LS_PREFIX + name, content);
}

/** JSON 파일을 파싱해서 읽는다. 없거나 파싱 실패 시 fallback 반환. */
export async function readJson<T>(name: string, fallback: T): Promise<T> {
  const raw = await readFile(name);
  if (raw == null || raw.trim() === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[storage] ${name} 파싱 실패 — fallback 사용`);
    return fallback;
  }
}

/** 값을 JSON 직렬화하여 파일에 쓴다. */
export async function writeJson(name: string, value: unknown): Promise<void> {
  await writeFile(name, JSON.stringify(value, null, 2));
}

const UUID_KEY = "guida:device-uuid";
const UUID_SIG_KEY = "guida:device-uuid-sig";
/**
 * 앱 내장 솔트. 진짜 비밀은 아니며(번들에 노출됨), 파일/스토리지를 손으로
 * 고친 "외부 변조"를 탐지하기 위한 best-effort 무결성 토큰 계산용이다.
 */
const UUID_INTEGRITY_SALT = "guida.v1.device-uuid.integrity";

/**
 * UUID 무결성 서명(결정적, FNV-1a 32bit).
 * 외부에서 UUID 값만 바꾸면 이 서명과 어긋나므로 변조를 감지할 수 있다.
 */
function signUuid(uuid: string): string {
  const input = `${UUID_INTEGRITY_SALT}|${uuid}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * 디바이스 UUID를 보장한다.
 * Tauri에서는 Rust 커맨드가 user_settings.json에 병합 저장(무결성 서명 포함),
 * 브라우저에서는 별도 키에 UUID + 서명을 함께 보관한다.
 *
 * 방어: 저장된 UUID 와 서명이 어긋나면(= 프로그램이 아닌 외부 요인으로 수정됨)
 * 변조로 판단하여 UUID 를 새로 발급한다. 서명이 아예 없으면(레거시) 한 번
 * 채택하고 서명을 새로 기록한다.
 */
export async function ensureDeviceUuid(): Promise<string> {
  if (isTauri()) {
    return invoke<string>("ensure_device_uuid");
  }

  const stored = localStorage.getItem(UUID_KEY);
  const sig = localStorage.getItem(UUID_SIG_KEY);

  if (stored) {
    const expected = signUuid(stored);
    if (sig === expected) return stored; // 정상
    if (sig === null) {
      // 레거시(서명 없음) → 기존 UUID 채택 후 서명 기록(마이그레이션)
      localStorage.setItem(UUID_SIG_KEY, expected);
      return stored;
    }
    // 서명 불일치 → 외부 변조로 판단 → 아래에서 UUID 초기화
    console.warn("[storage] 디바이스 UUID 무결성 불일치 — 외부 변조로 판단해 초기화합니다.");
  }

  const uuid = generateUuid();
  localStorage.setItem(UUID_KEY, uuid);
  localStorage.setItem(UUID_SIG_KEY, signUuid(uuid));
  return uuid;
}
