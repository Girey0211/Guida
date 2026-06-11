import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/appStore";
import {
  downloadAndInstallUpdate,
  type UpdateProgress,
} from "@/api/appUpdate";

/** 강제 업데이트 시 안내할 수동 다운로드 페이지 */
const RELEASES_URL = "https://github.com/Girey0211/Guida/releases/latest";

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; downloaded: number; total: number | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * 강제 업데이트 게이트.
 * `update.required` 가 true 인 동안 본화면 대신 전체 화면으로 노출되어
 * 업데이트(또는 수동 다운로드)를 마칠 때까지 진입을 막는다.
 */
export function UpdateGate() {
  const { appUpdate, manualReason } = useAppStore((s) => s.update);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const startUpdate = useCallback(async () => {
    if (!appUpdate) return;
    setPhase({ kind: "downloading", downloaded: 0, total: null });
    try {
      await downloadAndInstallUpdate(appUpdate, (p: UpdateProgress) => {
        if (p.phase === "downloading")
          setPhase({ kind: "downloading", downloaded: p.downloaded, total: p.total });
        else if (p.phase === "installing") setPhase({ kind: "installing" });
      });
      // 정상 흐름에서는 relaunch 로 앱이 재시작되어 여기 도달하지 않는다.
      setPhase({ kind: "installing" });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "업데이트 중 오류가 발생했습니다.",
      });
    }
  }, [appUpdate]);

  // 자동 설치 가능한 업데이트가 있으면 진입 즉시 시작한다(정책상 강제).
  useEffect(() => {
    if (appUpdate) void startUpdate();
  }, [appUpdate, startUpdate]);

  const busy = phase.kind === "downloading" || phase.kind === "installing";

  const pct =
    phase.kind === "downloading" && phase.total
      ? Math.min(100, Math.round((phase.downloaded / phase.total) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            ⬇️ 업데이트가 필요합니다
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          {appUpdate ? (
            <>
              <p>
                새 버전{" "}
                <b className="text-foreground">v{appUpdate.version}</b> 이(가)
                있습니다 (현재 v{appUpdate.currentVersion}). 계속하려면 업데이트를
                완료해 주세요.
              </p>
              {appUpdate.notes && (
                <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">
                  {appUpdate.notes}
                </p>
              )}

              {phase.kind === "downloading" && (
                <div className="space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: pct != null ? `${pct}%` : "33%" }}
                    />
                  </div>
                  <p className="text-xs">
                    {pct != null
                      ? `다운로드 중… ${pct}% (${formatMB(phase.downloaded)} / ${formatMB(
                          phase.total!,
                        )} MB)`
                      : `다운로드 중… ${formatMB(phase.downloaded)} MB`}
                  </p>
                </div>
              )}
              {phase.kind === "installing" && (
                <p className="text-xs">설치 중… 잠시 후 앱이 자동으로 재시작됩니다.</p>
              )}
              {phase.kind === "error" && (
                <div className="space-y-2">
                  <p className="text-xs text-destructive">
                    업데이트 실패: {phase.message}
                  </p>
                  <p className="text-xs">
                    문제가 계속되면 아래 페이지에서 수동으로 설치해 주세요.
                  </p>
                  <ManualLink />
                </div>
              )}

              <div className="flex justify-end pt-1">
                <Button onClick={() => void startUpdate()} disabled={busy}>
                  {busy
                    ? "진행 중…"
                    : phase.kind === "error"
                      ? "다시 시도"
                      : "지금 업데이트"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>{manualReason ?? "최신 버전으로 업데이트가 필요합니다."}</p>
              <ManualLink />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** GitHub Releases 다운로드 페이지 안내(외부 브라우저로 열기 시도 + 복사용 URL). */
function ManualLink() {
  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => window.open(RELEASES_URL, "_blank")}>
        다운로드 페이지 열기
      </Button>
      <p className="select-all break-all text-xs text-muted-foreground">{RELEASES_URL}</p>
    </div>
  );
}
