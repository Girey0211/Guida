/**
 * 가이다 앱 자동 업데이트 API (Tauri updater 플러그인 래퍼).
 *
 * 배포 구조(하이브리드):
 *  - 앱 바이너리·서명·매니페스트(latest.json)는 GitHub Releases에 둔다.
 *    Tauri updater 가 이 매니페스트를 읽어 최신 여부를 판정·다운로드·설치한다.
 *  - 서버의 `min_app_version`(patch_version.json)은 긴급 강제 차단용 비상 레버다
 *    (이 모듈이 아니라 appStore 게이트에서 사용).
 *
 * 브라우저(Vite dev)에서는 모든 함수가 안전하게 no-op/null 로 폴백한다.
 */

import { isTauri } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface AppUpdateInfo {
  /** 다운로드 가능한 최신 버전 */
  version: string;
  /** 현재 실행 중인 버전 */
  currentVersion: string;
  /** 릴리스 노트(매니페스트 body) */
  notes?: string;
  /** 릴리스 일시 */
  date?: string;
  /** 내부 Update 핸들 (downloadAndInstallUpdate 에 그대로 전달) */
  _handle: unknown;
}

export type UpdateProgress =
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" }
  | { phase: "done" };

/** 현재 실행 중인 앱 버전을 반환한다. 브라우저/실패 시 fallback. */
export async function getCurrentAppVersion(fallback: string): Promise<string> {
  if (!isTauri()) return fallback;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch (e) {
    console.warn("[appUpdate] 앱 버전 조회 실패 — fallback 사용", e);
    return fallback;
  }
}

/**
 * GitHub Releases 매니페스트를 확인해 설치 가능한 업데이트가 있으면 반환한다.
 * 최신이거나(=null), 매니페스트 미게시/네트워크 실패 시 null.
 */
export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  if (!isTauri()) return null;
  await logger.info("Update", "Checking for app updates...");
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      await logger.info("Update", "Checked for app updates: Already up-to-date");
      return null;
    }
    await logger.info("Update", `New app update available: ${update.currentVersion} -> ${update.version}`);
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
      _handle: update,
    };
  } catch (e) {
    // 릴리스 미게시(404)·오프라인 등은 "업데이트 없음"으로 폴백한다.
    await logger.warn("Update", "Failed to check for app updates (falling back to no updates)", e);
    return null;
  }
}

/**
 * 업데이트를 다운로드·설치한 뒤 앱을 재시작한다.
 * 정상 동작 시 relaunch 로 인해 이 Promise 는 resolve 되지 않고 앱이 재시작된다.
 */
export async function downloadAndInstallUpdate(
  info: AppUpdateInfo,
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  const { Update } = await import("@tauri-apps/plugin-updater");
  const update = info._handle as InstanceType<typeof Update>;

  let downloaded = 0;
  let total: number | null = null;

  await logger.info("Update", `Starting update download: ${info.currentVersion} -> ${info.version}`);

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.({ phase: "downloading", downloaded: 0, total });
        void logger.info("Update", `Download started. Total size: ${total ?? "unknown"} bytes`);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ phase: "downloading", downloaded, total });
        break;
      case "Finished":
        onProgress?.({ phase: "installing" });
        void logger.info("Update", "Download finished. Installing update...");
        break;
    }
  });

  onProgress?.({ phase: "done" });
  await logger.info("Update", "Update installed successfully. Relaunching application...");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
