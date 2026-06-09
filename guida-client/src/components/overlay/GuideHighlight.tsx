import { Sparkles, AlertTriangle } from "lucide-react";
import type { EventChoice } from "@/types/gameData";
import { cn } from "@/lib/utils";
import { ImageWithFallback } from "@/components/common/ImageWithFallback";

interface Props {
  choice: EventChoice;
  /** 이 선택지가 현재 목표에 추천되는지 (하이라이트 대상) */
  recommended: boolean;
  /** 추천 중 최선의 선택지인지 */
  best: boolean;
  /** 현재 목표 재화 */
  target: string;
}

/** 단일 선택지 하이라이트 카드 (오버레이/가이드 공용) */
export function GuideHighlight({ choice, recommended, best, target }: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        best
          ? "border-primary bg-primary/15 ring-1 ring-primary/50"
          : recommended
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-card/60",
      )}
    >
      <div className="flex items-start gap-2">
        {best && <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />}
        <div className="flex-1">
          <p className={cn("text-sm leading-snug", best && "font-semibold text-primary")}>
            {choice.label}
          </p>

          {/* 보상 */}
          {choice.rewards.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {choice.rewards.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs",
                    r.item === target ? "border-primary/50 bg-primary/10" : "border-border",
                  )}
                >
                  <ImageWithFallback src={r.image} alt={r.item} className="size-7" />
                  <span>
                    {r.item}
                    {r.amount != null && <b className="ml-0.5 text-primary">×{r.amount}</b>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 위험 요소 */}
          {choice.risk && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="size-3" />
              {choice.risk}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
