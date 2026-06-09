import { create } from "zustand";
import { useEffect } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind = "info") => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 어디서든 호출 가능한 토스트 트리거 */
export const toast = {
  success: (m: string) => useToastStore.getState().push(m, "success"),
  error: (m: string) => useToastStore.getState().push(m, "error"),
  info: (m: string) => useToastStore.getState().push(m, "info"),
};

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const;

const COLORS = {
  success: "border-emerald-600/40 text-emerald-300",
  error: "border-destructive/50 text-red-300",
  info: "border-border text-foreground",
} as const;

/** 앱 루트에 한 번 마운트하는 토스트 컨테이너 */
export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  useEffect(() => undefined, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-md border bg-card/95 p-3 text-sm shadow-lg backdrop-blur",
              COLORS[t.kind],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1 text-card-foreground">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
