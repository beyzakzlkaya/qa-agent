import { getDb } from "@/lib/db";
import { loadAllCases } from "@/lib/test-engine/parser";
import type { Domain, Priority } from "@/lib/types";

export const DOMAIN_LABELS: Record<Domain, string> = {
  identity: "Kimlik / Giriş",
  order: "Sipariş",
  inventory: "Envanter",
  "trade-in": "Trade-In",
  buyback: "Buyback",
  warranty: "Garanti",
  refurbishment: "Refurbishment",
  financials: "Finans",
  general: "Genel",
};

const ALL_DOMAINS: Domain[] = [
  "identity",
  "order",
  "inventory",
  "trade-in",
  "buyback",
  "warranty",
  "refurbishment",
  "financials",
  "general",
];

export interface CaseMeta {
  domain: Domain;
  priority: Priority;
  title: string;
}

export function buildCaseIndex(): Map<string, CaseMeta> {
  const idx = new Map<string, CaseMeta>();
  for (const c of loadAllCases()) {
    idx.set(c.id, {
      domain: (c.domain ?? "general") as Domain,
      priority: c.priority,
      title: c.title,
    });
  }
  return idx;
}

export interface ModuleMetric {
  domain: Domain | "custom";
  label: string;
  totalCases: number;
  distinctCases: number;
  failedCases: number;
  passedCases: number;
  passRate: number;
  defectDensity: number;
  hasEnoughSamples: boolean;
  isCustom?: boolean;
  topFailingCases: { caseId: string; title: string | null; failCount: number; totalRuns: number }[];
}

export const MIN_SAMPLES_FOR_RANKING = 5;

interface CaseResultRow {
  case_id: string;
  status: string;
}

interface CaseResultWithDateRow extends CaseResultRow {
  executed_at: string;
}

type AggKey = Domain | "custom";

interface AggSlot {
  totalCases: number;
  failedCases: number;
  passedCases: number;
  caseFailCounts: Map<string, { fail: number; total: number }>;
}

export function getModuleMetrics(windowDays = 30): ModuleMetric[] {
  const db = getDb();
  const caseIndex = buildCaseIndex();

  const rows = db
    .prepare(
      `SELECT case_id, status
       FROM case_results
       WHERE executed_at > datetime('now', '-${windowDays} days')
         AND status IN ('success', 'failed')`
    )
    .all() as CaseResultRow[];

  const agg = new Map<AggKey, AggSlot>();
  const initSlot = (): AggSlot => ({
    totalCases: 0,
    failedCases: 0,
    passedCases: 0,
    caseFailCounts: new Map(),
  });
  for (const d of ALL_DOMAINS) agg.set(d, initSlot());
  agg.set("custom", initSlot());

  for (const r of rows) {
    const meta = caseIndex.get(r.case_id);
    let key: AggKey;
    if (meta) {
      key = meta.domain;
    } else if (r.case_id.startsWith("CUSTOM-")) {
      key = "custom";
    } else {
      key = "general";
    }
    const slot = agg.get(key)!;
    slot.totalCases += 1;
    if (r.status === "failed") slot.failedCases += 1;
    else if (r.status === "success") slot.passedCases += 1;

    const c = slot.caseFailCounts.get(r.case_id) ?? { fail: 0, total: 0 };
    c.total += 1;
    if (r.status === "failed") c.fail += 1;
    slot.caseFailCounts.set(r.case_id, c);
  }

  const out: ModuleMetric[] = [];
  for (const [key, slot] of agg) {
    if (slot.totalCases === 0) continue;
    const passRate = Math.round((slot.passedCases / slot.totalCases) * 1000) / 10;
    const defectDensity = Math.round((slot.failedCases / slot.totalCases) * 1000) / 10;

    const topFailingCases = Array.from(slot.caseFailCounts.entries())
      .filter(([, v]) => v.fail > 0)
      .map(([caseId, v]) => ({
        caseId,
        title: caseIndex.get(caseId)?.title ?? null,
        failCount: v.fail,
        totalRuns: v.total,
      }))
      .sort((a, b) => b.failCount - a.failCount)
      .slice(0, 5);

    const isCustom = key === "custom";
    out.push({
      domain: key,
      label: isCustom ? "Ad-hoc / Özel koşumlar" : DOMAIN_LABELS[key as Domain],
      totalCases: slot.totalCases,
      distinctCases: slot.caseFailCounts.size,
      failedCases: slot.failedCases,
      passedCases: slot.passedCases,
      passRate,
      defectDensity,
      hasEnoughSamples: slot.totalCases >= MIN_SAMPLES_FOR_RANKING,
      isCustom,
      topFailingCases,
    });
  }

  // Significant samples first (sorted by defect density desc), then small
  // samples — within each group custom always last (it's ad-hoc, not a module).
  out.sort((a, b) => {
    if (a.hasEnoughSamples !== b.hasEnoughSamples) return a.hasEnoughSamples ? -1 : 1;
    if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
    return b.defectDensity - a.defectDensity;
  });
  return out;
}

export interface PriorityHealth {
  priority: Priority;
  label: string;
  totalCases: number;
  distinctCases: number;
  failedCases: number;
  passRate: number;
  failRate: number;
  topFailingCases: { caseId: string; title: string; failCount: number; totalRuns: number }[];
}

const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function getPriorityHealth(
  priorities: Priority[] = ["critical", "high"],
  windowDays = 7
): PriorityHealth[] {
  const db = getDb();
  const caseIndex = buildCaseIndex();

  const rows = db
    .prepare(
      `SELECT case_id, status
       FROM case_results
       WHERE executed_at > datetime('now', '-${windowDays} days')
         AND status IN ('success', 'failed')`
    )
    .all() as CaseResultRow[];

  const agg = new Map<
    Priority,
    {
      totalCases: number;
      failedCases: number;
      caseFailCounts: Map<string, { fail: number; total: number }>;
    }
  >();
  for (const p of priorities) {
    agg.set(p, { totalCases: 0, failedCases: 0, caseFailCounts: new Map() });
  }

  for (const r of rows) {
    const meta = caseIndex.get(r.case_id);
    if (!meta) continue;
    const slot = agg.get(meta.priority);
    if (!slot) continue;
    slot.totalCases += 1;
    if (r.status === "failed") slot.failedCases += 1;

    const c = slot.caseFailCounts.get(r.case_id) ?? { fail: 0, total: 0 };
    c.total += 1;
    if (r.status === "failed") c.fail += 1;
    slot.caseFailCounts.set(r.case_id, c);
  }

  return priorities.map((priority) => {
    const slot = agg.get(priority)!;
    const passRate =
      slot.totalCases > 0
        ? Math.round(((slot.totalCases - slot.failedCases) / slot.totalCases) * 1000) / 10
        : 0;
    const failRate =
      slot.totalCases > 0
        ? Math.round((slot.failedCases / slot.totalCases) * 1000) / 10
        : 0;
    const topFailingCases = Array.from(slot.caseFailCounts.entries())
      .filter(([, v]) => v.fail > 0)
      .map(([caseId, v]) => ({
        caseId,
        title: caseIndex.get(caseId)?.title ?? caseId,
        failCount: v.fail,
        totalRuns: v.total,
      }))
      .sort((a, b) => b.failCount - a.failCount)
      .slice(0, 5);

    return {
      priority,
      label: PRIORITY_LABEL[priority],
      totalCases: slot.totalCases,
      distinctCases: slot.caseFailCounts.size,
      failedCases: slot.failedCases,
      passRate,
      failRate,
      topFailingCases,
    };
  });
}
