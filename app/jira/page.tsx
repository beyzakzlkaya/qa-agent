"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Play,
  RefreshCw,
  GitBranch,
  Loader2,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ClipboardList,
  Clock,
  User,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TestCase, PrAnalysis } from "@/lib/types";
import { extractDiffRisks } from "@/lib/jira-pipeline/diff-risks";

type Environment = "preprod" | "prod";

interface JiraTask {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee?: string;
  updated: string;
  url: string;
}

type PageState =
  | { step: "list" }
  | { step: "form"; selectedTask?: JiraTask }
  | { step: "generating" }
  | { step: "preview"; cases: TestCase[]; taskKey: string; prUrl?: string; prAnalysis?: PrAnalysis; environment: Environment; runType: string }
  | { step: "running"; runId: string }
  | { step: "error"; message: string; detail?: string };

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    highest: "bg-destructive/10 text-destructive border-destructive/20",
    high: "bg-warning/10 text-warning border-warning/20",
    medium: "bg-warning/5 text-warning/80 border-warning/15",
    low: "bg-success/10 text-success border-success/20",
    lowest: "bg-primary/10 text-primary border-primary/20",
  };
  const key = priority.toLowerCase();
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide", styles[key] ?? styles.medium)}>
      {priority}
    </span>
  );
}

function TimeAgo({ iso }: { iso: string }) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let label: string;
  if (diffDays > 0) label = `${diffDays}g önce`;
  else if (diffHours > 0) label = `${diffHours}s önce`;
  else if (diffMins > 0) label = `${diffMins}dk önce`;
  else label = "az önce";

  return <span className="text-[11px] text-muted-foreground">{label}</span>;
}

function JiraTaskCard({ task, onSelect }: { task: JiraTask; onSelect: () => void }) {
  return (
    <div className="group border border-border bg-card rounded-lg p-4 hover:border-primary/40 hover:bg-primary/[0.02] transition-all duration-150 cursor-pointer" onClick={onSelect}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-xs font-mono font-semibold text-primary">{task.key}</span>
            <span className="w-1 h-1 rounded-full bg-border inline-block" />
            <PriorityBadge priority={task.priority} />
            {task.assignee && (
              <>
                <span className="w-1 h-1 rounded-full bg-border inline-block" />
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <User className="w-3 h-3" />
                  {task.assignee}
                </span>
              </>
            )}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">{task.summary}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <TimeAgo iso={task.updated} />
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
              JIRA
            </a>
          </div>
        </div>
        <div className="shrink-0 w-7 h-7 rounded-md bg-primary/5 group-hover:bg-primary/15 flex items-center justify-center transition-colors">
          <ArrowRight className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>
    </div>
  );
}

function CasePreviewCard({ tc, selected, onToggle }: { tc: TestCase; selected: boolean; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isEdge = tc.title.startsWith("[Edge]");
  const steps = tc.prompt.split("\n").filter((l) => l.trim() && !l.startsWith("Beklenen sonuç:"));

  return (
    <div className={cn("border rounded-lg transition-all duration-150", selected ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:border-border/80")}>
      <div className="flex items-start gap-3 p-3">
        <button onClick={onToggle} className={cn("mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors", selected ? "bg-primary border-primary" : "border-border hover:border-primary/50")}>
          {selected && (
            <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10">
              <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", isEdge ? "bg-primary/10 text-primary border-primary/20" : "bg-primary/10 text-primary border-primary/20")}>
              {isEdge ? "Edge Case" : "Happy Path"}
            </span>
            <PriorityBadge priority={tc.priority} />
            <span className="text-[10px] text-muted-foreground font-mono">{tc.id}</span>
          </div>
          <p className="text-sm font-medium text-foreground mt-1.5 leading-snug">{tc.title.replace(/^\[Edge\] /, "")}</p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tc.expectedOutcome}</p>
        </div>
        <button onClick={() => setExpanded((v) => !v)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/50 pt-2.5 space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Adımlar</p>
          {steps.map((step, i) => (
            <div key={i} className="flex gap-2 text-xs text-foreground/80">
              <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px] mt-0.5 w-4 text-right">{i + 1}.</span>
              <span className="leading-relaxed">{step}</span>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-border/40">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Beklenen Sonuç</p>
            <p className="text-xs text-foreground/70 leading-relaxed">{tc.expectedOutcome}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PR Diff Analysis Card ────────────────────────────────────────────────────

/** Diff içindeki riskli değişiklikleri tespit eder */
function PrDiffAnalysisCard({ prAnalysis }: { prAnalysis: PrAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);

  const totalAdditions = prAnalysis.fileChanges.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = prAnalysis.fileChanges.reduce((s, f) => s + f.deletions, 0);
  const anomalies = extractDiffRisks(prAnalysis);

  return (
    <div className="border border-success/25 bg-success/5 rounded-lg mb-5 overflow-hidden">
      {/* Header — accordion toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-success/5 transition-colors text-left"
      >
        <GitBranch className="w-4 h-4 text-success shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-success/80">GitHub PR Diff Analizi</span>
            {prAnalysis.prNumber && (
              <a
                href={prAnalysis.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-success/80 bg-success/10 px-1.5 py-0.5 rounded border border-success/20 hover:border-success/40 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                #{prAnalysis.prNumber} ↗
              </a>
            )}
            <span className="text-[10px] font-mono text-success/60">+{totalAdditions}</span>
            <span className="text-[10px] font-mono text-destructive/60">-{totalDeletions}</span>
            <span className="text-[10px] text-success/50">{prAnalysis.fileChanges.length} dosya</span>
            {anomalies.length > 0 && (
              <span className="text-[10px] bg-warning/10 text-warning border border-warning/20 px-1.5 py-0.5 rounded font-medium">
                {anomalies.length} risk
              </span>
            )}
          </div>
          <p className="text-xs text-success/60 mt-0.5 font-medium leading-snug truncate">{prAnalysis.title}</p>
        </div>
          {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-success/50 shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-success/50 shrink-0" />}
      </button>

      {/* Accordion body */}
      {expanded && (
          <div className="border-t border-success/15">
          {/* Anomali uyarıları */}
          {anomalies.length > 0 && (
            <div className="mx-3 mt-3 mb-2 rounded border border-warning/25 bg-warning/5 p-2.5 space-y-1.5">
              <p className="text-[10px] font-semibold text-warning uppercase tracking-wide flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Test edilmesi gereken riskli noktalar
              </p>
              {anomalies.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-warning/70 text-[10px] shrink-0 mt-0.5">•</span>
                  <p className="text-[11px] text-warning/60 leading-relaxed">{w}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tetikleyici */}
          <div className="px-3 pt-2 pb-2">
            <span className="text-[10px] font-medium text-success/50 uppercase tracking-wide">Tetikleyici: </span>
            <span className="text-[11px] text-foreground/70">{prAnalysis.triggerAction}</span>
          </div>

          {/* Kod değişiklikleri özeti */}
          {prAnalysis.codeChangeSummary && (
            <div className="mx-3 mb-2 rounded border border-success/15 bg-background/40 p-2.5">
              <p className="text-[10px] font-semibold text-success/60 uppercase tracking-wide mb-2">Kod Değişiklikleri</p>
              <div className="space-y-1">
                {prAnalysis.codeChangeSummary.split("\n").filter(Boolean).map((line, i) => {
                  const isFile = line.startsWith("📄");
                  const isAdded = line.trim().startsWith("Eklenenler:");
                  const isRemoved = line.trim().startsWith("Silinenler:");
                  const isHeader = line.startsWith("Toplam");
                  return (
                    <p
                      key={i}
                      className={cn(
                        "text-[11px] leading-relaxed",
                        isHeader ? "text-muted-foreground italic mb-1" : "",
                        isFile ? "text-foreground/85 font-medium mt-2 first:mt-0" : "",
                        isAdded ? "text-success/80 pl-3 font-mono text-[10px]" : "",
                        isRemoved ? "text-destructive/70 pl-3 font-mono text-[10px]" : "",
                        !isFile && !isAdded && !isRemoved && !isHeader ? "text-muted-foreground pl-3" : "",
                      )}
                    >
                      {line}
                    </p>
                  );
                })}
              </div>
            </div>
          )}

          {/* Değişen dosyalar — iç accordion */}
          <div className="border-t border-success/15">
            <button
              type="button"
              onClick={() => setFilesExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-success/5 transition-colors text-left"
            >
              <span className="text-[10px] font-medium text-success/60 uppercase tracking-wide">
                Değişen Dosyalar ({prAnalysis.fileChanges.length})
              </span>
              {filesExpanded ? <ChevronUp className="w-3 h-3 text-success/50" /> : <ChevronDown className="w-3 h-3 text-success/50" />}
            </button>
            {filesExpanded && (
              <div className="px-3 pb-3 space-y-1">
                {prAnalysis.fileChanges.map((f) => (
                  <div key={f.filename} className="flex items-center gap-2 text-[11px]">
                    <span className={cn(
                      "text-[9px] font-mono px-1 py-0.5 rounded shrink-0",
                      f.status === "added" ? "bg-success/15 text-success" :
                      f.status === "removed" ? "bg-destructive/15 text-destructive" :
                      "bg-warning/15 text-warning"
                    )}>
                      {f.status === "added" ? "YENİ" : f.status === "removed" ? "SİL" : "DEĞ"}
                    </span>
                    <span className="font-mono text-foreground/60 truncate flex-1">{f.filename}</span>
                    <span className="shrink-0 font-mono text-success/60">+{f.additions}</span>
                    <span className="shrink-0 font-mono text-destructive/60">-{f.deletions}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Workflow steps indicator ───────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { id: "ready", label: "READY FOR QA", short: "Hazır" },
  { id: "generating", label: "Test Üretimi", short: "Üretim" },
  { id: "in_qa", label: "IN QA", short: "Test" },
  { id: "rtr", label: "RTR", short: "RTR" },
];

function WorkflowIndicator({ activeStep }: { activeStep: string }) {
  const activeIndex = WORKFLOW_STEPS.findIndex((s) => s.id === activeStep);
  return (
    <div className="flex items-center gap-0">
      {WORKFLOW_STEPS.map((step, i) => {
        const isActive = step.id === activeStep;
        const isDone = i < activeIndex;
        return (
          <div key={step.id} className="flex items-center">
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all",
              isActive ? "bg-primary text-primary-foreground" :
              isDone ? "bg-success/15 text-success" :
              "bg-muted text-muted-foreground"
            )}>
              {isDone && <CheckCircle className="w-3 h-3" />}
              <span>{step.short}</span>
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div className={cn("w-6 h-px mx-0.5", isDone ? "bg-success/40" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function JiraPage() {
  const router = useRouter();

  // Task list state
  const [tasks, setTasks] = useState<JiraTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  // Form state
  const [taskKey, setTaskKey] = useState("");
  const [environment, setEnvironment] = useState<Environment>("preprod");
  const [refreshContext, setRefreshContext] = useState(false);
  const [pageState, setPageState] = useState<PageState>({ step: "list" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExecuting, setIsExecuting] = useState(false);

  const isValidKey = TASK_KEY_REGEX.test(taskKey.trim().toUpperCase());

  // ── Fetch READY FOR QA tasks
  const fetchTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const res = await fetch("/api/jira/tasks?status=READY+FOR+QA");
      const data = await res.json() as { tasks?: JiraTask[]; error?: string };
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
    if (pageState.step === "list") {
      fetchTasks();
    }
  }, [pageState.step, fetchTasks]);

  // ── Generate test cases
  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidKey || pageState.step === "generating") return;

    const key = taskKey.trim().toUpperCase();
    setPageState({ step: "generating" });

    try {
      const res = await fetch("/api/jira-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskKey: key, environment, refreshContext, generateOnly: true }),
      });

      const data = await res.json() as {
        cases?: TestCase[];
        taskKey?: string;
        prUrl?: string;
        prAnalysis?: PrAnalysis;
        environment?: string;
        runType?: string;
        error?: string;
      };

      if (!res.ok || data.error) {
        setPageState({ step: "error", message: "Test case üretilemedi", detail: data.error });
        return;
      }

      const cases = data.cases ?? [];
      setSelectedIds(new Set(cases.map((c) => c.id)));
      setPageState({
        step: "preview",
        cases,
        taskKey: data.taskKey ?? key,
        prUrl: data.prUrl ?? undefined,
        prAnalysis: data.prAnalysis ?? undefined,
        environment,
        runType: data.runType ?? "regression",
      });
    } catch (err) {
      setPageState({ step: "error", message: "Bağlantı hatası", detail: (err as Error).message });
    }
  }

  // ── Run tests
  async function handleRunTests() {
    if (pageState.step !== "preview") return;
    setIsExecuting(true);

    try {
      const res = await fetch("/api/jira-run/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskKey: pageState.taskKey,
          environment: pageState.environment,
          runType: pageState.runType,
          cases: pageState.cases,
          selectedIds: Array.from(selectedIds),
        }),
      });

      const data = await res.json() as { runId?: string; error?: string };

      if (!res.ok || data.error) {
        setIsExecuting(false);
        setPageState({ step: "error", message: "Test koşumu başlatılamadı", detail: data.error });
        return;
      }

      setPageState({ step: "running", runId: data.runId! });
      setTimeout(() => { router.push(`/run/${data.runId}`); }, 800);
    } catch (err) {
      setIsExecuting(false);
      setPageState({ step: "error", message: "Bağlantı hatası", detail: (err as Error).message });
    }
  }

  function toggleAll(cases: TestCase[]) {
    if (selectedIds.size === cases.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(cases.map((c) => c.id)));
  }

  function toggleCase(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectTask(task: JiraTask) {
    setTaskKey(task.key);
    setPageState({ step: "form", selectedTask: task });
  }

  // ── PREVIEW screen
  if (pageState.step === "preview") {
    const { cases, taskKey: tKey, prUrl, prAnalysis } = pageState;
    const happyPaths = cases.filter((c) => !c.title.startsWith("[Edge]"));
    const edgeCases = cases.filter((c) => c.title.startsWith("[Edge]"));
    const allSelected = selectedIds.size === cases.length;

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto p-6">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => { setPageState({ step: "form" }); setSelectedIds(new Set()); }} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Üretilen Test Caseleri
              </h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono">{tKey}</span>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">{cases.length} test case</span>
                {prUrl && (
                  <>
                    <span className="text-xs text-muted-foreground">•</span>
                    <a href={prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <ExternalLink className="w-3 h-3" />PR
                    </a>
                  </>
                )}
              </div>
            </div>
            <button onClick={handleRunTests} disabled={selectedIds.size === 0 || isExecuting} className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all", selectedIds.size > 0 && !isExecuting ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]" : "bg-muted text-muted-foreground cursor-not-allowed")}>
              {isExecuting ? (<><Loader2 className="w-4 h-4 animate-spin" />Başlatılıyor...</>) : (<><Play className="w-4 h-4" />Testi Koş{selectedIds.size > 0 && <span className="bg-primary-foreground/20 text-xs px-1.5 py-0.5 rounded-full font-mono">{selectedIds.size}</span>}</>)}
            </button>
          </div>

          {/* Workflow indicator */}
          <div className="flex justify-center mb-5">
            <WorkflowIndicator activeStep="generating" />
          </div>

          {/* Info banner */}
          <div className="bg-warning/8 border border-warning/20 rounded-lg p-3 mb-5 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning/60">
              <span className="font-medium text-warning/80">Testi Koş</span> butonuna bastığında JIRA&apos;da task&apos;ın durumu <span className="font-mono font-medium">IN QA</span>&apos;ya geçecek. Test bitince otomatik olarak <span className="font-mono font-medium">RTR</span> yapılacak ve detaylı rapor comment olarak eklenecek.
            </p>
          </div>

          {/* PR Diff Analysis */}
          {prAnalysis && <PrDiffAnalysisCard prAnalysis={prAnalysis} />}

          <div className="flex items-center justify-between mb-3">
            <button onClick={() => toggleAll(cases)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <span className={cn("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors", allSelected ? "bg-primary border-primary" : "border-border hover:border-primary/50")}>
                {allSelected && <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 10 10"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              Tümünü seç
            </button>
            <span className="text-xs text-muted-foreground">{selectedIds.size}/{cases.length} seçili</span>
          </div>

          {happyPaths.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary inline-block" />Happy Paths ({happyPaths.length})
              </p>
              <div className="space-y-2">
                {happyPaths.map((tc) => <CasePreviewCard key={tc.id} tc={tc} selected={selectedIds.has(tc.id)} onToggle={() => toggleCase(tc.id)} />)}
              </div>
            </div>
          )}

          {edgeCases.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary/60 inline-block" />Edge Cases ({edgeCases.length})
              </p>
              <div className="space-y-2">
                {edgeCases.map((tc) => <CasePreviewCard key={tc.id} tc={tc} selected={selectedIds.has(tc.id)} onToggle={() => toggleCase(tc.id)} />)}
              </div>
            </div>
          )}

          <div className="sticky bottom-0 bg-background/80 backdrop-blur border-t border-border pt-3 pb-4">
            <button onClick={handleRunTests} disabled={selectedIds.size === 0 || isExecuting} className={cn("w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all", selectedIds.size > 0 && !isExecuting ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]" : "bg-muted text-muted-foreground cursor-not-allowed")}>
              {isExecuting ? (<><Loader2 className="w-4 h-4 animate-spin" />Test koşumu başlatılıyor...</>) : (<><Play className="w-4 h-4" />{selectedIds.size === 0 ? "Test case seçin" : `${selectedIds.size} Test Case'i Koş — IN QA → RTR`}</>)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RUNNING state
  if (pageState.step === "running") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <WorkflowIndicator activeStep="in_qa" />
          <Loader2 className="w-6 h-6 animate-spin text-primary mt-2" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">JIRA durumu IN QA&apos;ya alındı</p>
            <p className="text-xs text-muted-foreground mt-1">Canlı izleme sayfasına yönlendiriliyorsunuz...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── TASK LIST screen
  if (pageState.step === "list") {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto p-6">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => router.back()} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-primary" />
                JIRA Pipeline
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">READY FOR QA task&apos;larını test et, sonuçları otomatik raporla</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={fetchTasks} disabled={tasksLoading} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Yenile">
                <RotateCcw className={cn("w-4 h-4", tasksLoading && "animate-spin")} />
              </button>
              <button onClick={() => { setTaskKey(""); setPageState({ step: "form" }); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all">
                Manuel Gir
              </button>
            </div>
          </div>

          {/* Workflow overview */}
          <div className="bg-card border border-border rounded-lg p-4 mb-6">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Otomatik QA Akışı</p>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <WorkflowIndicator activeStep="ready" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mt-3">
              {[
                { step: "1", label: "JIRA task analizi" },
                { step: "2", label: "GitHub PR diff analizi" },
                { step: "3", label: "LLM ile test case üretimi" },
                { step: "4", label: "Test caselerini önizle & seç" },
                { step: "5", label: "IN QA → Page-agent ile test" },
                { step: "6", label: "RTR → JIRA&apos;ya detaylı rapor" },
              ].map((item) => (
                <div key={item.step} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">{item.step}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Task list */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" />
              READY FOR QA
              {tasks.length > 0 && (
                <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-mono">{tasks.length}</span>
              )}
            </h2>
          </div>

          {tasksLoading && (
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
                <button onClick={fetchTasks} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors">
                  <RefreshCw className="w-3 h-3" />Tekrar dene
                </button>
              </div>
            </div>
          )}

          {!tasksLoading && !tasksError && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground border border-dashed border-border rounded-lg">
              <CheckCircle className="w-8 h-8 text-success/40" />
              <div className="text-center">
                <p className="text-sm font-medium">READY FOR QA task yok</p>
                <p className="text-xs text-muted-foreground mt-1">Tüm task&apos;lar tamamlandı veya başka statüde.</p>
              </div>
              <button onClick={() => { setTaskKey(""); setPageState({ step: "form" }); }} className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all">
                Manuel task gir
              </button>
            </div>
          )}

          {!tasksLoading && !tasksError && tasks.length > 0 && (
            <div className="space-y-2">
              {tasks.map((task) => (
                <JiraTaskCard key={task.key} task={task} onSelect={() => selectTask(task)} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── FORM + GENERATING + ERROR screens
  const selectedTask = pageState.step === "form" ? pageState.selectedTask : undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => { setPageState({ step: "list" }); setTaskKey(""); }} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-primary" />
              JIRA Pipeline
            </h1>
            {selectedTask && (
              <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <span className="font-mono text-primary text-xs">{selectedTask.key}</span>
                <span>•</span>
                <span className="truncate">{selectedTask.summary}</span>
              </p>
            )}
          </div>
        </div>

        {/* Workflow indicator */}
        {pageState.step !== "error" && (
          <div className="flex justify-center mb-6">
            <WorkflowIndicator activeStep={pageState.step === "generating" ? "generating" : "ready"} />
          </div>
        )}

        {/* Selected task info */}
        {selectedTask && pageState.step === "form" && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-5 flex items-start gap-2.5">
            <ClipboardList className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-xs font-mono font-bold text-primary">{selectedTask.key}</span>
                <PriorityBadge priority={selectedTask.priority} />
                {selectedTask.assignee && <span className="text-[11px] text-muted-foreground">{selectedTask.assignee}</span>}
              </div>
              <p className="text-sm text-foreground leading-snug">{selectedTask.summary}</p>
            </div>
            <a href={selectedTask.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors shrink-0">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        <form onSubmit={handleGenerate} className="bg-card border border-border rounded-lg p-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">JIRA Task Numarası</label>
            <input
              type="text"
              value={taskKey}
              onChange={(e) => setTaskKey(e.target.value.toUpperCase())}
              placeholder="GM-123"
              disabled={pageState.step === "generating"}
              className={cn(
                "w-full px-3 py-2 rounded-md border bg-background text-foreground",
                "placeholder:text-muted-foreground text-sm font-mono",
                "focus:outline-none focus:ring-2 focus:ring-ring transition-colors",
                taskKey && !isValidKey ? "border-destructive focus:ring-destructive/30" : "border-border"
              )}
            />
            {taskKey && !isValidKey && <p className="text-xs text-destructive mt-1">Geçerli format: GM-123, PROJECT-456 gibi</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Ortam</label>
            <div className="grid grid-cols-2 gap-2">
              {(["preprod", "prod"] as Environment[]).map((env) => (
                <button key={env} type="button" disabled={pageState.step === "generating"} onClick={() => setEnvironment(env)} className={cn("px-3 py-2 rounded-md border text-sm font-medium transition-all", environment === env ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground")}>
                  {env === "preprod" ? "Preprod" : "Production"}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer group">
            <div onClick={() => pageState.step !== "generating" && setRefreshContext((v) => !v)} className={cn("w-9 h-5 rounded-full border transition-colors relative shrink-0", refreshContext ? "bg-primary border-primary" : "bg-muted border-border group-hover:border-primary/50")}>
              <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", refreshContext ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Context güncelle</p>
              <p className="text-xs text-muted-foreground">prompt-library cache&apos;ini sıfırla</p>
            </div>
          </label>

          <button
            type="submit"
            disabled={!isValidKey || pageState.step === "generating"}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all",
              isValidKey && pageState.step !== "generating"
                ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {pageState.step === "generating" ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Test caseler üretiliyor...</>
            ) : (
              <><Sparkles className="w-4 h-4" />Test Caseleri Üret</>
            )}
          </button>
        </form>

        {pageState.step === "generating" && (
          <div className="mt-4 bg-primary/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Loader2 className="w-4 h-4 text-primary animate-spin mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-primary">Test caseler üretiliyor</p>
                <p className="text-xs text-primary/60 mt-1">JIRA + GitHub + LLM çağrıları paralel çalışıyor... 15–60 saniye sürebilir.</p>
              </div>
            </div>
          </div>
        )}

        {pageState.step === "error" && (
          <div className="mt-4 bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">{pageState.message}</p>
                {pageState.detail && <p className="text-xs text-muted-foreground mt-1 font-mono">{pageState.detail}</p>}
                <button onClick={() => setPageState({ step: "form" })} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors">
                  <RefreshCw className="w-3 h-3" />Tekrar dene
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
