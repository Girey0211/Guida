import { defineConfig } from "vitest/config";
import path from "node:path";

// 동기화 코어(매니페스트 diff/무결성/Offline-First) 회귀 테스트 전용 설정.
// 빌드(vite.config.ts)와 분리해 테스트 관심사만 둔다. @ alias 는 동일하게 맞춘다.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // 동기화 코어는 DOM 불필요. crypto.subtle 은 Node webcrypto 로 제공된다.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
