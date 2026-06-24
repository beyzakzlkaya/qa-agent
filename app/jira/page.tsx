"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  GitBranch,
  Loader2,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  RefreshCw,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { JiraTask } from "@/app/api/jira/tasks/route";
import type { JiraTaskEnrichment } from "@/lib/jira-pipeline/task-enrichment";
import { PipelineStatusStrip } from "@/components/jira-pipeline/PipelineStatusStrip";
import { EnrichedTaskCard } from "@/components/jira-pipeline/EnrichedTaskCard";
import {
  TaskFilterBar,
  type TaskFilterId,
  type TaskSortId,
} from "@/components/jira-pipeline/TaskFilterBar";

const DEFERRED_STORAGE_KEY = "jira-pipeline.deferred";

// ─── Priority weight for sorting ─────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = {
  highest: 5,
  high: 4,
  medium: 3,
  low: 2,
  lowest: 1,
};

function priorityWeight(p: string): number {
  return PRIORITY_WEIGHT[p.toLowerCase()] ?? 2;
}

// ─── Deferred (sonra) storage ────────────────────────────────────────────────

function readDeferred(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEFERRED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function writeDeferred(keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEFERRED_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // ignore quota errors
  }
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function JiraListPage() {
  const router = useRouter();

  const [tasks, setTasks] = useState<JiraTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [activeFilter, setActiveFilter] = useState<TaskFilterId>("all");
  const [sortId, setSortId] = useState<TaskSortId>("sla");
  const [deferred, setDeferred] = useState<string[]>([]);
  const [selectedQa, setSelectedQa] = useState<string | null>(null);

  // Enrichment cache (key → enrichment) — kart bileşeni kendi fetch'ini yapıyor
  // ama sıralama/filtreleme için merkezi bir cache lazım. Her kart enrichment'i
  // yüklerken parent'a bildirsin diye basit bir global event sistemine ihtiyaç var.
  // MVP'de filtreler kartların kendi enrichment state'iyle çalışır — burada da
  // /api/jira/task-enrichment endpoint'ini ayrı çağırıp toplu cache tutuyoruz.
  const [enrichmentMap, setEnrichmentMap] = useState<Record<string, JiraTaskEnrichment>>({});

  const qaUsers = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.qaAssignee) set.add(t.qaAssignee);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [tasks]);

  // ─ Initial load
  useEffect(() => {
    setDeferred(readDeferred());
  }, []);

  const fetchTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const res = await fetch("/api/jira/tasks?status=READY+FOR+QA");
      const data = (await res.json()) as { tasks?: JiraTask[]; error?: string };
      if (!res.ok || data.error) {
        setTasksError(data.error ?? "Görevler alınamadı");
      } else {
        setTasks(data.tasks ?? []);
      }
    } catch (err) {
      setTasksError((err as Error).message);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Görünür her task için enrichment'i arka planda paralel topla (sıralama/filtre için).
  // EnrichedTaskCard kendi enrichment'ini de çekiyor ama her ikisi de 60sn TTL'li
  // process-içi cache'i kullandığı için JIRA/GitHub'a tek istek gider.
  useEffect(() => {
    if (tasks.length === 0) return;
    let cancelled = false;
    const limit = 6;
    let cursor = 0;

    const worker = async () => {
      while (!cancelled && cursor < tasks.length) {
        const idx = cursor++;
        const t = tasks[idx];
        if (enrichmentMap[t.key]) continue;
        try {
          const res = await fetch(
            `/api/jira/task-enrichment/${t.key}?updated=${encodeURIComponent(t.updated)}`
          );
          if (!res.ok) continue;
          const json = (await res.json()) as { enrichment?: JiraTaskEnrichment };
          if (cancelled || !json.enrichment) continue;
          setEnrichmentMap((prev) => ({ ...prev, [t.key]: json.enrichment! }));
        } catch {
          // skip
        }
      }
    };

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
    Promise.all(workers).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [tasks, enrichmentMap]);

  // ─ Defer handlers
  const handleDefer = useCallback((key: string) => {
    setDeferred((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      writeDeferred(next);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (key: string) => {
      router.push(`/jira/${key}`);
    },
    [router]
  );

  // ─ Filter + sort logic
  const { filtered, counts } = useMemo(() => {
    const counts: Partial<Record<TaskFilterId, number>> = {
      all: tasks.length,
      highPriority: 0,
      reopen: 0,
      stuck: 0,
      deferred: deferred.length,
    };

    for (const t of tasks) {
      if (priorityWeight(t.priority) >= 4) counts.highPriority = (counts.highPriority ?? 0) + 1;
      const e = enrichmentMap[t.key];
      if (e && e.reopenCount > 0) counts.reopen = (counts.reopen ?? 0) + 1;
      if (e && (e.waitingHours >= 24 || e.stuckReason)) counts.stuck = (counts.stuck ?? 0) + 1;
    }

    let filtered = [...tasks];

    if (selectedQa) {
      filtered = filtered.filter((t) => t.qaAssignee === selectedQa);
    }

    // Filter
    switch (activeFilter) {
      case "highPriority":
        filtered = filtered.filter((t) => priorityWeight(t.priority) >= 4);
        break;
      case "reopen":
        filtered = filtered.filter((t) => (enrichmentMap[t.key]?.reopenCount ?? 0) > 0);
        break;
      case "stuck":
        filtered = filtered.filter((t) => {
          const e = enrichmentMap[t.key];
          return e ? e.waitingHours >= 24 || !!e.stuckReason : false;
        });
        break;
      case "deferred":
        filtered = filtered.filter((t) => deferred.includes(t.key));
        break;
      case "all":
      default:
        // "Sonra"ya bırakılanları normalde listenin altına gönder
        filtered.sort((a, b) => {
          const aDef = deferred.includes(a.key) ? 1 : 0;
          const bDef = deferred.includes(b.key) ? 1 : 0;
          return aDef - bDef;
        });
        break;
    }

    // Sort
    const compare = (a: JiraTask, b: JiraTask): number => {
      switch (sortId) {
        case "sla": {
          const aw = enrichmentMap[a.key]?.waitingHours ?? 0;
          const bw = enrichmentMap[b.key]?.waitingHours ?? 0;
          return bw - aw;
        }
        case "newest":
          return b.updated.localeCompare(a.updated);
        case "priority":
          return priorityWeight(b.priority) - priorityWeight(a.priority);
        case "complexity": {
          const aFiles = enrichmentMap[a.key]?.pr?.fileCount ?? 0;
          const bFiles = enrichmentMap[b.key]?.pr?.fileCount ?? 0;
          return bFiles - aFiles;
        }
        default:
          return 0;
      }
    };

    if (activeFilter !== "all") {
      filtered.sort(compare);
    } else {
      // Default'ta: deferred altta + sıralamayı uygula
      filtered.sort((a, b) => {
        const aDef = deferred.includes(a.key) ? 1 : 0;
        const bDef = deferred.includes(b.key) ? 1 : 0;
        if (aDef !== bDef) return aDef - bDef;
        return compare(a, b);
      });
    }

    return { filtered, counts };
  }, [tasks, activeFilter, sortId, deferred, enrichmentMap, selectedQa]);

  // ─ Render
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push("/")}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Geri dön"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-primary" />
              JIRA Pipeline
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              READY FOR QA task&apos;larını test et, sonuçları otomatik raporla
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTasks}
              disabled={tasksLoading}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Yenile"
            >
              <RotateCcw className={cn("w-4 h-4", tasksLoading && "animate-spin")} />
            </button>
            <button
              onClick={() => router.push("/jira/manual")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
            >
              Manuel Gir
            </button>
          </div>
        </div>

        {/* Pipeline status strip */}
        <PipelineStatusStrip />

        {/* Header for task list */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            READY FOR QA
            {tasks.length > 0 && (
              <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                {tasks.length}
              </span>
            )}
          </h2>
        </div>

        {/* Filters */}
        {tasks.length > 0 && (
          <TaskFilterBar
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            filterCounts={counts}
            sortId={sortId}
            onSortChange={setSortId}
            hasDeferredItems={deferred.length > 0}
            qaUsers={qaUsers}
            selectedQa={selectedQa}
            onQaChange={setSelectedQa}
          />
        )}

        {/* States */}
        {tasksLoading && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">JIRA&apos;dan görevler çekiliyor...</p>
          </div>
        )}

        {!tasksLoading && tasksError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">JIRA bağlantı hatası</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{tasksError}</p>
              <button
                onClick={fetchTasks}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Tekrar dene
              </button>
            </div>
          </div>
        )}

        {!tasksLoading && !tasksError && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground border border-dashed border-border rounded-lg">
            <CheckCircle className="w-8 h-8 text-success/40" />
            <div className="text-center">
              <p className="text-sm font-medium">READY FOR QA task yok</p>
              <p className="text-xs text-muted-foreground mt-1">
                Tüm task&apos;lar tamamlandı veya başka statüde.
              </p>
            </div>
          </div>
        )}

        {!tasksLoading && !tasksError && tasks.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground border border-dashed border-border rounded-lg">
            <p className="text-sm">Bu filtreyle eşleşen task yok</p>
            <button
              onClick={() => setActiveFilter("all")}
              className="text-xs text-primary hover:underline"
            >
              Filtreyi temizle
            </button>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((task) => (
              <EnrichedTaskCard
                key={task.key}
                task={task}
                onSelect={() => handleSelect(task.key)}
                onDefer={handleDefer}
                highlightAssignee={selectedQa ?? undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
