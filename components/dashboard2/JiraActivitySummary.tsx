"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  Code2,
  GitPullRequest,
  ClipboardCheck,
  TestTube2,
  Rocket,
  Globe2,
  CheckCircle2,
  Undo2,
  ExternalLink,
  X,
  Loader2,
  Lightbulb,
} from "lucide-react";

type PipelineStatusKey =
  | "todo"
  | "inProgress"
  | "readyForCR"
  | "readyForQA"
  | "inQA"
  | "readyToRelease"
  | "liveTest"
  | "done"
  | "returnedFromQa";

interface PipelineStatusTile {
  key: PipelineStatusKey;
  label: string;
  status: string;
  count: number;
  jql: string;
  url: string;
}

interface PipelineStatsResp {
  tiles: PipelineStatusTile[];
  projectKey: string;
  available: boolean;
}

interface ReturnedIssue {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  url: string;
  returnCount: number;
  lastReturnAt?: string;
  lastReason?: string;
  reasons: string[];
}

interface ReturnedFromQaResp {
  issues: ReturnedIssue[];
  total: number;
  available: boolean;
  projectKey: string;
}

const TILE_META: Record<
  PipelineStatusKey,
  { icon: JSX.Element; color: string; bg: string; border: string }
> = {
  todo: {
    icon: <Inbox className="w-3.5 h-3.5" />,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
  },
  inProgress: {
    icon: <Code2 className="w-3.5 h-3.5" />,
    color: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/20",
  },
  readyForCR: {
    icon: <GitPullRequest className="w-3.5 h-3.5" />,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
  },
  readyForQA: {
    icon: <ClipboardCheck className="w-3.5 h-3.5" />,
    color: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/20",
  },
  inQA: {
    icon: <TestTube2 className="w-3.5 h-3.5" />,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
  },
  readyToRelease: {
    icon: <Rocket className="w-3.5 h-3.5" />,
    color: "text-success",
    bg: "bg-success/10",
    border: "border-success/20",
  },
  liveTest: {
    icon: <Globe2 className="w-3.5 h-3.5" />,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
  },
  done: {
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    color: "text-success",
    bg: "bg-success/10",
    border: "border-success/20",
  },
  returnedFromQa: {
    icon: <Undo2 className="w-3.5 h-3.5" />,
    color: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/30",
  },
};

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear()).slice(2);
    return `${day}.${month}.${year}`;
  } catch {
    return iso;
  }
}

function suggestionFor(reason: string | undefined): string {
  const r = (reason ?? "").toLowerCase();
  if (!r) return "Reason yorumu bulunamadı — task'a yorum bırakılmamış olabilir.";
  if (/timeout/i.test(r)) return "Backend/yükleme süreleri uzun — DevOps ile profil çıkarın, idempotent retry ekleyin.";
  if (/locator|selector|element|not\s+found|nosuch/i.test(r))
    return "UI değişmiş — selector'ı tekrar haritalandır, data-testid ekle.";
  if (/500|502|503|api/i.test(r)) return "Backend tarafı — BE ekibiyle log/stack-trace paylaş.";
  if (/seed|fixture|data|migration/i.test(r))
    return "Test verisi/setup eksik — seed script veya fixture güncellemesi gerekli.";
  if (/regression/i.test(r)) return "Regresyon — fix commit'i hangi PR'da kaybolmuş, git bisect kullanılabilir.";
  return "Kök neden için yorum geçmişine ve son commit'lere bakılması önerilir.";
}

export function JiraActivitySummary() {
  const [data, setData] = useState<PipelineStatsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReturned, setShowReturned] = useState(false);
  const [returned, setReturned] = useState<ReturnedFromQaResp | null>(null);
  const [returnedLoading, setReturnedLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jira/pipeline-stats")
      .then((r) => r.json())
      .then((d: PipelineStatsResp) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openReturnedModal = async () => {
    setShowReturned(true);
    if (returned !== null) return;
    setReturnedLoading(true);
    try {
      const r = await fetch("/api/jira/returned-from-qa");
      const d = (await r.json()) as ReturnedFromQaResp;
      setReturned(d);
    } catch {
      setReturned({ issues: [], total: 0, available: false, projectKey: data?.projectKey ?? "" });
    } finally {
      setReturnedLoading(false);
    }
  };

  const closeReturnedModal = () => {
    setShowReturned(false);
    setExpandedKey(null);
  };

  const projectKey = data?.projectKey ?? "NE";

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">JIRA pipeline</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {data?.available
              ? `Proje: ${projectKey} — her karta tıkla, JIRA'da filtreli görünüme git`
              : "JIRA bağlı değil — değerler boş gösteriliyor"}
          </p>
        </div>
        <Link
          href="/jira"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
        >
          Pipeline sayfası
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">
          Yükleniyor...
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(data?.tiles ?? []).map((tile) => {
            const meta = TILE_META[tile.key];
            if (tile.key === "returnedFromQa") {
              return (
                <button
                  key={tile.key}
                  onClick={openReturnedModal}
                  className={`text-left rounded-md px-3 py-2.5 border ${meta.border} ${meta.bg} hover:opacity-80 transition-opacity`}
                >
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className={`flex items-center gap-1.5 ${meta.color}`}>
                      {meta.icon}
                      {tile.label}
                    </span>
                  </div>
                  <p className={`text-2xl font-bold mt-1 ${meta.color}`}>{tile.count}</p>
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                    IN QA → In Progress · aktif sprint
                  </p>
                </button>
              );
            }
            return (
              <a
                key={tile.key}
                href={tile.url}
                target="_blank"
                rel="noreferrer"
                className={`block rounded-md px-3 py-2.5 border ${meta.border} ${meta.bg} hover:opacity-80 transition-opacity`}
              >
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className={`flex items-center gap-1.5 ${meta.color}`}>
                    {meta.icon}
                    {tile.label}
                  </span>
                </div>
                <p className={`text-2xl font-bold mt-1 ${meta.color}`}>{tile.count}</p>
                <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">
                  {tile.status}
                </p>
              </a>
            );
          })}
        </div>
      )}

      {/* Returned-from-QA Modal */}
      {showReturned && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={closeReturnedModal}
        >
          <div
            className="bg-card border border-border rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div className="flex items-center gap-2">
                <Undo2 className="w-4 h-4 text-destructive" />
                <h3 className="text-sm font-semibold text-foreground">Testten dönen işler</h3>
                {returned && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/30">
                    {returned.issues.length} task
                  </span>
                )}
              </div>
              <button
                onClick={closeReturnedModal}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent transition-colors"
                title="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-2">
              {returnedLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  History taranıyor...
                </div>
              ) : !returned?.available ? (
                <div className="text-sm text-muted-foreground text-center py-12">
                  JIRA bağlı değil — bu özelliği kullanmak için .env.local&apos;da JIRA kimlik
                  bilgilerini ekleyin.
                </div>
              ) : returned.issues.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-12">
                  Aktif sprint'te testten dönen iş yok 🎉
                </div>
              ) : (
                returned.issues.map((issue) => {
                  const isOpen = expandedKey === issue.key;
                  const suggestion = suggestionFor(issue.lastReason);
                  return (
                    <div
                      key={issue.key}
                      className="border border-border rounded-md overflow-hidden"
                    >
                      <button
                        onClick={() =>
                          setExpandedKey(isOpen ? null : issue.key)
                        }
                        className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex items-center gap-3"
                      >
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-destructive/10 text-destructive font-bold text-sm">
                          {issue.returnCount}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                            <span className="font-mono">{issue.key}</span>
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {issue.status}
                            </span>
                          </p>
                          <p
                            className="text-xs text-muted-foreground truncate"
                            title={issue.summary}
                          >
                            {issue.summary}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                            {issue.returnCount}× testten döndü · son:{" "}
                            {formatDate(issue.lastReturnAt)}
                            {issue.assignee ? ` · ${issue.assignee}` : ""}
                          </p>
                        </div>
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] text-primary hover:text-primary/80 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-accent"
                        >
                          JIRA <ExternalLink className="w-3 h-3" />
                        </a>
                      </button>

                      {isOpen && (
                        <div className="bg-muted/30 border-t border-border px-4 py-3 space-y-3">
                          <div>
                            <p className="text-[11px] font-semibold text-foreground mb-1">
                              Neden döndü?
                            </p>
                            {issue.reasons.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground italic">
                                Geçişe yakın yorum bulunamadı (24sa içinde).
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {issue.reasons.slice(0, 5).map((r, i) => (
                                  <li
                                    key={i}
                                    className="text-[11px] text-muted-foreground bg-background/60 border border-border/60 rounded px-2 py-1.5"
                                  >
                                    {r}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="border-t border-border/60 pt-2.5">
                            <p className="text-[11px] font-semibold text-foreground mb-1 flex items-center gap-1">
                              <Lightbulb className="w-3 h-3 text-warning" />
                              Nasıl çözebiliriz?
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {suggestion}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 py-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Aktif sprint · IN QA → In Progress geçişleri</span>
              {returned?.available && returned.issues.length > 0 && (
                <a
                  href={data?.tiles.find((t) => t.key === "returnedFromQa")?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
                >
                  JIRA&apos;da tümünü aç <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
