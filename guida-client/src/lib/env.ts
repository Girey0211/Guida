/**
 * 실행 환경 감지 유틸.
 * Tauri 데스크톱 셸 안에서 도는지, 일반 브라우저(Vite dev)인지 구분한다.
 */

/** Tauri 런타임 내부에서 실행 중인지 여부 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri v2는 `withGlobalTauri: true`일 때 window.__TAURI__ 를 주입한다.
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}
