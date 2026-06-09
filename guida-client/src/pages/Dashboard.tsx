import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, Map, FolderHeart, MonitorPlay, ThumbsUp, Play } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { useOverlayControl } from "@/hooks/useTauriCommand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";

/** 메인 대시보드 */
export function Dashboard() {
  const navigate = useNavigate();
  const { patch, gameData, online } = useAppStore();
  const { myRoutes, loadMyRoutes } = useRouteStore();
  const { showOverlay } = useOverlayControl();

  useEffect(() => {
    void loadMyRoutes();
  }, [loadMyRoutes]);

  const sharedCount = myRoutes.filter((r) => r.shared_code).length;
  const verifiedCount = myRoutes.filter((r) => r.verified).length;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="대시보드"
        description="거울 던전 가이드와 루트를 한눈에 관리하세요."
      />

      {/* 빠른 시작 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MonitorPlay className="size-4 text-primary" />
              오버레이 가이드 시작
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              게임 위에 실시간 선택지 가이드를 띄웁니다. 클릭 관통을 켜면 게임 조작을 방해하지 않습니다.
            </p>
            <Button onClick={() => void showOverlay()}>
              <MonitorPlay className="size-4" />
              오버레이 열기
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Compass className="size-4" />
              거던 선택지 가이드
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              파밍 목표를 정하면 층별 최적 선택지를 추천합니다.
            </p>
            <Button variant="outline" onClick={() => navigate("/guide")}>
              가이드 보기
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 요약 통계 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="내 루트" value={myRoutes.length} icon={<FolderHeart className="size-4" />} />
        <StatCard label="검증됨" value={verifiedCount} icon={<ThumbsUp className="size-4" />} />
        <StatCard label="공유됨" value={sharedCount} icon={<Map className="size-4" />} />
        <StatCard
          label="이벤트 DB"
          value={gameData?.events.length ?? 0}
          icon={<Play className="size-4" />}
        />
      </div>

      {/* 상태 */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {patch && <Badge variant="outline">현재 패치 v{patch.current_patch}</Badge>}
        <Badge variant={online ? "success" : "warning"}>
          {online ? "온라인 (서버 동기화됨)" : "오프라인 (로컬 캐시 모드)"}
        </Badge>
        {patch?.note && <span>· {patch.note}</span>}
      </div>

      {/* 바로가기 */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => navigate("/hub")}>
          <Map className="size-4" />
          루트 탐색하러 가기
        </Button>
        <Button variant="secondary" onClick={() => navigate("/my-routes")}>
          <FolderHeart className="size-4" />
          내 루트 만들기
        </Button>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <p className="text-xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
