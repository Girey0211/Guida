import { isTauri } from "./env";

/** 로그 기능 빌드 설정 제어 플래그 */
export const IS_LOGGING_ENABLED = import.meta.env.VITE_ENABLE_LOGGING === "true";

// ── 민감정보 레다크션 ────────────────────────────────────────────────────────
//  open_log_dir 로 열람/공유 가능한 로그에 raw device_uuid(=서명 시드) 및 비밀
//  필드가 평문으로 남지 않도록, 기록 직전 중앙에서 마스킹한다.
//   - UUID 패턴 문자열 → <uuid> (uploader_uuid 도 안전측으로 함께 마스킹)
//   - 알려진 비밀 키(device_uuid/recovery_code/signature/seed 등) → <redacted>
//   - 과도하게 긴 문자열(요청 바디 등) → 길이 절단
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SECRET_KEYS = new Set([
  "uuid",
  "device_uuid",
  "device-uuid",
  "uuid_sig",
  "recovery_code",
  "recovery_code_hash",
  "recoverycode",
  "signature",
  "x-guida-signature",
  "encrypted_blob",
  "privkey",
  "private_key",
  "seed",
]);
const MAX_LOG_STRING = 256;

function redactString(s: string): string {
  return s.replace(UUID_RE, "<uuid>");
}

/** 컨텍스트 객체를 재귀적으로 마스킹한다(비밀 키 → <redacted>, UUID 패턴 → <uuid>, 긴 문자열 절단). */
function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    let out = redactString(value);
    if (out.length > MAX_LOG_STRING) out = `${out.slice(0, MAX_LOG_STRING)}…(${out.length} chars)`;
    return out;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "<redacted>" : redactValue(v);
    }
    return out;
  }
  return value;
}

/** Tauri invoke 함수 동적 임포트 (브라우저 번들 안전성 확보) */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * 전역 애플리케이션 로거.
 * 
 * 빌드타임 환경변수(VITE_ENABLE_LOGGING)가 true 일 때만 활성화됩니다.
 * Tauri 데스크톱 환경에서는 Rust 커맨드를 경유해 requests.log 파일에 누적(Append)하며,
 * 웹 브라우저 환경에서는 localStorage를 버퍼 삼아 최대 500줄을 기록합니다.
 */
export const logger = {
  async log(level: "INFO" | "WARN" | "ERROR", category: string, message: string, context?: unknown) {
    if (!IS_LOGGING_ENABLED) return;

    const timestamp = new Date().toISOString();
    // 기록 전 메시지/컨텍스트에서 비밀(raw uuid·시드·서명 등)을 마스킹한다.
    const safeMessage = redactString(message);
    const safeContext = context === undefined ? undefined : redactValue(context);
    let contextStr = "";
    if (context !== undefined) {
      try {
        contextStr = ` | Context: ${
          context instanceof Error
            ? `${context.name}: ${redactString(context.message)}\nStack: ${redactString(context.stack ?? "")}`
            : typeof safeContext === "object"
            ? JSON.stringify(safeContext, null, 2)
            : String(safeContext)
        }`;
      } catch {
        contextStr = " | Context: [Serialization Failed]";
      }
    }

    const logLine = `[${timestamp}] [${level}] [${category}] ${safeMessage}${contextStr}`;

    // 1. 브라우저 콘솔 출력 (마스킹된 컨텍스트 사용)
    if (level === "INFO") {
      if (context !== undefined) {
        console.log(logLine, safeContext);
      } else {
        console.log(logLine);
      }
    } else if (level === "WARN") {
      if (context !== undefined) {
        console.warn(logLine, safeContext);
      } else {
        console.warn(logLine);
      }
    } else {
      if (context !== undefined) {
        console.error(logLine, safeContext);
      } else {
        console.error(logLine);
      }
    }

    // 2. 환경별 저장 매체 기록
    try {
      if (isTauri()) {
        // Rust 백엔드를 호출하여 파일 추가 쓰기
        await invoke("append_log_file", { name: "requests.log", line: logLine });
      } else {
        // 브라우저 로컬 스토리지에 최근 500줄 보관
        const existing = localStorage.getItem("guida:logs") ?? "[]";
        let logs: string[] = [];
        try {
          logs = JSON.parse(existing) as string[];
        } catch {
          logs = [];
        }
        logs.push(logLine);
        if (logs.length > 500) {
          logs.shift();
        }
        localStorage.setItem("guida:logs", JSON.stringify(logs));
      }
    } catch (e) {
      // 로깅 프로세스가 본래 비즈니스 로직에 영향을 주어 앱이 크래시되는 일이 없도록 차단
      console.error("[logger] Failed to write log:", e);
    }
  },

  info(category: string, message: string, context?: unknown) {
    return this.log("INFO", category, message, context);
  },

  warn(category: string, message: string, context?: unknown) {
    return this.log("WARN", category, message, context);
  },

  error(category: string, message: string, context?: unknown) {
    return this.log("ERROR", category, message, context);
  },
};
