"use client";

import { useEffect, useState } from "react";
import { ListChecks, Hourglass } from "lucide-react";

interface StaleTest {
  caseId: string;
  daysAgo: number | null;
  title?: string;
  domain?: string;
}

interface InventoryResp {
  totalCases: number;
  activeCases: number;
  ranLast7Days: number;
  stale14d: StaleTest[];
  domainsWithoutTests: string[];
  domainsWithTests: string[];
}

export function TestCoverageCard() {
  const [data, setData] = useState<InventoryResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/test-inventory")
      .then((r) => r.json())
      .then((d: InventoryResp) => {
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

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5 text-primary" />
          Test kapsamı
        </h3>
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
          Yükleniyor...
        </div>
      ) : !data ? (
        <div className="text-xs text-muted-foreground">Veri alınamadı.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-muted/40 rounded-md px-2 py-2 text-center">
              <p className="text-xl font-bold text-foreground">{data.totalCases}</p>
              <p className="text-[10px] text-muted-foreground">Toplam</p>
            </div>
            <div className="bg-muted/40 rounded-md px-2 py-2 text-center">
              <p className="text-xl font-bold text-success">{data.ranLast7Days}</p>
              <p className="text-[10px] text-muted-foreground">7g koşturulan</p>
            </div>
            <div className="bg-muted/40 rounded-md px-2 py-2 text-center">
              <p className="text-xl font-bold text-warning">{data.stale14d.length}</p>
              <p className="text-[10px] text-muted-foreground">14g+ bayat</p>
            </div>
          </div>

          {data.stale14d.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-semibold text-warning mb-2 flex items-center gap-1.5">
                <Hourglass className="w-3 h-3" />
                Bayat testler — en uzun süredir koşturulmamış
              </p>
              <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {data.stale14d.slice(0, 5).map((s) => (
                  <li
                    key={s.caseId}
                    className="flex items-center justify-between text-[11px] py-0.5"
                  >
                    <span
                      className="truncate text-muted-foreground max-w-[70%]"
                      title={s.title ?? s.caseId}
                    >
                      {s.caseId}
                    </span>
                    <span className="text-warning font-medium">
                      {s.daysAgo === null ? "hiç" : `${s.daysAgo}g`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.domainsWithoutTests.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-semibold text-muted-foreground mb-2">
                Kapsam dışı modüller ({data.domainsWithoutTests.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {data.domainsWithoutTests.map((d) => (
                  <span
                    key={d}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
