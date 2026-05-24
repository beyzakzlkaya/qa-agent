"use client";

import { useMemo, useState } from "react";
import type { Run } from "@/lib/mockData";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  runs: Run[];
}

interface ModuleInfo {
  name: string;
  matchers: RegExp[];
}

const MODULES: ModuleInfo[] = [
  {
    name: "Sipariş akışı",
    matchers: [/order/i, /sepet/i, /sipariş/i, /checkout/i, /TC-ORDER/i],
  },
  {
    name: "GetPuan / Promosyon",
    matchers: [/getpuan/i, /kupon/i, /promosyon/i, /promo/i, /coupon/i],
  },
  {
    name: "Buyback",
    matchers: [/buyback/i, /TC-BB/i, /telefon-sat/i, /sat[ıi]klar[ıi]m/i, /trade-in/i],
  },
  {
    name: "Ödeme / Kredi kartı",
    matchers: [/ödeme/i, /odeme/i, /payment/i, /kart/i, /iban/i, /taksit/i, /financ/i],
  },
  {
    name: "Kullanıcı / Profil",
    matchers: [/profil/i, /kullan[ıi]c[ıi]/i, /user/i, /otp/i, /TC-IDENTITY/i, /login/i, /register/i],
  },
  {
    name: "Envanter / Stok",
    matchers: [/inventory/i, /envanter/i, /stok/i, /TC-INV/i],
  },
  {
    name: "Garanti / Warranty",
    matchers: [/warranty/i, /garanti/i, /TC-WAR/i],
  },
  {
    name: "Refurbishment",
    matchers: [/refurb/i, /TC-REF/i, /yenileme/i],
  },
];

function moduleForRun(name: string): string {
  for (const m of MODULES) {
    if (m.matchers.some((re) => re.test(name))) return m.name;
  }
  return "Diğer";
}

export function ModuleHeatmap({ runs }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, { failed: number; total: number; runs: Run[] }>();
    for (const r of runs) {
      const mod = moduleForRun(r.name);
      if (!map.has(mod)) map.set(mod, { failed: 0, total: 0, runs: [] });
      const slot = map.get(mod)!;
      slot.total += 1;
      slot.failed += r.failed > 0 || r.status === "failed" ? 1 : 0;
      slot.runs.push(r);
    }
    const arr = Array.from(map.entries()).map(([name, v]) => ({
      name,
      failed: v.failed,
      total: v.total,
      runs: v.runs,
    }));
    arr.sort((a, b) => b.failed - a.failed);
    return arr;
  }, [runs]);

  const max = grouped[0]?.failed ?? 1;

  function densityColor(fraction: number): string {
    if (fraction === 0) return "hsl(var(--success))";
    if (fraction < 0.34) return "hsl(var(--success))";
    if (fraction < 0.67) return "hsl(var(--warning))";
    return "hsl(var(--destructive))";
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Modül bazında hata yoğunluğu
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Test isimlerinden iş alanına eşlendi — bir modüle tıkla, ilgili runları gör
        </p>
      </div>

      <div className="space-y-2">
        {grouped.map((g) => {
          const fraction = g.total > 0 ? g.failed / g.total : 0;
          const widthPct = Math.max((g.failed / max) * 100, 2);
          const color = densityColor(fraction);
          const isOpen = expanded === g.name;
          return (
            <div key={g.name}>
              <button
                onClick={() => setExpanded(isOpen ? null : g.name)}
                className="w-full text-left hover:bg-accent/50 rounded-md px-2 py-1.5 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-foreground/80 flex items-center gap-1">
                    {isOpen ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    {g.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                      {g.total} run
                    </span>
                    <span
                      className="text-xs font-semibold"
                      style={{ color }}
                    >
                      {g.failed}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: color,
                      opacity: 0.85,
                    }}
                  />
                </div>
              </button>
              {isOpen && (
                <div className="mt-1.5 ml-5 mb-2 space-y-1 max-h-40 overflow-y-auto pr-2">
                  {g.runs.slice(0, 10).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between text-[11px] py-1 border-b border-border/40 last:border-b-0"
                    >
                      <span
                        className="truncate text-muted-foreground max-w-[70%]"
                        title={r.name}
                      >
                        {r.name}
                      </span>
                      <span
                        className={
                          r.status === "failed"
                            ? "text-destructive font-medium"
                            : r.status === "passed"
                            ? "text-success font-medium"
                            : "text-primary font-medium"
                        }
                      >
                        {r.passed}/{r.total}
                      </span>
                    </div>
                  ))}
                  {g.runs.length > 10 && (
                    <p className="text-[10px] text-muted-foreground/60 italic pt-1">
                      +{g.runs.length - 10} run daha
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 pt-2 border-t border-border/50">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-success" />
          Düşük
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-warning" />
          Orta
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-destructive" />
          Yüksek
        </span>
      </div>
    </div>
  );
}
