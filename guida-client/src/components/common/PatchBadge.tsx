import { Badge } from "@/components/ui/badge";
import { patchDiff } from "@/lib/utils";

interface Props {
  /** 루트의 패치 버전 */
  version: string;
  /** 현재 패치 버전 */
  current: string;
  className?: string;
}

/**
 * 패치 버전 배지.
 * 현재 패치와 같으면 기본, 2버전 이상 오래되면 경고 색으로 "오래된 루트" 암시.
 * (Phase 3의 만료 경고 배지를 MVP에서 시각적으로 미리 반영)
 */
export function PatchBadge({ version, current, className }: Props) {
  const diff = patchDiff(current, version);
  const isCurrent = version === current;
  const isStale = diff >= 2;

  return (
    <Badge
      variant={isCurrent ? "default" : isStale ? "warning" : "secondary"}
      className={className}
      title={isCurrent ? "현재 패치" : isStale ? "오래된 루트 (2버전 이상 차이)" : "이전 패치"}
    >
      v{version}
      {isStale && " · 구버전"}
    </Badge>
  );
}
