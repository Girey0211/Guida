import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Share2, Copy, Check, ShieldCheck, ShieldAlert, Play, RefreshCw, Eye } from "lucide-react";
import type { LocalRoute, RouteDraft, SharedRoute } from "@/types/route";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { usePlayStore } from "@/store/playStore";
import { RouteEditor } from "@/components/route/RouteEditor";
import { PageHeader } from "@/components/common/PageHeader";
import { PatchBadge } from "@/components/common/PatchBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { ServerUnavailableError } from "@/api/client";
import { formatDate } from "@/lib/utils";
import * as routesApi from "@/api/routes";

type EditorState = { mode: "create" } | { mode: "edit"; route: LocalRoute } | { mode: "view"; route: LocalRoute } | null;

/** 내 루트 관리 페이지 */
export function MyRoutes() {
  const navigate = useNavigate();
  const { settings, gifts, packs, dungeonMeta } = useAppStore();
  const { myRoutes, loadMyRoutes, createRoute, updateRoute, deleteRoute, shareRoute, syncRoute } = useRouteStore();
  const startSession = usePlayStore((s) => s.startSession);
  const [editor, setEditor] = useState<EditorState>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [serverRoutes, setServerRoutes] = useState<Record<string, SharedRoute>>({});
  const [checkingCodes, setCheckingCodes] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    void loadMyRoutes();
  }, [loadMyRoutes]);

  useEffect(() => {
    const codesToFetch = myRoutes
      .map((r) => r.imported_from || r.shared_code)
      .filter((c): c is string => !!c);

    const newCodes = codesToFetch.filter(
      (code) => !serverRoutes[code] && !checkingCodes[code]
    );

    if (newCodes.length === 0) return;

    setCheckingCodes((prev) => {
      const next = { ...prev };
      for (const code of newCodes) {
        next[code] = true;
      }
      return next;
    });

    Promise.allSettled(
      newCodes.map(async (code) => {
        try {
          const shared = await routesApi.getRouteByCode(code);
          setServerRoutes((prev) => ({ ...prev, [code]: shared }));
        } catch (e) {
          console.error(`Failed to fetch server route ${code}:`, e);
        } finally {
          setCheckingCodes((prev) => ({ ...prev, [code]: false }));
        }
      })
    );
  }, [myRoutes]);

  const handlePlay = (route: LocalRoute) => {
    startSession(route.local_id);
    navigate("/play");
  };

  const handleSubmit = async (draft: RouteDraft, selfReported: boolean) => {
    if (editor?.mode === "edit") {
      await updateRoute(editor.route.local_id, draft, selfReported);
      toast.success("루트를 수정했습니다.");
    } else {
      await createRoute(draft, selfReported);
      toast.success("루트를 저장했습니다.");
    }
    setEditor(null);
  };

  const handleDelete = async (route: LocalRoute) => {
    if (!confirm(`'${route.name}' 루트를 삭제할까요?`)) return;
    await deleteRoute(route.local_id);
    toast.info("루트를 삭제했습니다.");
  };

  const handleShare = async (route: LocalRoute) => {
    setSharing(route.local_id);
    try {
      const code = await shareRoute(route.local_id);
      toast.success(`공유 완료! 코드: ${code}`);
      const updatedShared = await routesApi.getRouteByCode(code);
      setServerRoutes((prev) => ({ ...prev, [code]: updatedShared }));
    } catch (e) {
      if (e instanceof ServerUnavailableError) toast.error(e.message);
      else toast.error(e instanceof Error ? e.message : "공유에 실패했습니다.");
    } finally {
      setSharing(null);
    }
  };

  const handleCheck = async (code: string) => {
    setCheckingCodes((prev) => ({ ...prev, [code]: true }));
    try {
      const shared = await routesApi.getRouteByCode(code);
      setServerRoutes((prev) => ({ ...prev, [code]: shared }));
      toast.success("루트 서버 정보를 확인했습니다.");
    } catch (e) {
      console.error(`Failed to fetch server route ${code}:`, e);
      toast.error("서버에서 루트 정보를 가져오지 못했습니다.");
    } finally {
      setCheckingCodes((prev) => ({ ...prev, [code]: false }));
    }
  };

  const handleSync = async (route: LocalRoute) => {
    if (!route.imported_from) return;
    setSyncing(route.local_id);
    try {
      await syncRoute(route.local_id);
      toast.success(`'${route.name}' 루트를 최신 버전으로 동기화했습니다.`);
      const updatedShared = await routesApi.getRouteByCode(route.imported_from);
      setServerRoutes((prev) => ({ ...prev, [route.imported_from!]: updatedShared }));
    } catch (e) {
      toast.error("동기화 중 오류가 발생했습니다.");
    } finally {
      setSyncing(null);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    toast.success("코드를 복사했습니다.");
    setTimeout(() => setCopied(null), 1500);
  };

  // 편집/상세 정보 모드 화면
  if (editor) {
    const initial: RouteDraft | undefined =
      editor.mode === "edit" || editor.mode === "view"
        ? {
            name: editor.route.name,
            target_rewards: editor.route.target_rewards,
            floors: editor.route.floors,
            difficulty_tag: editor.route.difficulty_tag,
            route_type: editor.route.route_type,
            difficulty_mode: editor.route.difficulty_mode,
            difficulty_switch_floor: editor.route.difficulty_switch_floor,
            memo: editor.route.memo,
            gift_order: editor.route.gift_order,
            pack_order: editor.route.pack_order,
            starting_gift: editor.route.starting_gift,
            gahos: editor.route.gahos,
            restrictions: editor.route.restrictions,
            gift_dependencies: editor.route.gift_dependencies ?? [],
            deck_code: editor.route.deck_code,
          }
        : undefined;
    return (
      <div className="mx-auto max-w-4xl p-6">
        <PageHeader title={editor.mode === "edit" ? "루트 편집" : editor.mode === "view" ? "루트 상세 정보" : "새 루트 작성"} />
        <Card className="no-hover">
          <CardContent className="p-5">
            <RouteEditor
              initial={initial}
              initialSelfReported={editor.mode === "edit" || editor.mode === "view" ? editor.route.verified : false}
              gifts={gifts}
              packs={packs}
              dungeonMeta={dungeonMeta}
              onSubmit={handleSubmit}
              onCancel={() => setEditor(null)}
              readOnly={editor.mode === "view"}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="내 루트"
        action={
          <Button onClick={() => setEditor({ mode: "create" })}>
            <Plus className="size-4" />새 루트
          </Button>
        }
      />

      {myRoutes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">아직 작성한 루트가 없습니다.</p>
            <Button onClick={() => setEditor({ mode: "create" })}>
              <Plus className="size-4" />첫 루트 만들기
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {myRoutes.map((route) => (
            <Card key={route.local_id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{route.name}</CardTitle>
                  <PatchBadge version={route.patch_version} current={settings.current_patch} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="secondary">{route.difficulty_tag}</Badge>
                  <Badge variant="secondary">{route.route_type}</Badge>
                  {route.verified ? (
                    <Badge variant="success" className="gap-1">
                      <ShieldCheck className="size-3" />검증됨
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="gap-1">
                      <ShieldAlert className="size-3" />미검증
                    </Badge>
                  )}
                  <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary">
                    <Play className="size-3 fill-primary/20" />
                    플레이 {route.play_count ?? 0}회
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{formatDate(route.created_at)}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {route.target_rewards.map((r) => (
                    <Badge key={r} variant="outline" className="text-[11px]">{r}</Badge>
                  ))}
                </div>
                {route.memo && <p className="text-xs text-muted-foreground">{route.memo}</p>}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  {/* 공유 코드 */}
                  <div>
                    {route.shared_code ? (
                      <button
                        onClick={() => copyCode(route.shared_code!)}
                        className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 font-mono text-sm tracking-widest hover:border-primary/40"
                        title="코드 복사"
                      >
                        {route.shared_code}
                        {copied === route.shared_code ? (
                          <Check className="size-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">미공유</span>
                    )}
                  </div>

                  {/* 액션 */}
                  <div className="flex gap-1.5">
                    {route.imported_from ? (
                      <>
                        <Button size="sm" onClick={() => handlePlay(route)} title="이 루트로 거던 탐사 시작">
                          <Play className="size-3.5" />
                          플레이
                        </Button>
                        {(() => {
                          const code = route.imported_from!;
                          const isChecking = checkingCodes[code];
                          const serverRoute = serverRoutes[code];
                          const isSyncing = syncing === route.local_id;

                          if (isChecking) {
                            return (
                              <Button size="sm" variant="outline" disabled title="서버 버전 확인 중">
                                <RefreshCw className="size-3.5 animate-spin" />
                                확인 중...
                              </Button>
                            );
                          }

                          if (isSyncing) {
                            return (
                              <Button size="sm" variant="outline" disabled title="동기화 진행 중">
                                <RefreshCw className="size-3.5 animate-spin" />
                                동기화 중...
                              </Button>
                            );
                          }

                          if (serverRoute) {
                            const hasDiff = !areRouteFieldsEqual(route, serverRoute);
                            if (hasDiff) {
                              return (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => void handleSync(route)}
                                  title="서버에 새 버전이 있습니다. 동기화합니다."
                                >
                                  <RefreshCw className="size-3.5" />
                                  동기화
                                </Button>
                              );
                            } else {
                              return (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled
                                  className="border-emerald-500/30 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/5 disabled:opacity-100"
                                  title="최신 상태입니다 (서버 버전과 일치)"
                                >
                                  <Check className="size-3.5 text-emerald-400" />
                                  동기화 완료
                                </Button>
                              );
                            }
                          }

                          return (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleCheck(code)}
                              title="서버의 마지막 공유 버전을 확인합니다."
                            >
                              <RefreshCw className="size-3.5" />
                              동기화 확인
                            </Button>
                          );
                        })()}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditor({ mode: "view", route })}
                          title="루트 상세 정보 보기"
                        >
                          <Eye className="size-3.5" />
                          상세 정보
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(route)}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => handlePlay(route)} title="이 루트로 거던 탐사 시작">
                          <Play className="size-3.5" />
                          플레이
                        </Button>
                        {(() => {
                          const code = route.shared_code;
                          if (!code) {
                            return (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleShare(route)}
                                disabled={sharing === route.local_id || !route.verified}
                                title={route.verified ? "공유 코드 발급" : "공유하려면 검증(자기 신고)이 필요합니다"}
                              >
                                <Share2 className="size-3.5" />
                                공유
                              </Button>
                            );
                          }

                          const isChecking = checkingCodes[code];
                          const serverRoute = serverRoutes[code];
                          const isSharing = sharing === route.local_id;

                          if (isChecking) {
                            return (
                              <Button size="sm" variant="outline" disabled title="서버 버전 확인 중">
                                <RefreshCw className="size-3.5 animate-spin" />
                                재공유
                              </Button>
                            );
                          }

                          if (isSharing) {
                            return (
                              <Button size="sm" variant="outline" disabled title="재공유 업로드 중">
                                <RefreshCw className="size-3.5 animate-spin" />
                                재공유 중...
                              </Button>
                            );
                          }

                          const hasDiff = serverRoute ? !areRouteFieldsEqual(route, serverRoute) : true;

                          return (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleShare(route)}
                              disabled={!hasDiff || !route.verified}
                              title={
                                !route.verified
                                  ? "공유하려면 검증(자기 신고)이 필요합니다"
                                  : hasDiff
                                  ? "로컬 변경 사항을 서버에 재공유합니다."
                                  : "마지막으로 공유한 버전과 차이가 없습니다."
                              }
                            >
                              <Share2 className="size-3.5" />
                              재공유
                            </Button>
                          );
                        })()}
                        <Button size="sm" variant="ghost" onClick={() => setEditor({ mode: "edit", route })}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(route)}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 새 루트 작성 FAB (§11.2 섹션 A) */}
      <button
        onClick={() => setEditor({ mode: "create" })}
        title="새 루트 작성"
        className="fixed bottom-6 right-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
      >
        <Plus className="size-6" />
      </button>
    </div>
  );
}

function areRouteFieldsEqual(local: LocalRoute, shared: SharedRoute): boolean {
  if (local.name !== shared.name) return false;
  if (local.difficulty_tag !== shared.difficulty_tag) return false;
  if (local.route_type !== shared.route_type) return false;
  if (local.difficulty_mode !== shared.difficulty_mode) return false;
  if (local.difficulty_switch_floor !== shared.difficulty_switch_floor) return false;
  if (local.memo !== shared.memo) return false;
  if (local.verified_method !== shared.verified_method) return false;
  
  if (local.target_rewards.length !== shared.target_rewards.length) return false;
  for (let i = 0; i < local.target_rewards.length; i++) {
    if (local.target_rewards[i] !== shared.target_rewards[i]) return false;
  }
  
  if (local.floors.length !== shared.floors.length) return false;
  for (let i = 0; i < local.floors.length; i++) {
    if (local.floors[i] !== shared.floors[i]) return false;
  }
  
  if (local.gift_order.length !== shared.gift_order.length) return false;
  for (let i = 0; i < local.gift_order.length; i++) {
    const lg = local.gift_order[i];
    const sg = shared.gift_order[i];
    if (
      lg.gift_id !== sg.gift_id ||
      lg.priority !== sg.priority ||
      lg.floor_target !== sg.floor_target ||
      lg.difficulty !== sg.difficulty ||
      lg.required !== sg.required
    ) {
      return false;
    }
  }
  
  if (local.pack_order.length !== shared.pack_order.length) return false;
  for (let i = 0; i < local.pack_order.length; i++) {
    const lp = local.pack_order[i];
    const sp = shared.pack_order[i];
    if (
      lp.pack_id !== sp.pack_id ||
      lp.floor !== sp.floor ||
      lp.difficulty !== sp.difficulty ||
      lp.priority !== sp.priority ||
      lp.memo !== sp.memo ||
      lp.alternative !== sp.alternative
    ) {
      return false;
    }
  }
  
  return true;
}
