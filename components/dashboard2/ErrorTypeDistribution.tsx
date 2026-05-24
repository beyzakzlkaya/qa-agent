"use client";

import { useEffect, useState } from "react";
import { MousePointer2, Server, Database, Clock, HelpCircle } from "lucide-react";

interface ErrorTypeBucket {
  type: "UI / Element" | "API / Backend" | "Veri / Setup" | "Timeout / Performans" | "Diğer";
  count: number;
  owner: "FE" | "BE" | "QA" | "DevOps" | "—";
}

interface Resp {
  buckets: ErrorTypeBucket[];
  total: number;
}

const ICONS: Record<ErrorTypeBucket["type"], JSX.Element> = {
  "UI / Element": <MousePointer2 className="w-3.5 h-3.5" />,
  "API / Backend": <Server className="w-3.5 h-3.5" />,
  "Veri / Setup": <Database className="w-3.5 h-3.5" />,
  "Timeout / Performans": <Clock className="w-3.5 h-3.5" />,
  "Diğer": <HelpCircle className="w-3.5 h-3.5" />,
};

const COLORS: Record<ErrorTypeBucket["type"], string> = {
  "UI / Element": "hsl(var(--primary))",
  "API / Backend": "hsl(var(--destructive))",
  "Veri / Setup": "hsl(var(--warning))",
  "Timeout / Performans": "hsl(var(--warning))",
  "Diğer": "hsl(var(--muted-foreground))",
};

export function ErrorTypeDistribution() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports/error-types")
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

  const buckets = data?.buckets ?? [];
  const total = data?.total ?? 0;
  const sorted = [...buckets].sort((a, b) => b.count - a.count);
  const max = sorted[0]?.count ?? 1;

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Hata türü dağılımı</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Son 30 günde — hangi ekibe ticket açmalıyım?
        </p>
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          Yükleniyor...
        </div>
      ) : total === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          Son 30 günde sınıflandırılabilen hata yok
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((b) => {
            const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
            const widthPct = Math.max((b.count / max) * 100, 2);
            return (
              <div key={b.type}>
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="text-xs text-foreground/80 flex items-center gap-1.5"
                    style={{ color: COLORS[b.type] }}
                  >
                    {ICONS[b.type]}
                    {b.type}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                      {b.owner}
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      {b.count}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 w-9 text-right">
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: COLORS[b.type],
                      opacity: 0.85,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
