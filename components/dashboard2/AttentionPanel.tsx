"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Run } from "@/lib/mockData";
import {
  AlertOctagon,
  AlertTriangle,
  Repeat,
  Gauge,
  Hourglass,
  Play,
  ExternalLink,
  ArrowRight,
} from "lucide-react";

type Priority = "P0" | "P1" | "Flaky" | "Yavaş" | "Eski";

interface AttentionItem {
  id: string;
  priority: Priority;
  title: string;
  desc: string;
  href?: string;
  action?: "run" | "open";
}

interface JiraTask {
  key: string;
  summary: string;
  status: string;
  priority: string;
  url: string;
}

interface JiraTasksResp {
  tasks?: JiraTask[];
}

interface StaleTest {
  caseId: string;
  daysAgo: number | null;
  title?: string;
}

interface InventoryResp {
  stale14d?: StaleTest[];
}

function parseDurationToMinutes(d: string): number {
  if (!d) return 0;
  let total = 0;
  const m = d.match(/(\d+)m/);
  const s = d.match(/(\d+)s/);
  if (m) total += parseInt(m[1]);
  if (s) total += parseInt(s[1]) / 60;
  return total;
}

const PRIORITY_STYLE: Record<Priority, { bg: string; text: string; border: string; icon: JSX.Element }> = {
  P0: {
    bg: "bg-destructive/10",
    text: "text-destructive",
    border: "border-destructive/30",
    icon: <AlertOctagon className="w-3.5 h-3.5" />,
  },
  P1: {
    bg: "bg-destructive/[0.06]",
    text: "text-destructive",
    border: "border-destructive/20",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  Flaky: {
    bg: "bg-warning/10",
    text: "text-warning",
    border: "border-warning/30",
    icon: <Repeat className="w-3.5 h-3.5" />,
  },
  "Yavaş": {
    bg: "bg-primary/10",
    text: "text-primary",
    border: "border-primary/20",
    icon: <Gauge className="w-3.5 h-3.5" />,
  },
  Eski: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
    icon: <Hourglass className="w-3.5 h-3.5" />,
  },
};

const PRIORITY_ORDER: Priority[] = ["P0", "P1", "Flaky", "Yavaş", "Eski"];

interface Props {
  runs: Run[];
}

export function AttentionPanel({ runs }: Props) {
  const [jira, setJira] = useState<JiraTask[]>([]);
  const [inventory, setInventory] = useState<StaleTest[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/jira/tasks?status=Open").then((r) => r.json()).catch(() => ({})),
      fetch("/api/test-inventory").then((r) => r.json()).catch(() => ({})),
    ]).then(([j, inv]: [JiraTasksResp, InventoryResp]) => {
      if (cancelled) return;
      setJira(
        (j.tasks ?? []).filter(
          (t) =>
            (t.priority === "Highest" || t.priority === "High") &&
            t.status.toLowerCase() !== "done" &&
            t.status.toLowerCase() !== "closed"
        )
      );
      setInventory(inv.stale14d ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo<AttentionItem[]>(() => {
    const out: AttentionItem[] = [];

    // P0 / P1 from JIRA
    for (const task of jira.slice(0, 4)) {
      const p: Priority = task.priority === "Highest" ? "P0" : "P1";
      out.push({
        id: `jira-${task.key}`,
        priority: p,
        title: `${task.key} — ${task.summary}`,
        desc: `Durum: ${task.status} · JIRA'da aç`,
        href: task.url,
        action: "open",
      });
    }

    // Flaky tests (same name has both pass and fail across recent runs)
    const byName = new Map<string, Run[]>();
    for (const r of runs) {
      const key = r.name.replace(/\s*\(Tekrar\)\s*/i, "").trim();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(r);
    }
    Array.from(byName.entries()).forEach(([name, group]) => {
      const last5 = group.slice(0, 5);
      const hasPassed = last5.some((r: Run) => r.status === "passed" || r.passed > 0);
      const hasFailed = last5.some((r: Run) => r.status === "failed");
      if (last5.length >= 3 && hasPassed && hasFailed) {
        out.push({
          id: `flaky-${name}`,
          priority: "Flaky",
          title: name,
          desc: `Son ${last5.length} koşumun bir kısmı geçti, bir kısmı kaldı — kararsız.`,
          action: "run",
        });
      }
    });

    // Yavaş — duration > 60 min, recent
    const slowRuns = runs
      .filter((r) => parseDurationToMinutes(r.duration) >= 60)
      .slice(0, 2);
    for (const r of slowRuns) {
      out.push({
        id: `slow-${r.id}`,
        priority: "Yavaş",
        title: r.name,
        desc: `Süre: ${r.duration} — 60 dk eşiği aşıldı.`,
        action: "run",
      });
    }

    // Eski — stale tests
    for (const s of inventory.slice(0, 2)) {
      out.push({
        id: `stale-${s.caseId}`,
        priority: "Eski",
        title: s.title ?? s.caseId,
        desc:
          s.daysAgo === null
            ? "Hiç koşturulmamış — kapsam dışında."
            : `${s.daysAgo} gündür koşturulmuyor.`,
        action: "run",
      });
    }

    // Sort by priority order and cap at 7
    out.sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
    );
    return out.slice(0, 7);
  }, [runs, jira, inventory]);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Şimdi ilgilenmen gerekenler
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Öncelik sırasıyla — P0 → P1 → Flaky → Yavaş → Eski
          </p>
        </div>
        <Link
          href="/jira"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
        >
          Tüm JIRA görevleri
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground/70 py-6 text-center">
          🎉 Şu an acil aksiyon gerektiren bir şey yok.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const s = PRIORITY_STYLE[item.priority];
            const isLink = !!item.href;
            const Wrapper: React.ElementType = isLink ? "a" : "div";
            const wrapperProps = isLink
              ? { href: item.href, target: "_blank", rel: "noreferrer" }
              : {};
            return (
              <Wrapper
                key={item.id}
                {...wrapperProps}
                className={`group flex items-center gap-3 rounded-md border ${s.border} ${s.bg} px-3 py-2.5 transition-colors hover:bg-opacity-80 ${
                  isLink ? "cursor-pointer" : ""
                }`}
              >
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${s.text} bg-background/60 border ${s.border}`}
                >
                  {s.icon}
                  {item.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-[13px] font-medium truncate ${s.text}`}
                    title={item.title}
                  >
                    {item.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate" title={item.desc}>
                    {item.desc}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-muted-foreground group-hover:text-foreground transition-colors">
                  {item.action === "open" ? (
                    <>
                      <ExternalLink className="w-3 h-3" />
                      Aç
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      Çalıştır
                    </>
                  )}
                </span>
              </Wrapper>
            );
          })}
        </ul>
      )}
    </div>
  );
}
