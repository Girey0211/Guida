import { resolveImageUrl } from "@/hooks/useImageCache";
import { cn } from "@/lib/utils";

/**
 * 색상 플레이스홀더 박스 위에 얹는 기프트 이미지 오버레이.
 *
 * 부모(색상 박스)는 반드시 position:relative 여야 한다.
 * 이미지 로드에 실패하면 onError 로 스스로 숨어서, 아래의 색상 박스
 * (키워드 텍스트)가 그대로 드러난다 → 이미지가 없어도 무회귀.
 * 박스 안의 배지/오버레이는 z-10 등으로 이 이미지 위로 올려야 한다.
 */
export function GiftImageOverlay({
  imageKey,
  alt,
  className,
}: {
  imageKey: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!imageKey) return null;
  return (
    <img
      src={resolveImageUrl(imageKey) ?? undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      className={cn("absolute inset-0 size-full object-contain", className)}
    />
  );
}
