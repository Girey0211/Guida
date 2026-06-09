import { Moon, Sun, RefreshCw, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/store/appStore";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";

/** 앱 설정 페이지 */
export function Settings() {
  const { settings, patch, online, setTheme, updateSettings, bootstrap } = useAppStore();
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
      <PageHeader title="설정" description="앱 환경과 오버레이를 설정합니다." />

      <div className="space-y-4">
        {/* 외형 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">외형</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>테마</Label>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={settings.theme === "dark" ? "default" : "outline"}
                  onClick={() => void setTheme("dark")}
                >
                  <Moon className="size-4" /> 다크
                </Button>
                <Button
                  size="sm"
                  variant={settings.theme === "light" ? "default" : "outline"}
                  onClick={() => void setTheme("light")}
                >
                  <Sun className="size-4" /> 라이트
                </Button>
              </div>
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
