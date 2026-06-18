/**
 * Offline-First / 매니페스트 동기화 회귀 테스트 (phase2 dev plan §6 S5).
 *
 * §6 실패 처리표의 각 행과 핵심 동기화 동작(diff / 304 / 무결성)을 검증한다.
 * fetch 와 로컬 스토리지를 목킹해 네트워크 차단·부분 실패·변조 주입 시나리오를
 * 재현하고, 앱이 항상 ready 에 도달하며 마지막 정상 캐시로 동작하는지 본다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── 인메모리 로컬 스토리지 목 (Tauri/localStorage 대체) ───────────────────────
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@/lib/storage", () => ({
  readFile: async (name: string) => (store.has(name) ? store.get(name)! : null),
  writeFile: async (name: string, content: string) => {
    store.set(name, content);
  },
  readJson: async <T,>(name: string, fallback: T): Promise<T> => {
    const raw = store.get(name);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  writeJson: async (name: string, value: unknown) => {
    store.set(name, JSON.stringify(value));
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  IS_LOGGING_ENABLED: false,
}));

// 디스크 이미지 캐시는 Tauri 전용 — 테스트는 브라우저 경로(GC 스킵)로 둔다.
vi.mock("@/lib/env", () => ({ isTauri: () => false }));

import { syncGameData } from "@/api/gameData";
import type { Manifest } from "@/types/manifest";

// ── 해시 헬퍼 (프로덕션 sha256OfBytes 와 동일 규약) ──────────────────────────
async function sha256(content: string): Promise<string> {
  const buf = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

async function buildManifest(files: Record<string, string>, etagPatch = "1.0"): Promise<Manifest> {
  const data: Manifest["data"] = {};
  for (const [name, content] of Object.entries(files)) {
    data[name] = { hash: await sha256(content), size: content.length };
  }
  return {
    schema_version: "1.0",
    patch_version: etagPatch,
    generated_at: new Date().toISOString(),
    data,
    images: {},
  };
}

// ── 가짜 CDN 서버 상태 + fetch 라우터 ───────────────────────────────────────
interface FakeServer {
  patch: unknown;
  gameData: unknown;
  manifest: Manifest;
  etag: string;
  files: Map<string, string>; // 파일명 → 원본 내용
  patchFail: boolean; // patch_version.json 5xx
  manifestFail: boolean; // manifest.json 5xx
  fileFail: Set<string>; // 특정 data 파일 5xx
  tamper: Set<string>; // 특정 data 파일 본문 변조(해시 불일치 유발)
}

let server: FakeServer;
const fetchSpy = vi.fn();

function installFetch() {
  fetchSpy.mockImplementation(async (input: string, init?: RequestInit) => {
    // DATA_BASE 는 환경(.env)에 따라 /data 또는 https://cdn... 일 수 있으므로
    // 베이스와 무관하게 파일명(basename)으로 라우팅한다.
    const path = String(input).split("?")[0].split("/").pop() ?? "";

    if (path === "manifest.json") {
      if (server.manifestFail) return new Response("err", { status: 500 });
      const inm = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
      if (inm && inm === server.etag) {
        return new Response(null, { status: 304, headers: { etag: server.etag } });
      }
      return new Response(JSON.stringify(server.manifest), {
        status: 200,
        headers: { etag: server.etag, "content-type": "application/json" },
      });
    }
    if (path === "patch_version.json") {
      if (server.patchFail) return new Response("err", { status: 500 });
      return new Response(JSON.stringify(server.patch), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (path === "game_data.json") {
      return new Response(JSON.stringify(server.gameData ?? null), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // data 파일
    if (server.fileFail.has(path)) return new Response("err", { status: 500 });
    if (server.files.has(path)) {
      let body = server.files.get(path)!;
      if (server.tamper.has(path)) body = body + " "; // 1바이트 변조 → 해시 불일치
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchSpy);
}

/** 특정 data 파일이 실제로 다운로드 시도되었는지(=fetch 호출됨). */
function fetchedDataFiles(): string[] {
  return fetchSpy.mock.calls
    .map((c) => String(c[0]).split("?")[0].split("/").pop() ?? "")
    .filter((p) => p !== "manifest.json" && p !== "patch_version.json" && p !== "game_data.json");
}

const PATCH = { current_patch: "1.0", updated_at: "2026-06-18", min_app_version: "0.1.0" };

beforeEach(async () => {
  store.clear();
  fetchSpy.mockReset();
  const files = {
    "gifts.json": JSON.stringify([{ id: "gift_a" }]),
    "packs.json": JSON.stringify([{ id: "pack_a" }]),
  };
  server = {
    patch: PATCH,
    gameData: null,
    manifest: await buildManifest(files),
    etag: '"etag-v1"',
    files: new Map(Object.entries(files)),
    patchFail: false,
    manifestFail: false,
    fileFail: new Set(),
    tamper: new Set(),
  };
  // gameData 의 fetchJson 로깅이 window.location.origin 을 참조한다(node 에 없음).
  vi.stubGlobal("window", { location: { origin: "https://cdn.girey.org" } });
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** manifest.local.json 을 현재 server 상태로 미리 적용(2회차 이후 시나리오용). */
async function seedAppliedManifest() {
  store.set(
    "manifest.local.json",
    JSON.stringify({ manifest: server.manifest, etag: server.etag, applied_at: "seed" }),
  );
  for (const [name, content] of server.files) {
    store.set(name.replace(".json", ".cache.json"), content);
  }
  store.set("patch_version.cache.json", JSON.stringify(server.patch));
}

describe("매니페스트 동기화 — 정상 동작", () => {
  it("최초 실행: 매니페스트의 모든 data 파일을 받아 검증·캐시하고 manifest.local 을 적용한다", async () => {
    const result = await syncGameData();

    expect(result.fromNetwork).toBe(true);
    expect(result.gifts).toEqual([{ id: "gift_a" }]);
    expect(result.packs).toEqual([{ id: "pack_a" }]);
    // 캐시에 반영
    expect(store.get("gifts.cache.json")).toBe(server.files.get("gifts.json"));
    // manifest.local 적용됨
    const local = JSON.parse(store.get("manifest.local.json")!);
    expect(local.etag).toBe('"etag-v1"');
    expect(fetchedDataFiles().sort()).toEqual(["gifts.json", "packs.json"]);
  });

  it("변경 없음: If-None-Match 304 → data 파일 다운로드 0", async () => {
    await seedAppliedManifest();

    const result = await syncGameData();

    expect(result.fromNetwork).toBe(true);
    expect(fetchedDataFiles()).toEqual([]); // 본문 전송 0
    expect(result.gifts).toEqual([{ id: "gift_a" }]);
  });

  it("gifts 만 바뀐 패치: gifts.json 만 재다운로드(나머지 0)", async () => {
    await seedAppliedManifest();
    // 서버에서 gifts 변경 → 매니페스트/etag 갱신
    const newGifts = JSON.stringify([{ id: "gift_a" }, { id: "gift_b" }]);
    server.files.set("gifts.json", newGifts);
    server.manifest = await buildManifest(Object.fromEntries(server.files));
    server.etag = '"etag-v2"';

    const result = await syncGameData();

    expect(fetchedDataFiles()).toEqual(["gifts.json"]); // 변경분만
    expect(result.gifts).toEqual([{ id: "gift_a" }, { id: "gift_b" }]);
    expect(JSON.parse(store.get("manifest.local.json")!).etag).toBe('"etag-v2"');
  });
});

describe("§6 Offline-First / 실패 처리표", () => {
  it("[행1] manifest.json fetch 실패 → 기존 캐시로 ready, 동기화만 스킵(manifest.local 불변)", async () => {
    await seedAppliedManifest();
    server.manifestFail = true;

    const result = await syncGameData();

    expect(result.fromNetwork).toBe(true); // patch 는 받았으므로 네트워크 정상
    expect(result.gifts).toEqual([{ id: "gift_a" }]); // 기존 캐시
    // manifest.local 갱신 안 됨(동기화 스킵)
    expect(JSON.parse(store.get("manifest.local.json")!).etag).toBe('"etag-v1"');
  });

  it("[행2] JSON 다운로드 중 실패 → 롤백(매니페스트 미적용·캐시 유지), 앱은 ready", async () => {
    await seedAppliedManifest();
    // gifts 변경 유도 + 다운로드는 500 실패
    server.files.set("gifts.json", JSON.stringify([{ id: "gift_new" }]));
    server.manifest = await buildManifest(Object.fromEntries(server.files));
    server.etag = '"etag-v2"';
    server.fileFail.add("gifts.json");

    const result = await syncGameData();

    // 비치명적 — 앱은 ready, 기존 캐시로 동작
    expect(result.gifts).toEqual([{ id: "gift_a" }]);
    // 롤백: manifest.local 은 옛 etag 유지, 캐시도 옛 내용
    expect(JSON.parse(store.get("manifest.local.json")!).etag).toBe('"etag-v1"');
    expect(JSON.parse(store.get("gifts.cache.json")!)).toEqual([{ id: "gift_a" }]);
  });

  it("[행4] 무결성 검증 실패(변조/부분 전송) → 해당 파일 미적용·롤백", async () => {
    await seedAppliedManifest();
    server.files.set("gifts.json", JSON.stringify([{ id: "gift_new" }]));
    server.manifest = await buildManifest(Object.fromEntries(server.files));
    server.etag = '"etag-v2"';
    server.tamper.add("gifts.json"); // 본문 변조 → 해시 불일치

    const result = await syncGameData();

    expect(result.gifts).toEqual([{ id: "gift_a" }]); // 옛 캐시 유지
    expect(JSON.parse(store.get("manifest.local.json")!).etag).toBe('"etag-v1"'); // 미적용
  });

  it("네트워크 outage(patch fetch 실패) + 캐시 있음 → 마지막 캐시로 ready (fromNetwork=false)", async () => {
    await seedAppliedManifest();
    server.patchFail = true;

    const result = await syncGameData();

    expect(result.fromNetwork).toBe(false);
    expect(result.gifts).toEqual([{ id: "gift_a" }]);
    expect(result.patch.current_patch).toBe("1.0");
  });

  it("네트워크 outage + 캐시 없음 → throw (부팅 측에서 bootError 처리)", async () => {
    server.patchFail = true; // 캐시 비어있는 상태(beforeEach 직후)

    await expect(syncGameData()).rejects.toThrow(/불러올 수 없습니다/);
  });
});
