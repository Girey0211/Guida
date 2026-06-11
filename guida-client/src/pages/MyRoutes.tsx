import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Share2, Copy, Check, ShieldCheck, ShieldAlert, Play } from "lucide-react";
import type { LocalRoute, RouteDraft } from "@/types/route";
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

type EditorState = { mode: "create" } | { mode: "edit"; route: LocalRoute } | null;

/** 내 루트 관리 페이지 */
export function MyRoutes() {
  const navigate = useNavigate();
  const { settings, gifts, packs, dungeonMeta } = useAppStore();
  const { myRoutes, loadMyRoutes, createRoute, updateRoute, deleteRoute, shareRoute } = useRouteStore();
  const startSession = usePlayStore((s) => s.startSession);
  const [editor, setEditor] = useState<EditorState>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void loadMyRoutes();
  }, [loadMyRoutes]);

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
    } catch (e) {
      if (e instanceof ServerUnavailableError) toast.error(e.message);
      else toast.error(e instanceof Error ? e.message : "공유에 실패했습니다.");
    } finally {
      setSharing(null);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    toast.success("코드를 복사했습니다.");
    setTimeout(() => setCopied(null), 1500);
  };

  // 편집 모드 화면
  if (editor) {
    const initial: RouteDraft | undefined =
      editor.mode === "edit"
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
          }
        : undefined;
    return (
      <div className="mx-auto max-w-2xl p-6">
        <PageHeader title={editor.mode === "edit" ? "루트 편집" : "새 루트 작성"} />
        <Card>
          <CardContent className="p-5">
            <RouteEditor
              initial={initial}
              initialSelfReported={editor.mode === "edit" ? editor.route.verified : false}
              gifts={gifts}
              packs={packs}
              dungeonMeta={dungeonMeta}
              onSubmit={handleSubmit}
              onCancel={() => setEditor(null)}
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
                    <Button size="sm" onClick={() => handlePlay(route)} title="이 루트로 거던 탐사 시작">
                      <Play className="size-3.5" />
                      플레이
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleShare(route)}
                      disabled={sharing === route.local_id || !route.verified}
                      title={route.verified ? "공유 코드 발급" : "공유하려면 검증(자기 신고)이 필요합니다"}
                    >
                      <Share2 className="size-3.5" />
                      {route.shared_code ? "재공유" : "공유"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditor({ mode: "edit", route })}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(route)}>
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
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
