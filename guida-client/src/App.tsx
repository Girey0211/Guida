import { useEffect } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { Compass, LayoutDashboard, Map, FolderHeart, Settings as SettingsIcon, WifiOff } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/toast";
import { OverlayWindow } from "@/components/overlay/OverlayWindow";
import { Dashboard } from "@/pages/Dashboard";
import { Guide } from "@/pages/Guide";
import { RouteHub } from "@/pages/RouteHub";
import { MyRoutes } from "@/pages/MyRoutes";
import { Settings } from "@/pages/Settings";
import { FirstRunNotice } from "@/components/common/FirstRunNotice";

const NAV = [
  { to: "/", label: "대시보드", icon: LayoutDashboard, end: true },
  { to: "/guide", label: "거던 가이드", icon: Compass },
  { to: "/hub", label: "루트 탐색", icon: Map },
  { to: "/my-routes", label: "내 루트", icon: FolderHeart },
  { to: "/settings", label: "설정", icon: SettingsIcon },
];

function Sidebar() {
  const online = useAppStore((s) => s.online);
  const patch = useAppStore((s) => s.patch);
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="text-xl">🧭</span>
        <div>
          <h1 className="text-base font-bold leading-none">Guida</h1>
          <p className="text-[11px] text-muted-foreground">거울 던전 길잡이</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        {patch && <p>현재 패치 v{patch.current_patch}</p>}
        {!online && (
          <p className="mt-1 flex items-center gap-1 text-amber-400">
            <WifiOff className="size-3" /> 오프라인 (로컬 모드)
          </p>
        )}
        <p className="mt-1">비공식 팬 프로젝트</p>
      </div>
    </aside>
  );
}

function MainLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/hub" element={<RouteHub />} />
          <Route path="/my-routes" element={<MyRoutes />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { ready, bootError, bootstrap, settings } = useAppStore();
  const location = useLocation();
  const isOverlay = location.pathname === "/overlay";

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 테마 적용
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

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
          <div className="mb-2 text-2xl">🧭</div>
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
      <MainLayout />
      <FirstRunNotice />
      <Toaster />
    </>
  );
}
