/**
 * 이미지 content-addressed lazy 캐싱 회귀 테스트 (phase2 dev plan §4 S3, §6 행3).
 *
 * Tauri 경로(isTauri=true)에서 캐시 적중/미스, 무결성 검증, 폴백을 검증한다.
 * 디스크 캐시(Rust invoke)와 fetch 를 목킹한다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, invokeMock } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  readJson: async <T,>(name: string, fallback: T): Promise<T> => {
    const raw = store.get(name);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  writeJson: async () => {},
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  IS_LOGGING_ENABLED: false,
}));
vi.mock("@/lib/env", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { resolveGiftImageSrc } from "@/api/imageCache";
import type { Manifest } from "@/types/manifest";

/** Uint8Array → 독립 ArrayBuffer (DOM lib 의 BufferSource/BodyInit 타입 충족용). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

// 테스트마다 바이트를 다르게 해 해시 충돌(모듈 메모리 캐시 적중)을 피한다.
let testSeq = 0;
let IMG: Uint8Array;
let imgHash: string;
const fetchSpy = vi.fn();

beforeEach(async () => {
  store.clear();
  invokeMock.mockReset();
  fetchSpy.mockReset();
  IMG = new Uint8Array([1, 2, 3, 4, 5, 6, 7, ++testSeq]);
  imgHash = await sha256Bytes(IMG);
  const manifest: Manifest = {
    schema_version: "1.0",
    patch_version: "1.0",
    generated_at: "x",
    data: {},
    images: { gift_x: { hash: imgHash, size: IMG.length } },
  };
  store.set(
    "manifest.local.json",
    JSON.stringify({ manifest, etag: '"v1"', applied_at: "x" }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("window", { location: { origin: "https://cdn.girey.org" } });
});

describe("이미지 content-addressed 캐싱", () => {
  it("캐시 적중: Rust 캐시에서 즉시 로드(네트워크 0)", async () => {
    invokeMock.mockResolvedValueOnce(btoa(String.fromCharCode(...IMG))); // read_cached_image → base64

    const src = await resolveGiftImageSrc("gift_x.webp");

    expect(src).toMatch(/^data:image\/webp;base64,/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("read_cached_image", expect.anything());
  });

  it("캐시 미스: 1회 다운로드 → 해시 검증 통과 → 저장 후 표시", async () => {
    invokeMock.mockResolvedValueOnce(null); // read_cached_image → 미스
    invokeMock.mockResolvedValueOnce(undefined); // write_cached_image → ok
    fetchSpy.mockResolvedValueOnce(new Response(toArrayBuffer(IMG), { status: 200 }));

    const src = await resolveGiftImageSrc("gift_x.webp");

    expect(src).toMatch(/^data:image\/webp;base64,/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // write_cached_image 호출됨(디스크 저장)
    expect(invokeMock).toHaveBeenCalledWith("write_cached_image", expect.objectContaining({}));
  });

  it("[행3] 무결성 검증 실패(변조 바이트) → null 폴백, 캐시 저장 안 함", async () => {
    invokeMock.mockResolvedValueOnce(null); // 미스
    fetchSpy.mockResolvedValueOnce(new Response(toArrayBuffer(new Uint8Array([9, 9, 9])), { status: 200 }));

    const src = await resolveGiftImageSrc("gift_x.webp");

    expect(src).toBeNull();
    // 검증 실패 → write_cached_image 미호출
    expect(invokeMock).not.toHaveBeenCalledWith("write_cached_image", expect.anything());
  });

  it("[행3] 다운로드 실패(5xx) → null 폴백", async () => {
    invokeMock.mockResolvedValueOnce(null); // 미스
    fetchSpy.mockResolvedValueOnce(new Response("err", { status: 500 }));

    const src = await resolveGiftImageSrc("gift_x.webp");

    expect(src).toBeNull();
  });

  it("매니페스트에 없는 이미지 → null 폴백(네트워크/IPC 시도 없음)", async () => {
    const src = await resolveGiftImageSrc("gift_unknown.webp");

    expect(src).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
