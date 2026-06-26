"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";

interface TopCase {
  caseId: string;
  title: string;
  failCount: number;
  totalRuns: number;
}

interface PriorityRow {
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  totalCases: number;
  distinctCases: number;
  failedCases: number;
  passRate: number;
  failRate: number;
  topFailingCases: TopCase[];
}

interface Resp {
  rows: PriorityRow[];
  windowDays: number;
}

const PRIORITY_META: Record<
  PriorityRow["priority"],
  { tr: string; explain: string; icon: JSX.Element }
> = {
  critical: {
    tr: "Hayati testler",
    explain: "Login, erişim kontrolü — kırılırsa sisteme girilemez",
    icon: <ShieldAlert className="w-4 h-4" />,
  },
  high: {
    tr: "İş akışı testleri",
    explain: "Sipariş, ürün, kullanıcı yönetimi — kırılırsa iş yapılamaz",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  medium: { tr: "Medium", explain: "", icon: <></> },
  low: { tr: "Low", explain: "", icon: <></> },
};

function failStyle(rate: number) {
  if (rate >= 40)
    return {
      color: "text-destructive",
      bg: "bg-destructive/10 border-destructive/30",
      label: "Acil",
      icon: <AlertTriangle className="w-3 h-3" />,
    };
  if (rate >= 10)
    return {
      color: "text-warning",
      bg: "bg-warning/10 border-warning/30",
      label: "Dikkat",
      icon: <AlertTriangle className="w-3 h-3" />,
    };
  return {
    color: "text-success",
    bg: "bg-success/10 border-success/30",
    label: "İyi",
    icon: <CheckCircle2 className="w-3 h-3" />,
  };
}

export function CriticalHealthCard() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/critical-health?days=7")
      .then((r) => r.json())
      .then((d: Resp) => {
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

  const rows = data?.rows ?? [];
  const critical = rows.find((r) => r.priority === "critical");
  const showLead = !loading && critical && critical.totalCases > 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          En önemli testler ne durumda?
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Son 7 gün — sisteme giriş ve iş akışı testlerinin başarı durumu
        </p>
      </div>

      {/* Lead — direct, plain answer */}
      {showLead && (
        <div
          className={`rounded-md border px-3 py-2 text-[11px] flex items-start gap-2 ${
            failStyle(critical.failRate).bg
          }`}
        >
          {failStyle(critical.failRate).icon}
          <span>
            {critical.failRate >= 40 ? (
              <>
                <strong>Hayati testlerde sorun var:</strong> son 7 günde{" "}
                {critical.totalCases} koşumdan {critical.failedCases}&apos;i hata verdi
                (%{Math.round(critical.failRate)}).
                {critical.topFailingCases[0] && (
                  <>
                    {" "}En problemli:{" "}
                    <span className="font-mono">{critical.topFailingCases[0].caseId}</span>{" "}
                    — {critical.topFailingCases[0].title}.
                  </>
                )}
              </>
            ) : critical.failRate >= 10 ? (
              <>
                Hayati testlerde dikkat: %{Math.round(critical.failRate)} hata oranı.
              </>
            ) : (
              <>Hayati testler sağlıklı, son 7 günde %{Math.round(critical.failRate)} hata.</>
            )}
          </span>
        </div>
      )}

      {loading ? (
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          Yükleniyor...
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          Son 7 günde önemli test koşumu yok
        </div>
      ) : (
        <div className="space-y-3">
          {data.rows.map((row) => {
            const style = failStyle(row.failRate);
            const meta = PRIORITY_META[row.priority];
            const hasData = row.totalCases > 0;
            return (
              <div
                key={row.priority}
                className={`rounded-md border ${style.bg} px-3 py-2.5`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className={`flex items-center gap-1.5 ${style.color}`}>
                      {meta.icon}
                      <span className="text-sm font-semibold">{meta.tr}</span>
                      {hasData && (
                        <span
                          className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border flex items-center gap-1 ${style.bg}`}
                        >
                          {style.icon}
                          {style.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {meta.explain}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`text-2xl font-bold tabular-nums leading-none ${style.color}`}
                    >
                      {hasData ? `%${Math.round(row.failRate)}` : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                      {hasData
                        ? `${row.totalCases} koşum · ${row.failedCases} hata`
                        : "veri yok"}
                    </p>
                  </div>
                </div>

                {row.topFailingCases.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                      Önce bu testleri incele
                    </p>
                    <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {row.topFailingCases.map((c) => {
                        const pct = Math.round((c.failCount / c.totalRuns) * 100);
                        return (
                          <li
                            key={c.caseId}
                            className="flex items-center justify-between text-[11px] py-0.5 gap-3"
                          >
                            <span
                              className="truncate text-muted-foreground min-w-0"
                              title={c.title}
                            >
                              <span className="font-mono text-foreground/70">
                                {c.caseId}
                              </span>{" "}
                              — {c.title}
                            </span>
                            <span className="text-destructive font-medium tabular-nums shrink-0">
                              {c.totalRuns} koşumdan {c.failCount}&apos;i · %{pct}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
