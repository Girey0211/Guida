import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderHeart, Map, Settings as SettingsIcon, MonitorPlay, WifiOff, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { usePlayStore } from "@/store/playStore";
import { useOverlayControl } from "@/hooks/useTauriCommand";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MyRoutes } from "@/pages/MyRoutes";
import { RouteHub } from "@/pages/RouteHub";
import { Settings } from "@/pages/Settings";

type TabId = "routes" | "hub" | "settings";

const TABS: { id: TabId; label: string; icon: typeof FolderHeart }[] = [
  { id: "routes", label: "내 루트", icon: FolderHeart },
  { id: "hub", label: "루트 탐색", icon: Map },
  { id: "settings", label: "설정", icon: SettingsIcon },
];

/**
 * 기본화면 (README §11.2).
 * 상단 브랜드 바 + 탭(내 루트 / 루트 탐색 / 설정) 컨테이너.
 * 거던 탐사 세션이 살아있으면 우측 상단에 복귀 배너를 상시 노출한다.
 */
export function BaseScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("routes");
  const { patch, online } = useAppStore();
  const sessionActive = usePlayStore((s) => s.sessionId != null);
  const { showOverlay } = useOverlayControl();

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      {/* 백그라운드 앰비언트 글로우 데코 */}
      <div className="ambient-glow-1"></div>
      <div className="ambient-glow-2"></div>
      <div className="ambient-glow-3"></div>

      {/* SVG 그라데이션 선언 (Lucide 아이콘 적용용) */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="dawn-grad-svg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f39c12" />
            <stop offset="100%" stopColor="#ff4b2b" />
          </linearGradient>
        </defs>
      </svg>

      {/* 브랜드 바 (Charcoal Black) */}
      <header className="z-10 flex shrink-0 items-center gap-3 border-b border-border bg-brand/75 backdrop-blur-md px-4 py-2.5">
        <div className="leading-none">
          <h1 className="text-sm font-bold text-gradient-dawn">Guida</h1>
          <p className="text-[11px] text-muted-foreground">거울 던전 길잡이</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {patch && (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              현재 패치 v{patch.current_patch}
            </span>
          )}
          {!online && (
            <span className="flex items-center gap-1 text-[11px] text-primary">
              <WifiOff className="size-3" /> 오프라인
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void showOverlay()}>
            <MonitorPlay className="size-4" />
            오버레이
          </Button>
        </div>
      </header>

      {/* 거던 진행 중 복귀 배너 (§11.2) */}
      {sessionActive && (
        <button
          onClick={() => navigate("/play")}
          className="z-10 flex shrink-0 items-center justify-center gap-2 bg-primary/15 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/25"
        >
          거던 탐사 진행 중 — 복귀하기
          <ChevronRight className="size-4" />
        </button>
      )}

      {/* 탭 네비게이션 */}
      <nav className="z-10 flex shrink-0 gap-1 border-b border-border bg-brand/40 backdrop-blur-md px-3">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* 탭 콘텐츠 */}
      <main className="z-10 flex-1 overflow-y-auto">
        {tab === "routes" && <MyRoutes />}
        {tab === "hub" && <RouteHub />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}
