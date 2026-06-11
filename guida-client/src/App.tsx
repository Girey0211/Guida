import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { useAppStore } from "@/store/appStore";
import { Toaster } from "@/components/ui/toast";
import { OverlayWindow } from "@/components/overlay/OverlayWindow";
import { BaseScreen } from "@/pages/BaseScreen";
import { PlayScreen } from "@/pages/PlayScreen";
import { BackupScreen } from "@/pages/BackupScreen";
import { FirstRunNotice } from "@/components/common/FirstRunNotice";

export default function App() {
  const { ready, bootError, bootstrap } = useAppStore();
  const location = useLocation();
  const isOverlay = location.pathname === "/overlay";

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Guida는 다크 모드 전용 (README §12)
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // 오버레이 라우트는 레이아웃 없이 단독 렌더
  if (isOverlay) {
    return (
      <>
        <OverlayWindow />
        <Toaster />
      </>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">Guida 초기화 중…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {bootError && (
        <div className="bg-destructive/20 px-4 py-2 text-center text-xs text-destructive-foreground">
          ⚠️ {bootError}
        </div>
      )}
      <Routes>
        <Route path="/" element={<BaseScreen />} />
        <Route path="/play" element={<PlayScreen />} />
        <Route path="/backup" element={<BackupScreen />} />
      </Routes>
      <FirstRunNotice />
      <Toaster />
    </>
  );
}
