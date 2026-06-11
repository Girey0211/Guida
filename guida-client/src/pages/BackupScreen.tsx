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

// ── 브라우저/개발 모드 폴백 암/복호화 및 해시 유틸 ──────────────────────────────
async function hashRecoveryCode(code: string): Promise<string> {
  const input = code.toUpperCase().trim() + "guida.v1.recovery-code.salt";
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function encryptBrowserBackup(
  recoveryCode: string,
  payload: { device_uuid: string; settings: string; routes: string }
): Promise<string> {
  const plaintext = JSON.stringify(payload);
  const rawKey = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(recoveryCode.toUpperCase().trim() + "guida.v1.backup.salt")
  );
  const key = await window.crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));

  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

async function decryptBrowserBackup(
  recoveryCode: string,
  encryptedBlob: string
): Promise<{ device_uuid: string; settings: string; routes: string }> {
  const rawKey = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(recoveryCode.toUpperCase().trim() + "guida.v1.backup.salt")
  );
  const key = await window.crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);

  const binary = atob(encryptedBlob.trim());
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);

  if (combined.length < 12) throw new Error("백업 데이터 길이가 유효하지 않습니다.");
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const plaintext = new TextDecoder().decode(decrypted);
  return JSON.parse(plaintext);
}

function generateRecoveryCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
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
    if (cleanCode.length !== 12) {
      toast.error("올바른 12자리 코드를 입력해 주세요.");
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
              기존 백업 시 발급받았던 12자리 복구 코드를 입력하여 식별키와 데이터를 이전 기기 상태로 완벽히 복원합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="restore-code">복구 코드 (12자리)</Label>
              <Input
                id="restore-code"
                placeholder="예: X7R2B9M4K1P2"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                maxLength={12}
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
