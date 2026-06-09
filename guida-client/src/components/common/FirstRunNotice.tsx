import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEEN_KEY = "guida:fan-notice-acked";

/**
 * 최초 실행 시 비공식 팬 프로젝트 고지 팝업 (README 10.3 필수 요구사항).
 * 한 번 확인하면 다시 표시하지 않는다.
 */
export function FirstRunNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
  }, []);

  if (!open) return null;

  const ack = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">⚠️ 비공식 팬 프로젝트 고지</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            본 프로그램은 Project Moon의 팬이 제작한 <b className="text-foreground">비공식 서드파티 도구</b>입니다.
            림버스 컴퍼니의 저작권 및 지식재산권 일체는 <b className="text-foreground">Project Moon</b>에 귀속됩니다.
          </p>
          <p>
            본 도구는 게임을 변조하거나 입력을 자동화하지 않는 <b className="text-foreground">읽기 전용(Read-Only)</b> 설계를 따릅니다.
            Project Moon과 어떠한 제휴·후원 관계도 없습니다.
          </p>
          <div className="flex justify-end pt-1">
            <Button onClick={ack}>확인했습니다</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
