import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, Copy, Check, UploadCloud, Download, AlertTriangle, ShieldCheck } from "lucide-react";
import { isTauri } from "@/lib/env";
import { readFile, writeFile } from "@/lib/storage";
import { uploadBackup, restoreBackup } from "@/api/routes";
import { useAppStore } from "@/store/appStore";
import { useRouteStore } from "@/store/routeStore";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

// ── 백업 복구 코드 규격 (V2) ───────────────────────────────────────────────────
//  - CSPRNG(crypto.getRandomValues) + 16자리(36진 ≈ 2^82) 키스페이스.
//  - 룩업 해시/암호화 키 모두 단일 SHA-256 → 느린 KDF(PBKDF2-HMAC-SHA256, 600k)로 강화.
//  - 암호화 키는 백업마다 임의 솔트(블롭 헤더에 포함)를 써 사전계산/레인보우를 차단.
//  - 룩업 해시는 서버가 코드만으로 조회해야 하므로 고정 솔트 유지(대신 느린 KDF).
//  - V1(12자리/SHA-256) 백업은 하위호환을 끊고 복원 불가(입력 검증 단계에서 반려).
const RECOVERY_CODE_LENGTH = 16;
const PBKDF2_ITERATIONS = 600_000;
const BACKUP_BLOB_VERSION = 2;
const LOOKUP_SALT = new TextEncoder().encode("guida.v2.recovery-code.lookup.salt");

/** 룩업 해시: 서버 조회 키(recovery_code_hash). 고정 솔트 + 느린 KDF. */
async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = code.toUpperCase().trim();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalized),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await window.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: LOOKUP_SALT as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 백업마다 임의 솔트로 AES-256-GCM 키를 PBKDF2 파생(Rust 경로와 동일 규격). */
async function deriveBackupKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code.toUpperCase().trim()),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBrowserBackup(
  recoveryCode: string,
  payload: { device_uuid: string; settings: string; routes: string }
): Promise<string> {
  const plaintext = JSON.stringify(payload);
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveBackupKey(recoveryCode, salt);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext))
  );

  // 블롭 = version(1) || salt(16) || iv(12) || ciphertext
  const combined = new Uint8Array(1 + 16 + 12 + ciphertext.length);
  combined[0] = BACKUP_BLOB_VERSION;
  combined.set(salt, 1);
  combined.set(iv, 17);
  combined.set(ciphertext, 29);
  return btoa(String.fromCharCode(...combined));
}

async function decryptBrowserBackup(
  recoveryCode: string,
  encryptedBlob: string
): Promise<{ device_uuid: string; settings: string; routes: string }> {
  const binary = atob(encryptedBlob.trim());
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);

  if (combined.length < 29 || combined[0] !== BACKUP_BLOB_VERSION) {
    throw new Error("지원하지 않는 백업 형식입니다(V2 전용).");
  }
  const salt = combined.slice(1, 17);
  const iv = combined.slice(17, 29);
  const ciphertext = combined.slice(29);

  const key = await deriveBackupKey(recoveryCode, salt);
  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

/** CSPRNG 기반 16자리 복구 코드. 36진 모듈로 편향 제거를 위해 252 이상 바이트는 버린다. */
function generateRecoveryCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  while (result.length < RECOVERY_CODE_LENGTH) {
    const bytes = window.crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_LENGTH));
    for (let i = 0; i < bytes.length && result.length < RECOVERY_CODE_LENGTH; i++) {
      if (bytes[i] < 252) result += chars.charAt(bytes[i] % chars.length);
    }
  }
  return result;
}

export function BackupScreen() {
  const navigate = useNavigate();
  const { uuid, bootstrap } = useAppStore();
  const { loadMyRoutes } = useRouteStore();

  const [loading, setLoading] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [showCodeCard, setShowCodeCard] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputCode, setInputCode] = useState("");

  // 백업 실행
  const handleBackup = async () => {
    setLoading(true);
    try {
      const code = generateRecoveryCode();
      const settingsJson = (await readFile("user_settings.json")) || "{}";
      const routesJson = (await readFile("my_routes.json")) || '{"routes":[]}';

      let encryptedBlob = "";
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        encryptedBlob = await invoke<string>("encrypt_backup", {
          recoveryCode: code,
          settingsJson,
          routesJson,
        });
      } else {
        encryptedBlob = await encryptBrowserBackup(code, {
          device_uuid: uuid,
          settings: settingsJson,
          routes: routesJson,
        });
      }

      const codeHash = await hashRecoveryCode(code);
      await uploadBackup(codeHash, encryptedBlob);

      setRecoveryCode(code);
      setShowCodeCard(true);
      toast.success("백업에 성공했습니다. 복구 코드를 보관해 주세요.");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "백업 업로드 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 복구 실행
  const handleRestore = async () => {
    if (!inputCode.trim()) {
      toast.error("복구 코드를 입력해 주세요.");
      return;
    }
    const cleanCode = inputCode.toUpperCase().trim();
    if (cleanCode.length !== RECOVERY_CODE_LENGTH) {
      // V1(12자리) 코드는 하위호환 단절로 복원 불가 → 입력 검증 단계에서 반려.
      toast.error(`올바른 ${RECOVERY_CODE_LENGTH}자리 코드를 입력해 주세요.`);
      return;
    }

    setLoading(true);
    try {
      const codeHash = await hashRecoveryCode(cleanCode);
      const encryptedBlob = await restoreBackup(codeHash);

      let restored: { device_uuid: string; settings: string; routes: string };
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<{ device_uuid: string; settings_json: string; routes_json: string }>(
          "decrypt_backup",
          {
            recoveryCode: cleanCode,
            encryptedBlob,
          }
        );
        restored = {
          device_uuid: res.device_uuid,
          settings: res.settings_json,
          routes: res.routes_json,
        };
        // 복구된 신원을 권위 저장소(키체인)에 먼저 주입한다. 이후 my_routes.json
        // 암호화·부팅(ensure_device_uuid)이 복구된 device_uuid 를 사용하게 된다(C-2).
        await invoke("restore_device_uuid", { uuid: res.device_uuid });
      } else {
        restored = await decryptBrowserBackup(cleanCode, encryptedBlob);
      }

      // 복구 데이터 로컬 저장
      await writeFile("user_settings.json", restored.settings);
      await writeFile("my_routes.json", restored.routes);

      if (!isTauri()) {
        localStorage.setItem("guida:device-uuid", restored.device_uuid);
        // uuid_sig 계산 후 주입
        const input = `guida.v1.device-uuid.integrity|${restored.device_uuid}`;
        let h = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
          h ^= input.charCodeAt(i);
          h = Math.imul(h, 0x01000193);
        }
        const sig = (h >>> 0).toString(16).padStart(8, "0");
        localStorage.setItem("guida:device-uuid-sig", sig);
      }

      // 앱 상태 리로드
      await bootstrap();
      await loadMyRoutes();

      setInputCode("");
      toast.success("계정이 완벽히 복구되었습니다!");
      navigate("/");
    } catch (e) {
      console.error(e);
      toast.error("복구 실패: 코드가 올바르지 않거나 데이터가 존재하지 않습니다.");
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    toast.success("복구 코드가 클립보드에 복사되었습니다.");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="size-4" /> 뒤로가기
        </Button>
      </div>

      <PageHeader
        title="계정 백업 및 복구"
      />

      <div className="space-y-6">
        {/* 설명 카드 */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex gap-3 pt-6 text-sm text-muted-foreground">
            <ShieldCheck className="size-5 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">서버에 어떠한 평문 데이터도 저장되지 않습니다.</p>
              <p>
                사용자의 로컬 비밀 키와 모든 라우트 정보는 생성된 **복구 코드**를 통해서만 암호화가 해제됩니다.
                만약 복구 코드를 분실하면 서버에서도 데이터 복구가 절대로 불가능하므로, 안전한 곳에 메모해 두시기 바랍니다.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 백업 실행 카드 */}
        {!showCodeCard ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UploadCloud className="size-5 text-primary" /> 계정 백업하기
              </CardTitle>
              <CardDescription>
                현재 기기의 식별키(UUID), 개인키 시드, 설정, 그리고 내 루트 데이터를 안전하게 암호화하여 서버에 백업합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleBackup} disabled={loading} className="w-full">
                {loading ? "백업 진행 중..." : "백업 코드 생성 및 백업하기"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-emerald-500/30 bg-emerald-500/5 animate-in fade-in zoom-in-95 duration-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-emerald-400">
                <KeyRound className="size-5" /> 🔑 생성된 복구 코드
              </CardTitle>
              <CardDescription>
                이 코드를 캡처하거나 다른 곳에 반드시 받아적으세요. 새 기기나 포맷 후에 데이터를 복원할 수 있는 유일한 열쇠입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                onClick={copyCode}
                className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-emerald-500/30 bg-zinc-950 px-4 py-3 font-mono text-lg font-bold tracking-wider text-emerald-400 hover:border-emerald-400"
              >
                <span>{recoveryCode}</span>
                {copied ? <Check className="size-5 text-emerald-400" /> : <Copy className="size-5 text-muted-foreground" />}
              </div>
              <Button variant="outline" onClick={() => setShowCodeCard(false)} className="w-full">
                완료 및 돌아가기
              </Button>
            </CardContent>
          </Card>
        )}

        {/* 복구 실행 카드 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="size-5 text-primary" /> 계정 복구하기
            </CardTitle>
            <CardDescription>
              기존 백업 시 발급받았던 16자리 복구 코드를 입력하여 식별키와 데이터를 이전 기기 상태로 완벽히 복원합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="restore-code">복구 코드 (16자리)</Label>
              <Input
                id="restore-code"
                placeholder="예: X7R2B9M4K1P2T6QW"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                maxLength={RECOVERY_CODE_LENGTH}
                className="font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal"
              />
            </div>
            <div className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500/90">
              <AlertTriangle className="size-4 shrink-0" />
              <span>복구를 진행하면 현재 기기에 있는 저장되지 않은 로컬 루트와 임시 식별 UUID는 덮어씌워져 사라집니다.</span>
            </div>
            <Button variant="outline" onClick={handleRestore} disabled={loading} className="w-full hover:bg-zinc-900">
              {loading ? "복구 진행 중..." : "데이터 복구 실행"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
