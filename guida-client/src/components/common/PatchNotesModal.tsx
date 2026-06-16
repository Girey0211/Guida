import { X, ClipboardList, PlusCircle, Wrench, RefreshCw, MinusCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import changelogRaw from "../../../CHANGELOG.md?raw";

interface PatchSection {
  title: string;
  items: string[];
}

interface PatchVersion {
  version: string;
  date: string;
  sections: PatchSection[];
}

// Simple and robust markdown changelog parser
function parseChangelog(text: string): PatchVersion[] {
  const lines = text.split("\n");
  const versions: PatchVersion[] = [];
  let currentVersion: PatchVersion | null = null;
  let currentSection: PatchSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Matches `## [0.3.3] - 2026-06-16` or `## 0.3.3 - 2026-06-16`
    const versionMatch = trimmed.match(/^##\s+\[?([^\]\s]+)\]?\s*-\s*(.+)$/);
    if (versionMatch) {
      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2],
        sections: []
      };
      versions.push(currentVersion);
      currentSection = null;
      continue;
    }

    // Matches `### Added` or `### Fixed`
    const sectionMatch = trimmed.match(/^###\s+(.+)$/);
    if (sectionMatch && currentVersion) {
      currentSection = {
        title: sectionMatch[1].trim(),
        items: []
      };
      currentVersion.sections.push(currentSection);
      continue;
    }

    // Matches `- item` or `* item`
    const itemMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (itemMatch && currentSection) {
      currentSection.items.push(itemMatch[1].trim());
      continue;
    }
  }

  return versions;
}

const sectionTitleMap: Record<string, string> = {
  Added: "추가 사항",
  Fixed: "수정 사항",
  Changed: "변경 사항",
  Removed: "제거 사항",
  Deprecated: "비권장 사항",
  Security: "보안 개선 사항"
};

const sectionStyles: Record<string, { badge: string; text: string; icon: any }> = {
  Added: {
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    text: "text-emerald-400",
    icon: PlusCircle
  },
  Fixed: {
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    text: "text-amber-400",
    icon: Wrench
  },
  Changed: {
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    text: "text-blue-400",
    icon: RefreshCw
  },
  Removed: {
    badge: "bg-red-500/10 text-red-400 border-red-500/20",
    text: "text-red-400",
    icon: MinusCircle
  },
  Security: {
    badge: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    text: "text-purple-400",
    icon: ShieldAlert
  }
};

interface PatchNotesModalProps {
  onClose: () => void;
}

export function PatchNotesModal({ onClose }: PatchNotesModalProps) {
  const versions = parseChangelog(changelogRaw);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative flex h-[85vh] w-full max-w-2xl flex-col border border-border/80 bg-background/95 backdrop-blur-md rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-border bg-card/40 px-6 pt-3 pb-2">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
              <ClipboardList className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                패치노트 & 업데이트 기록
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Guida의 새로운 기능들과 개선된 변경 사항들을 확인해 보세요.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Scrollable Contents */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {versions.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              패치노트 기록이 비어있습니다.
            </div>
          ) : (
            versions.map((pv, idx) => {
              const isLatest = idx === 0;
              return (
                <div 
                  key={pv.version} 
                  className={`rounded-xl border p-5 transition-all duration-300 ${
                    isLatest 
                      ? "border-primary/30 bg-primary/5/10 shadow-lg shadow-primary/5" 
                      : "border-border/50 bg-card/20"
                  }`}
                >
                  {/* Version Header */}
                  <div className="flex items-center justify-between border-b border-border/40 pb-3 mb-4">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-base font-bold text-gradient-dawn">
                        v{pv.version}
                      </span>
                      {isLatest && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0.2 bg-primary text-primary-foreground font-semibold">
                          LATEST
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {pv.date}
                    </span>
                  </div>

                  {/* Sections list */}
                  <div className="space-y-4">
                    {pv.sections.map((sec) => {
                      const style = sectionStyles[sec.title] || {
                        badge: "bg-muted text-muted-foreground border-border",
                        text: "text-foreground",
                        icon: ClipboardList
                      };
                      const IconComponent = style.icon;
                      const displayTitle = sectionTitleMap[sec.title] || sec.title;

                      return (
                        <div key={sec.title} className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            <IconComponent className={`size-3.5 ${style.text}`} />
                            <span className={`text-xs font-semibold ${style.text}`}>
                              {displayTitle}
                            </span>
                          </div>
                          <ul className="list-disc pl-4 space-y-1.5">
                            {sec.items.map((item, itemIdx) => (
                              <li key={itemIdx} className="text-xs text-muted-foreground leading-relaxed pl-0.5">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t border-border bg-card/25 px-6 py-4">
          <Button onClick={onClose} size="sm" className="px-5 text-xs font-medium">
            확인
          </Button>
        </div>
      </div>
    </div>
  );
}
