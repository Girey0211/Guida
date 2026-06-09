/**
 * Tauri IPC / 창 제어 훅.
 *
 * 오버레이 창 토글, 클릭 관통(click-through) 설정 등 데스크톱 전용 동작을
 * 캡슐화한다. 브라우저(Vite dev) 환경에서는 안전하게 no-op 하거나 새 탭/해시
 * 라우팅으로 대체하여 검증을 가능케 한다.
 */

import { useCallback } from "react";
import { isTauri } from "@/lib/env";

export function useOverlayControl() {
  /** 오버레이 창 표시 */
  const showOverlay = useCallback(async () => {
    if (!isTauri()) {
      // 브라우저: 오버레이 라우트를 새 창으로
      window.open(`${location.origin}${location.pathname}#/overlay`, "guida-overlay", "width=420,height=560");
      return;
    }
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const overlay = await WebviewWindow.getByLabel("overlay");
    await overlay?.show();
    await overlay?.setAlwaysOnTop(true);
  }, []);

  /** 오버레이 창 숨김 */
  const hideOverlay = useCallback(async () => {
    if (!isTauri()) return;
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const overlay = await WebviewWindow.getByLabel("overlay");
    await overlay?.hide();
  }, []);

  /** 클릭 관통 토글 (true면 마우스 이벤트가 게임으로 통과) */
  const setClickThrough = useCallback(async (ignore: boolean) => {
    if (!isTauri()) return;
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().setIgnoreCursorEvents(ignore);
  }, []);

  return { showOverlay, hideOverlay, setClickThrough, isDesktop: isTauri() };
}
