import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FolderHeart, Map, Settings as SettingsIcon, MonitorPlay, WifiOff, ChevronRight, MousePointerClick, MousePointer2, User, ClipboardList } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { usePlayStore } from "@/store/playStore";
import { useOverlayControl } from "@/hooks/useTauriCommand";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MyRoutes } from "@/pages/MyRoutes";
import { RouteHub } from "@/pages/RouteHub";
import { Settings } from "@/pages/Settings";
import { UserProfile } from "@/pages/UserProfile";
import { PatchNotesModal } from "@/components/common/PatchNotesModal";

type TabId = "routes" | "hub" | "profile" | "settings";

const TABS: { id: TabId; label: string; icon: typeof FolderHeart }[] = [
  { id: "routes", label: "내 루트", icon: FolderHeart },
  { id: "hub", label: "루트 탐색", icon: Map },
  { id: "profile", label: "내 프로필", icon: User },
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
  const [activeProfileUuid, setActiveProfileUuid] = useState<string | null>(null);
  const [patchNotesOpen, setPatchNotesOpen] = useState(false);
  const { patch, online } = useAppStore();
  const sessionActive = usePlayStore((s) => s.sessionId != null);
  const { showOverlay, hideOverlay, setOverlayClickThrough, isDesktop } = useOverlayControl();

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayClickThrough, setOverlayClickThroughState] = useState(false);

  // B-1: 백업 복구 직후 진입하면 설정 탭으로 이동해 키 갱신/이관을 권한다.
  // (플래그 소비는 Settings 가 처리하므로 여기서는 지우지 않는다.)
  useEffect(() => {
    if (sessionStorage.getItem("guida:suggest-key-rotation") === "1") {
      setTab("settings");
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;

    // 초기 상태 확인
    const checkInitialState = async () => {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const overlay = await WebviewWindow.getByLabel("overlay");
        if (overlay) {
          const visible = await overlay.isVisible();
          setOverlayOpen(visible);
        }
      } catch (e) {
        console.error(e);
      }
    };
    void checkInitialState();

    let unlistenStatus: (() => void) | null = null;
    let unlistenClickThrough: (() => void) | null = null;

    const setupListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const uStatus = await listen<{ visible: boolean }>("overlay-status-changed", (e) => {
        setOverlayOpen(e.payload.visible);
      });
      unlistenStatus = uStatus;

      const uClickThrough = await listen<{ clickThrough: boolean }>("overlay-click-through-state", (e) => {
        setOverlayClickThroughState(e.payload.clickThrough);
      });
      unlistenClickThrough = uClickThrough;
    };

    void setupListeners();

    return () => {
      if (unlistenStatus) unlistenStatus();
      if (unlistenClickThrough) unlistenClickThrough();
    };
  }, [isDesktop]);

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
        <div className="flex items-center gap-3">
          <div className="leading-none">
            <h1 className="text-sm font-bold text-gradient-dawn">Guida</h1>
            <p className="text-[11px] text-muted-foreground">거울 던전 길잡이</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPatchNotesOpen(true)}
            className="h-8 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 gap-1.5 rounded-lg border border-border/30 bg-muted/10 transition-all duration-200"
            title="패치노트 보기"
          >
            <ClipboardList className="size-3.5" />
            <span>패치노트</span>
          </Button>
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
          {isDesktop && overlayOpen ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1 mr-1">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                오버레이
              </span>
              <Button
                size="sm"
                variant={overlayClickThrough ? "destructive" : "outline"}
                onClick={() => void setOverlayClickThrough(!overlayClickThrough)}
                className="h-7 px-2 text-xs gap-1 font-medium"
                title={overlayClickThrough ? "마우스 클릭이 관통되는 고정 상태를 해제합니다. (단축키 F9)" : "마우스 클릭이 통과되도록 오버레이를 화면에 고정합니다. (단축키 F9)"}
              >
                {overlayClickThrough ? (
                  <>
                    <MousePointerClick className="size-3" />
                    고정 해제
                  </>
                ) : (
                  <>
                    <MousePointer2 className="size-3" />
                    화면 고정
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void hideOverlay()}
                className="h-7 px-2 text-xs font-medium hover:bg-destructive/10 hover:text-destructive"
              >
                닫기
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void showOverlay()} className="gap-1.5">
              <MonitorPlay className="size-4" />
              오버레이
            </Button>
          )}
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
                : "border-transparent text-muted-foreground hover:text-foreground transition-colors",
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
        {tab === "hub" && <RouteHub onShowProfile={setActiveProfileUuid} />}
        {tab === "profile" && <UserProfile uuid="me" isTab={true} onShowProfile={setActiveProfileUuid} />}
        {tab === "settings" && <Settings />}
      </main>

      {/* 타인 프로필 모달 팝업 */}
      {activeProfileUuid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto border border-border bg-background/95 backdrop-blur-md rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
            <UserProfile
              uuid={activeProfileUuid}
              onClose={() => setActiveProfileUuid(null)}
              onShowProfile={setActiveProfileUuid}
            />
          </div>
        </div>
      )}

      {/* 패치노트 모달 */}
      {patchNotesOpen && (
        <PatchNotesModal onClose={() => setPatchNotesOpen(false)} />
      )}
    </div>
  );
}
