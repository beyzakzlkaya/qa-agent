"use client";

import { useState, RefObject } from "react";
import { Run } from "@/lib/mockData";
import { X, ChevronDown, ChevronUp, ExternalLink, Play } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Priority = "ACİL" | "ÖNEMLİ" | "İYİLEŞTİRME";

interface DerivedCard {
  id: string;
  priority: Priority;
  title: string;
  body: string;
  relatedRunIds: string[];
  relatedRuns: Run[];
  countBadge?: number;
}

// ─── Logic: derive cards from run data ───────────────────────────────────────

function deriveCards(runs: Run[]): DerivedCard[] {
  const cards: DerivedCard[] = [];

  const byName = new Map<string, Run[]>();
  for (const run of runs) {
    const key = run.name;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(run);
  }

  const consecutiveMap = new Map<string, { count: number; lastDate: string; runs: Run[] }>();
  Array.from(byName.entries()).forEach(([name, group]) => {
    const sorted = [...group].sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    const streakRuns: Run[] = [];
    for (const r of sorted) {
      if (r.status === "failed") {
        streak++;
        streakRuns.push(r);
      } else break;
    }
    if (streak >= 3) {
      consecutiveMap.set(name, {
        count: streak,
        lastDate: sorted[0].date,
        runs: streakRuns,
      });
    }
  });

  Array.from(consecutiveMap.entries()).forEach(([name, data]) => {
    cards.push({
      id: `acil-${name}`,
      priority: "ACİL",
      title: `${name} — Kök neden analizi`,
      body: `${data.count} kez üst üste başarısız. Son run: ${data.lastDate}`,
      relatedRunIds: data.runs.map((r: Run) => r.id),
      relatedRuns: data.runs,
      countBadge: data.count,
    });
  });

  const flakyNames: string[] = [];
  Array.from(byName.entries()).forEach(([name, group]) => {
    const hasPassed = group.some((r: Run) => r.passed > 0 || r.status === "passed");
    const hasFailed = group.some((r: Run) => r.failed > 0 || r.status === "failed");
    if (hasPassed && hasFailed && !consecutiveMap.has(name)) {
      flakyNames.push(name);
    }
  });

  flakyNames.forEach((name) => {
    const group = byName.get(name)!;
    const passCount = group.filter((r: Run) => r.status === "passed" || r.passed > 0).length;
    const failCount = group.filter((r: Run) => r.status === "failed" && r.failed > 0).length;
    cards.push({
      id: `onemli-${name}`,
      priority: "ÖNEMLİ",
      title: `${name} flakiness sorunu`,
      body: `${passCount} geçti, ${failCount} başarısız — kararsız test`,
      relatedRunIds: group.map((r: Run) => r.id),
      relatedRuns: group,
    });
  });

  const envSet = new Set(runs.map((r) => r.env));
  if (envSet.size === 1) {
    const onlyEnv = Array.from(envSet)[0];
    cards.push({
      id: "iyilestirme-env",
      priority: "İYİLEŞTİRME",
      title: `Sadece ${onlyEnv} ortamında test ediliyor`,
      body: "Staging veya Prod karşılaştırması eksik",
      relatedRunIds: [],
      relatedRuns: [],
    });
  }

  return cards;
}

// ─── Styling map ─────────────────────────────────────────────────────────────

const STYLE: Record<Priority, {
  badge: string;
  title: string;
  cardBorder: string;
}> = {
  "ACİL": {
    badge: "bg-destructive/15 text-destructive border border-destructive/30",
    title: "text-destructive",
    cardBorder: "border-destructive/20 hover:border-destructive/40",
  },
  "ÖNEMLİ": {
    badge: "bg-warning/10 text-warning border border-warning/30",
    title: "text-warning",
    cardBorder: "border-warning/20 hover:border-warning/40",
  },
  "İYİLEŞTİRME": {
    badge: "bg-primary/15 text-primary border border-primary/30",
    title: "text-primary",
    cardBorder: "border-primary/20 hover:border-primary/40",
  },
};

// ─── Expand panel ────────────────────────────────────────────────────────────

function ExpandPanel({ card }: { card: DerivedCard }) {
  if (card.relatedRuns.length === 0) return null;
  return (
    <div className="mt-3.5 pt-3.5 border-t border-border space-y-2">
      <div className="flex flex-col gap-2 mb-3.5">
        {card.relatedRuns.slice(0, 8).map((run) => (
          <div
            key={run.id}
            className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2 gap-2"
          >
            <div>
              <p className="text-xs font-medium text-foreground">{run.name}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {run.date} · {run.duration}
              </p>
            </div>
            <a
              href={`https://jira.example.com/browse/${run.name.replace(/\s/g, "-")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 whitespace-nowrap flex-shrink-0 transition-colors"
            >
              <ExternalLink size={11} />
              JIRA&apos;da Aç
            </a>
          </div>
        ))}
      </div>
      <button className="inline-flex items-center justify-center gap-1.5 w-full bg-primary text-primary-foreground rounded-md px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-primary/90">
        <Play size={12} />
        Tümünü Yeniden Çalıştır
      </button>
    </div>
  );
}

// ─── Single card ─────────────────────────────────────────────────────────────

interface CardProps {
  card: DerivedCard;
  onDismiss: (id: string) => void;
  onFilter: (ids: string[], label: string) => void;
  tableRef: RefObject<HTMLDivElement | null>;
}

function ActionCardItem({ card, onDismiss, onFilter, tableRef }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const s = STYLE[card.priority];
  const canExpand = card.priority !== "İYİLEŞTİRME" && card.relatedRuns.length > 0;

  const handleCardClick = () => {
    if (card.relatedRunIds.length === 0) return;
    onFilter(card.relatedRunIds, card.title);
    setTimeout(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  return (
    <div
      className={`relative bg-card border rounded-lg p-5 transition-colors ${s.cardBorder} ${
        card.relatedRunIds.length > 0 ? "cursor-pointer" : "cursor-default"
      }`}
      onClick={handleCardClick}
    >
      {/* Dismiss button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(card.id); }}
        className="absolute top-2.5 right-2.5 text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent rounded p-0.5 transition-colors"
        title="Gizle"
      >
        <X size={14} />
      </button>

      {/* Badge row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${s.badge}`}>
          {card.priority}
        </span>
        {card.countBadge !== undefined && (
          <span className="inline-block bg-muted text-muted-foreground text-[11px] font-semibold px-2 py-0.5 rounded-full">
            {card.countBadge}× başarısız
          </span>
        )}
      </div>

      {/* Title */}
      <p className={`text-[15px] font-semibold mt-2.5 mb-2 ${s.title}`}>
        {card.title}
      </p>

      {/* Body */}
      <p className="text-[13px] text-muted-foreground leading-relaxed">
        {card.body}
      </p>

      {/* Detayları Gör button */}
      {canExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          className="mt-3.5 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "Gizle" : "Detayları Gör"}
        </button>
      )}

      {expanded && <ExpandPanel card={card} />}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

interface NextStepsPanelProps {
  runs: Run[];
  tableRef: RefObject<HTMLDivElement | null>;
  onFilter: (ids: string[], label: string) => void;
}

export function NextStepsPanel({ runs, tableRef, onFilter }: NextStepsPanelProps) {
  const allCards = deriveCards(runs);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visibleCards = allCards.filter((c) => !dismissed.has(c.id));
  const hiddenCount = dismissed.size;

  const agilCount = visibleCards.filter((c) => c.priority === "ACİL").length;
  const onemliCount = visibleCards.filter((c) => c.priority === "ÖNEMLİ").length;

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set(Array.from(prev).concat(id)));
  };

  const handleShowAll = () => {
    setDismissed(new Set());
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground">
          Kaliteyi Artırmak İçin Öncelikli Aksiyonlar
        </h3>
        {agilCount > 0 && (
          <span className="inline-flex items-center gap-1 bg-destructive/15 text-destructive text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-destructive/30">
            🔴 {agilCount}
          </span>
        )}
        {onemliCount > 0 && (
          <span className="inline-flex items-center gap-1 bg-warning/10 text-warning text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-warning/30">
            🟠 {onemliCount}
          </span>
        )}
      </div>

      {/* Cards grid */}
      {visibleCards.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {visibleCards.map((card) => (
            <ActionCardItem
              key={card.id}
              card={card}
              onDismiss={handleDismiss}
              onFilter={onFilter}
              tableRef={tableRef}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/60">Tüm kartlar gizlendi.</p>
      )}

      {/* Dismissed restore link */}
      {hiddenCount > 0 && (
        <div className="mt-3.5">
          <button
            onClick={handleShowAll}
            className="text-xs text-primary hover:text-primary/80 underline transition-colors"
          >
            {hiddenCount} kart gizlendi — Göster
          </button>
        </div>
      )}
    </div>
  );
}
