import { useEffect, useMemo, useState } from "react";
import { Search, Download, RefreshCw } from "lucide-react";
import type { RouteFilterState } from "@/types/filter";
import { DEFAULT_FILTER } from "@/types/filter";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { useRouteFilter, routeStats } from "@/hooks/useRouteFilter";
import { likedCodes, ApiError } from "@/api/routes";
import { ServerUnavailableError } from "@/api/client";
import { RouteCard } from "@/components/route/RouteCard";
import { RouteFilter } from "@/components/route/RouteFilter";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

/** 루트 공유 허브 (탐색) 페이지 */
export function RouteHub() {
  const { uuid, settings, gameData } = useAppStore();
  const { hubRoutes, myRoutes, loadingHub, hubError, loadHub, loadMyRoutes, likeHubRoute, importByCode } =
    useRouteStore();
  const [filter, setFilter] = useState<RouteFilterState>(DEFAULT_FILTER);
  const [code, setCode] = useState("");
  const [likeBusy, setLikeBusy] = useState<string | null>(null);

  const currentPatch = settings.current_patch;

  useEffect(() => {
    void loadHub();
    void loadMyRoutes();
  }, [loadHub, loadMyRoutes]);

  // 이미 내 루트로 가져왔거나(import) 내가 발행한(share) 루트의 코드 집합
  const savedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const r of myRoutes) {
      if (r.shared_code) set.add(r.shared_code);
      if (r.imported_from) set.add(r.imported_from);
    }
    return set;
  }, [myRoutes]);

  const liked = likedCodes(uuid, currentPatch);
  const filtered = useRouteFilter(hubRoutes, filter, currentPatch, savedCodes);

  const availablePatches = useMemo(
    () => [...new Set(hubRoutes.map((r) => r.patch_version))].sort().reverse(),
    [hubRoutes],
  );

  const handleLike = async (c: string) => {
    setLikeBusy(c);
    try {
      await likeHubRoute(c);
      toast.success("추천했습니다. 고마워요!");
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE") toast.error("이미 추천한 루트입니다.");
      else if (e instanceof ServerUnavailableError) toast.error(e.message);
      else toast.error("추천 처리 중 오류가 발생했습니다.");
    } finally {
      setLikeBusy(null);
    }
  };

  const handleImport = async (c: string) => {
    if (savedCodes.has(c)) return toast.info("이미 내 루트로 가져온 루트입니다.");
    try {
      const r = await importByCode(c);
      toast.success(`'${r.name}'을(를) 내 루트로 가져왔습니다.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_FOUND") toast.error("루트를 찾을 수 없습니다.");
      else toast.error("가져오기에 실패했습니다.");
    }
  };

  const handleCodeSearch = async () => {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return toast.error("6자리 코드를 입력해 주세요.");
    await handleImport(c);
    setCode("");
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader
        title="루트 탐색"
        description="다른 유저가 공유한 거던 파밍 루트를 찾아보세요."
        action={
          <Button variant="outline" onClick={() => void loadHub()} disabled={loadingHub}>
            <RefreshCw className={loadingHub ? "size-4 animate-spin" : "size-4"} />
            새로고침
          </Button>
        }
      />

      {/* 코드 직접 입력 */}
      <div className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && handleCodeSearch()}
          placeholder="6자리 코드로 바로 가져오기 (예: X7R2B9)"
          maxLength={6}
          className="font-mono tracking-widest"
        />
        <Button onClick={handleCodeSearch}>
          <Download className="size-4" />
          가져오기
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* 필터 */}
        <RouteFilter
          filter={filter}
          onChange={setFilter}
          currentPatch={currentPatch}
          availablePatches={availablePatches}
          targetRewards={gameData?.targetRewards ?? []}
        />

        {/* 결과 */}
        <div>
          {hubError && (
            <p className="mb-3 rounded-md bg-destructive/15 p-3 text-sm text-destructive-foreground">
              ⚠️ {hubError}
            </p>
          )}
          <p className="mb-3 text-sm text-muted-foreground">{filtered.length}개의 루트</p>
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              조건에 맞는 루트가 없습니다. 필터를 조정해 보세요.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((route) => {
                const { likes, plays } = routeStats(route, filter, currentPatch);
                return (
                  <RouteCard
                    key={route.route_code}
                    route={route}
                    currentPatch={currentPatch}
                    likes={likes}
                    plays={plays}
                    liked={liked.has(route.route_code)}
                    saved={savedCodes.has(route.route_code)}
                    likeBusy={likeBusy === route.route_code}
                    onLike={handleLike}
                    onImport={handleImport}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
