import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 클래스 병합 (shadcn/ui 표준 헬퍼) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 6자리 영숫자 난수 코드 생성 (예: X7R2B9). 혼동 문자(0/O,1/I) 제외 */
export function generateShareCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** 로컬 루트 ID 생성 */
export function generateLocalId(): string {
  return `route_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 브라우저 환경용 UUID v4 폴백 생성기 */
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // 매우 오래된 환경용 폴백
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** ISO 날짜를 'YYYY-MM-DD' 형태로 간단 포맷 */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/** 두 패치 버전(예: "2.4", "2.2")의 마이너 차이를 반환 (a - b) */
export function patchDiff(a: string, b: string): number {
  const pa = parseFloat(a);
  const pb = parseFloat(b);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return 0;
  // 0.1 단위 패치를 정수 거리로 환산
  return Math.round((pa - pb) * 10);
}
