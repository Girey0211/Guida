import { Moon, RefreshCw, Copy, Check, FolderOpen, Trash2, FileText, KeyRound, ShieldAlert } from "lucide-react";
import { useState, useEffect } from "react";
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
import { resetDeviceUuid, writeJson, readFile } from "@/lib/storage";
import * as routesApi from "@/api/routes";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { IS_LOGGING_ENABLED } from "@/lib/logger";
import { isTauri } from "@/lib/env";

/** 앱 설정 페이지 */
export function Settings() {
  const navigate = useNavigate();
  const { settings, patch, online, updateSettings, bootstrap } = useAppStore();
  const endSession = usePlayStore((s) => s.endSession);
  const loadMyRoutes = useRouteStore((s) => s.loadMyRoutes);
  const [syncing, setSyncing] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [migrateModalOpen, setMigrateModalOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  // 백업 복구 직후 자동 유도로 모달이 열렸는지(추가 안내 문구 노출용).
  const [cameFromRecovery, setCameFromRecovery] = useState(false);

  // B-1: 복구 직후 진입(BackupScreen→BaseScreen→설정 탭)이면 키 갱신을 자동 권유한다.
  useEffect(() => {
    if (isTauri() && sessionStorage.getItem("guida:suggest-key-rotation") === "1") {
      sessionStorage.removeItem("guida:suggest-key-rotation");
      setCameFromRecovery(true);
      setMigrateModalOpen(true);
    }
  }, []);

  const [copyingLogs, setCopyingLogs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);

  const openLogFolder = async () => {
    if (!isTauri()) {
      toast.error("웹 브라우저 환경에서는 로컬 폴더를 열 수 없습니다.");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_log_dir");
      toast.success("로그 디렉토리를 열었습니다.");
    } catch (e) {
      toast.error("로그 디렉토리를 여는데 실패했습니다.");
    }
  };

  const copyLogs = async () => {
    setCopyingLogs(true);
    try {
      let logContent = "";
      if (isTauri()) {
        const currentLogs = await readFile("requests.log");
        const oldLogs = await readFile("requests.log.old");
        if (oldLogs) {
          logContent += `=== OLD LOGS ===\n${oldLogs}\n\n`;
        }
        if (currentLogs) {
          logContent += `=== CURRENT LOGS ===\n${currentLogs}`;
        }
      } else {
        const browserLogs = localStorage.getItem("guida:logs") ?? "[]";
        try {
          const parsed = JSON.parse(browserLogs) as string[];
          logContent = parsed.join("\n");
        } catch {
          logContent = browserLogs;
        }
      }

      if (!logContent.trim()) {
        toast.info("기록된 로그가 없습니다.");
        return;
      }

      await navigator.clipboard.writeText(logContent);
      setLogsCopied(true);
      toast.success("로그를 클립보드에 복사했습니다.");
      setTimeout(() => setLogsCopied(false), 1500);
    } catch (e) {
      toast.error("로그 복사에 실패했습니다.");
    } finally {
      setCopyingLogs(false);
    }
  };

  const clearLogs = async () => {
    setClearingLogs(true);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("write_data_file", { name: "requests.log", content: "" });
        await invoke("write_data_file", { name: "requests.log.old", content: "" });
      } else {
        localStorage.removeItem("guida:logs");
      }
      toast.success("로그 기록을 비웠습니다.");
    } catch (e) {
      toast.error("로그 초기화에 실패했습니다.");
    } finally {
      setClearingLogs(false);
    }
  };

  const resync = async () => {
    setSyncing(true);
    await bootstrap();
    setSyncing(false);
    toast.success("게임 데이터를 다시 동기화했습니다.");
  };

  // 보안 키 갱신 및 이관(B-1): 신규 키를 발급하고 구/신 이중 서명으로 서버 데이터
  // 소유권을 신규 키로 옮긴 뒤, 로컬 신원/암호화 키를 신규 키로 교체한다.
  const rotateKey = async () => {
    if (!isTauri()) {
      toast.error("보안 키 갱신은 데스크톱 앱에서만 지원됩니다.");
      return;
    }
    setMigrating(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const req = await invoke<routesApi.MigrationRequest>("begin_key_migration");
      await routesApi.migrateIdentity(req); // 서버 이관(실패 시 throw)
      await invoke("commit_key_migration"); // 로컬 신원 교체 + my_routes 재암호화
      await bootstrap();
      await loadMyRoutes();
      setMigrateModalOpen(false);
      toast.success("보안 키를 갱신하고 데이터를 이관했습니다.");
    } catch (e) {
      // 서버 이관 실패 시 임시 보관한 신규 신원을 폐기(로컬 신원 불변).
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("abort_key_migration");
      } catch {
        /* ignore */
      }
      toast.error(e instanceof Error ? e.message : "보안 키 갱신에 실패했습니다.");
    } finally {
      setMigrating(false);
    }
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

        {/* 보안 키 갱신 및 이관 (B-1) */}
        {isTauri() && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-1.5">
                <KeyRound className="size-4" /> 보안 인증 키 갱신 및 이관
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                기기 식별 키가 유출되었거나 의심될 때, 새 보안 키를 발급하고 내 루트·추천·프로필을
                새 신원으로 안전하게 옮깁니다. 이전 키는 영구 폐기되어 더 이상 사용할 수 없습니다.
              </p>
              <Button
                variant="outline"
                onClick={() => setMigrateModalOpen(true)}
                disabled={migrating}
                className="w-full gap-1.5"
              >
                <KeyRound className="size-4" />
                {migrating ? "키 갱신 진행 중..." : "보안 키 갱신 및 이관"}
              </Button>
            </CardContent>
          </Card>
        )}

        {migrateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <Card className="w-full max-w-md border-primary/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-1.5">
                  <KeyRound className="size-4" /> 보안 키 갱신 확인
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cameFromRecovery && (
                  <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-500/90">
                    <ShieldAlert className="size-4 shrink-0" />
                    <span>
                      복구된 보안 키는 백업 코드를 아는 사람에게 노출됐을 수 있습니다. 안전을 위해
                      지금 새 키로 갱신·이관하는 것을 권장합니다. 이전 키는 영구 폐기됩니다.
                    </span>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  새 보안 키를 발급하고 서버의 내 데이터(루트·추천·프로필)를 새 신원으로 이관합니다.
                  이전 키는 <b>영구 폐기</b>되며 되돌릴 수 없습니다. 진행하기 전에 백업을 권장합니다.
                </p>
                <div className="flex flex-col gap-2">
                  <Button disabled={migrating} onClick={rotateKey}>
                    {migrating ? "진행 중..." : "갱신 및 이관 진행"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={migrating}
                    onClick={() => {
                      setMigrateModalOpen(false);
                      setCameFromRecovery(false);
                    }}
                  >
                    {cameFromRecovery ? "나중에 하기" : "취소"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 로그 관리 (VITE_ENABLE_LOGGING이 true일 때만 노출) */}
        {IS_LOGGING_ENABLED && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-1.5">
                <FileText className="size-4" /> 로그 관리 (Alpha)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                API 요청 및 시스템 동작 상태 로그를 확인하고 관리합니다. 오늘 찍힌 로그가 아니면 앱 실행 시 자동으로 비워집니다.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={copyLogs} disabled={copyingLogs} className="gap-1.5">
                  {logsCopied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                  로그 복사
                </Button>
                <Button variant="outline" size="sm" onClick={clearLogs} disabled={clearingLogs} className="text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive gap-1.5">
                  <Trash2 className="size-4" />
                  로그 비우기
                </Button>
              </div>
              {isTauri() && (
                <Button variant="outline" size="sm" onClick={openLogFolder} className="w-full gap-1.5">
                  <FolderOpen className="size-4" />
                  로그 저장 폴더 열기
                </Button>
              )}
            </CardContent>
          </Card>
        )}

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
