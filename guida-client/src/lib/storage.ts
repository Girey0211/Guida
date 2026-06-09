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

/**
 * 디바이스 UUID를 보장한다.
 * Tauri에서는 Rust 커맨드가 user_settings.json에 병합 저장,
 * 브라우저에서는 별도 키에 보관한다.
 */
export async function ensureDeviceUuid(): Promise<string> {
  if (isTauri()) {
    return invoke<string>("ensure_device_uuid");
  }
  const KEY = "guida:device-uuid";
  let uuid = localStorage.getItem(KEY);
  if (!uuid) {
    uuid = generateUuid();
    localStorage.setItem(KEY, uuid);
  }
  return uuid;
}
