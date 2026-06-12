import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/appStore";

/**
 * 서버(게임 데이터 / 업데이트) 연결 실패 안내 팝업.
 *
 * 부팅 시 서버에 연결하지 못하면(`online === false`) 강제 업데이트 게이트를
 * 생략하고 현재(캐시) 버전으로 그대로 띄운다(appStore.bootstrap). 이때 사용자가
 * 영문을 모르지 않도록, 서버에 연결할 수 없어 현재 버전으로 진행 중임을 알린다.
 * 확인을 누르면 사라지며 그대로 앱을 사용할 수 있다.
 */
export function ServerUnavailableNotice() {
  const ready = useAppStore((s) => s.ready);
  const online = useAppStore((s) => s.online);
  const [dismissed, setDismissed] = useState(false);

  // 부팅이 끝났고(ready) 오프라인일 때만 1회 노출
  if (!ready || online || dismissed) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">📡 서버에 연결할 수 없습니다</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            서버에 연결할 수 없어 최신 데이터와 업데이트를 확인하지 못했습니다.{" "}
            <b className="text-foreground">현재 버전</b>으로 계속 진행합니다.
          </p>
          <p>네트워크 상태를 확인한 뒤 앱을 다시 시작하면 자동으로 최신 버전을 받아옵니다.</p>
          <div className="flex justify-end pt-1">
            <Button onClick={() => setDismissed(true)}>확인</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
