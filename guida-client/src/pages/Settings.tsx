import { Moon, RefreshCw, Copy, Check, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/store/appStore";
import { usePlayStore } from "@/store/playStore";
import { useRouteStore } from "@/store/routeStore";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { resetDeviceUuid, writeJson } from "@/lib/storage";
import { DEFAULT_SETTINGS } from "@/types/settings";

/** 앱 설정 페이지 */
export function Settings() {
  const navigate = useNavigate();
  const { settings, patch, online, updateSettings, bootstrap } = useAppStore();
  const endSession = usePlayStore((s) => s.endSession);
  const loadMyRoutes = useRouteStore((s) => s.loadMyRoutes);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const copyUuid = async () => {
    await navigator.clipboard.writeText(settings.uuid);
    setCopied(true);
    toast.success("UUID를 복사했습니다.");
    setTimeout(() => setCopied(false), 1500);
  };

  const resync = async () => {
    setSyncing(true);
    await bootstrap();
    setSyncing(false);
    toast.success("게임 데이터를 다시 동기화했습니다.");
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <PageHeader title="설정" />

      <div className="space-y-4">
        {/* 외형 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">외형</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>테마</Label>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Moon className="size-4" /> 다크 모드 전용
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>오버레이 불투명도</Label>
                <span className="text-sm text-muted-foreground">
                  {Math.round(settings.overlay_opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={settings.overlay_opacity}
                onChange={(e) => void updateSettings({ overlay_opacity: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>
          </CardContent>
        </Card>

        {/* 데이터 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">게임 데이터</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">현재 패치 버전</span>
              <Badge variant="outline">v{patch?.current_patch ?? settings.current_patch}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">서버 연결 상태</span>
              <Badge variant={online ? "success" : "warning"}>
                {online ? "온라인" : "오프라인 (캐시)"}
              </Badge>
            </div>
            <Button variant="outline" onClick={resync} disabled={syncing}>
              <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
              데이터 다시 동기화
            </Button>
          </CardContent>
        </Card>

        {/* 디바이스 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">디바이스</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>디바이스 UUID</Label>
            <p className="text-xs text-muted-foreground">
              익명 식별자입니다. 루트 추천 중복 방지에만 사용되며 개인정보를 포함하지 않습니다.
            </p>
            <button
              onClick={copyUuid}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs hover:border-primary/40"
            >
              <span className="truncate">{settings.uuid || "(생성 중)"}</span>
              {copied ? (
                <Check className="size-4 shrink-0 text-emerald-400" />
              ) : (
                <Copy className="size-4 shrink-0 text-muted-foreground" />
              )}
            </button>
            <Button
              variant="outline"
              size="sm"
              disabled={resetting}
              onClick={() => setResetModalOpen(true)}
              className="mt-2 text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive w-full gap-1.5"
            >
              <RotateCcw className="size-4" />
              디바이스 초기화
            </Button>
          </CardContent>
        </Card>

      {/* 초기화 확인 모달 */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md border border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                ⚠️ 디바이스 초기화 경고
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                원하는 초기화 방식을 선택해 주세요.
              </p>
              <div className="rounded border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive-foreground space-y-1.5">
                <p>
                  <b>• UUID만 초기화:</b> 디바이스 UUID를 새로 발급합니다. 기존에 작성하거나 추천(좋아요)했던 루트의 소유권 연결이 끊어질 수 있습니다. (변조 시도 후 기능 차단 시 해제용)
                </p>
                <p>
                  <b>• 전체 초기화:</b> 디바이스 UUID를 새로 발급하고, 저장된 모든 내 루트 목록 및 설정을 삭제하여 최초 설치 상태로 되돌립니다.
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button
                  variant="outline"
                  disabled={resetting}
                  onClick={async () => {
                    setResetting(true);
                    try {
                      await resetDeviceUuid();
                      await bootstrap();
                      toast.success("디바이스 UUID를 초기화했습니다.");
                      setResetModalOpen(false);
                    } catch (e) {
                      toast.error("UUID 초기화에 실패했습니다.");
                    } finally {
                      setResetting(false);
                    }
                  }}
                >
                  UUID만 초기화
                </Button>
                <Button
                  variant="destructive"
                  disabled={resetting}
                  onClick={async () => {
                    setResetting(true);
                    try {
                      const nextUuid = await resetDeviceUuid();

                      // 1. 내 루트 초기화
                      await writeJson("my_routes.json", { routes: [] });

                      // 2. 플레이 세션 초기화
                      await writeJson("play_session.json", null);
                      endSession();

                      // 3. 설정 초기화
                      const defaultSettings = {
                        uuid: nextUuid,
                        ...DEFAULT_SETTINGS,
                      };
                      await writeJson("user_settings.json", defaultSettings);

                      // 4. 앱 부트스트랩 및 데이터 갱신
                      await bootstrap();
                      await loadMyRoutes();

                      toast.success("모든 데이터를 초기화했습니다.");
                      setResetModalOpen(false);
                    } catch (e) {
                      toast.error("데이터 전체 초기화에 실패했습니다.");
                    } finally {
                      setResetting(false);
                    }
                  }}
                >
                  전체 초기화 (UUID + 내 루트 + 설정)
                </Button>
                <Button
                  variant="ghost"
                  disabled={resetting}
                  onClick={() => setResetModalOpen(false)}
                >
                  취소
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

        {/* 백업 및 복구 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">계정 백업 및 복구</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              기기 초기화나 PC 포맷에 대비하여, 데이터를 영지식(Zero-Knowledge) 암호화 방식으로 안전하게 백업하거나 복구합니다.
            </p>
            <Button variant="outline" onClick={() => navigate("/backup")} className="w-full">
              백업/복구 페이지로 이동
            </Button>
          </CardContent>
        </Card>

        {/* 정보 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>Guida v{settings.app_version} · MIT License</p>
            <p>본 도구는 게임을 변조하거나 입력을 자동화하지 않는 읽기 전용 설계를 따릅니다.</p>
            <p>비공식 팬 프로젝트 — Project Moon과 제휴 관계가 없습니다.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
