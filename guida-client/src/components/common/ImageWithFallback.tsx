import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/hooks/useImageCache";

interface Props {
  /** 이미지 파일명 또는 절대 URL */
  src?: string;
  /** 대체 텍스트 / fallback 타이틀 */
  alt: string;
  className?: string;
}

/**
 * 지연 로딩 + Fallback 이미지 컴포넌트 (README 7.5).
 * 로드 실패 시 앱 중단 없이 텍스트 타이틀 + 아이콘으로 대체한다.
 */
export function ImageWithFallback({ src, alt, className }: Props) {
  const url = resolveImageUrl(src);
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/40 p-2 text-center",
          className,
        )}
        title={alt}
      >
        <ImageOff className="size-4 text-muted-foreground" />
        <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("rounded-md object-cover", className)}
    />
  );
}
