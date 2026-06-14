import { isTauri } from "./env";

/** 로그 기능 빌드 설정 제어 플래그 */
export const IS_LOGGING_ENABLED = import.meta.env.VITE_ENABLE_LOGGING === "true";

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
    let contextStr = "";
    if (context !== undefined) {
      try {
        contextStr = ` | Context: ${
          context instanceof Error
            ? `${context.name}: ${context.message}\nStack: ${context.stack}`
            : typeof context === "object"
            ? JSON.stringify(context, null, 2)
            : String(context)
        }`;
      } catch {
        contextStr = " | Context: [Serialization Failed]";
      }
    }

    const logLine = `[${timestamp}] [${level}] [${category}] ${message}${contextStr}`;

    // 1. 브라우저 콘솔 출력
    if (level === "INFO") {
      if (context !== undefined) {
        console.log(logLine, context);
      } else {
        console.log(logLine);
      }
    } else if (level === "WARN") {
      if (context !== undefined) {
        console.warn(logLine, context);
      } else {
        console.warn(logLine);
      }
    } else {
      if (context !== undefined) {
        console.error(logLine, context);
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
