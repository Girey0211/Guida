import { useCachedImage } from "@/hooks/useImageCache";
import { cn } from "@/lib/utils";

/**
 * 색상 플레이스홀더 박스 위에 얹는 기프트 이미지 오버레이.
 *
 * 부모(색상 박스)는 반드시 position:relative 여야 한다.
 * content-addressed 캐시(매니페스트 해시 기반)로 해석하며, 해석 불가(매니페스트
 * 미수록·다운로드/검증 실패)면 아무것도 렌더하지 않아 아래 색상 박스(키워드
 * 텍스트)가 그대로 드러난다 → 이미지가 없어도 무회귀.
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
  const { src } = useCachedImage(imageKey);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      className={cn("absolute inset-0 size-full object-contain", className)}
    />
  );
}
