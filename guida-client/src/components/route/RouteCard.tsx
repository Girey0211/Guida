import { ThumbsUp, Play, Download, Layers, ShieldCheck } from "lucide-react";
import type { SharedRoute } from "@/types/route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PatchBadge } from "@/components/common/PatchBadge";

interface Props {
  route: SharedRoute;
  currentPatch: string;
  likes: number;
  plays: number;
  liked: boolean;
  /** 이미 내 루트로 가져왔거나 내가 발행한 루트 → 가져오기 비활성화 */
  saved: boolean;
  onLike: (code: string) => void;
  onImport: (code: string) => void;
  likeBusy?: boolean;
}

/** 탐색 화면의 루트 카드 */
export function RouteCard({
  route,
  currentPatch,
  likes,
  plays,
  liked,
  saved,
  onLike,
  onImport,
  likeBusy,
}: Props) {
  return (
    <Card className="flex flex-col transition-colors hover:border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{route.name}</CardTitle>
          <PatchBadge version={route.patch_version} current={currentPatch} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Badge variant="outline" className="gap-1">
            <Layers className="size-3" />
            {route.floors.length}층
          </Badge>
          <Badge variant="secondary">{route.difficulty_tag}</Badge>
          {route.verified_method === "self_report" && (
            <Badge variant="success" className="gap-1">
              <ShieldCheck className="size-3" />
              검증
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {route.target_rewards.map((r) => (
            <Badge key={r} variant="outline" className="text-[11px]">
              {r}
            </Badge>
          ))}
        </div>

        {route.memo && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{route.memo}</p>
        )}

        <div className="mt-auto flex items-center justify-between pt-1">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <ThumbsUp className="size-3.5" /> {likes}
            </span>
            <span className="flex items-center gap-1">
              <Play className="size-3.5" /> {plays}
            </span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wider">
              {route.route_code}
            </code>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={liked ? "secondary" : "outline"}
              disabled={liked || likeBusy}
              onClick={() => onLike(route.route_code)}
              title={liked ? "이미 추천함" : "추천"}
            >
              <ThumbsUp className="size-3.5" />
              {liked ? "추천함" : "추천"}
            </Button>
            <Button
              size="sm"
              variant={saved ? "secondary" : "default"}
              disabled={saved}
              onClick={() => onImport(route.route_code)}
              title={saved ? "이미 내 루트에 있습니다" : "내 루트로 가져오기"}
            >
              <Download className="size-3.5" />
              {saved ? "가져옴" : "가져오기"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
