import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCachedImage } from "@/hooks/useImageCache";

interface Props {
  /** 이미지 파일명(= image_key, `<gift_id>.webp`) 또는 절대 URL */
  src?: string;
  /** 대체 텍스트 / fallback 타이틀 */
  alt: string;
  className?: string;
}

/**
 * 지연 로딩 + Fallback 이미지 컴포넌트 (README 7.5, phase2 dev plan §4).
 * content-addressed 캐시로 해석하며, 해석 중에는 빈 자리를 두고, 실패 시
 * 앱 중단 없이 텍스트 타이틀 + 아이콘(KeywordBadge 류 폴백)으로 대체한다.
 */
export function ImageWithFallback({ src, alt, className }: Props) {
  const { src: url, loading } = useCachedImage(src);
  const [failed, setFailed] = useState(false);

  // 해석 중에는 폴백 깜빡임을 피하기 위해 빈 자리를 유지한다.
  if (loading) {
    return <div className={cn("rounded-md bg-muted/40", className)} title={alt} />;
  }

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
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("rounded-md object-cover", className)}
    />
  );
}
