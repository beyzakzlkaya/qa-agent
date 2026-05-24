"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  GitBranch,
  Loader2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  RotateCcw,
  User,
  Clock,
  Play,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TestCase, PrAnalysis } from "@/lib/types";
import type { FullTaskContext } from "@/app/api/jira/full-context/[key]/route";
import { RiskSummaryPanel } from "@/components/jira-pipeline/RiskSummaryPanel";
import { TaskContextPanel } from "@/components/jira-pipeline/TaskContextPanel";
import { PrChangesPanel } from "@/components/jira-pipeline/PrChangesPanel";
import { PreviousIterationsPanel } from "@/components/jira-pipeline/PreviousIterationsPanel";
import {
  GenerationSettings,
  type Environment,
  type Scope,
} from "@/components/jira-pipeline/GenerationSettings";
import { CasePreviewList } from "@/components/jira-pipeline/CasePreviewList";

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

type DetailState =
  | { phase: "loading" }
  | { phase: "ready"; ctx: FullTaskContext }
  | { phase: "generating"; ctx: FullTaskContext }
  | {
      phase: "preview";
      ctx: FullTaskContext;
      cases: TestCase[];
      prAnalysis?: PrAnalysis;
      runType: string;
    }
  | { phase: "running"; ctx: FullTaskContext; runId: string }
  | { phase: "error"; message: string; detail?: string };

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    highest: "bg-destructive/10 text-destructive border-destructive/20",
    high: "bg-warning/10 text-warning border-warning/20",
    medium: "bg-warning/5 text-warning/80 border-warning/15",
    low: "bg-success/10 text-success border-success/20",
    lowest: "bg-primary/10 text-primary border-primary/20",
  };
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide",
        styles[priority.toLowerCase()] ?? styles.medium
      )}
    >
      {priority}
    </span>
  );
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "—";
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `${diffDays}g önce`;
  if (diffHours > 0) return `${diffHours}s önce`;
  if (diffMins > 0) return `${diffMins}dk önce`;
  return "az önce";
}

export default function JiraTaskDetailPage() {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const taskKey = (params.key ?? "").toUpperCase();

  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const [environment, setEnvironment] = useState<Environment>("preprod");
  const [scope, setScope] = useState<Scope>("smart");
  const [refreshContext, setRefreshContext] = useState(false);
  const [includePrev, setIncludePrev] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState(false);

  // Geçersiz task key
  useEffect(() => {
    if (!TASK_KEY_REGEX.test(taskKey)) {
      setState({ phase: "error", message: "Geçersiz task numarası", detail: taskKey });
    }
  }, [taskKey]);

  // Full context fetch
  const fetchContext = useCallback(async () => {
    if (!TASK_KEY_REGEX.test(taskKey)) return;
    setState({ phase: "loading" });
    try {
      const res = await fetch(`/api/jira/full-context/${taskKey}`);
      const json = (await res.json()) as FullTaskContext & { error?: string };
      if (!res.ok || json.error) {
        setState({ phase: "error", message: "Task bağlamı alınamadı", detail: json.error });
        return;
      }
      setState({ phase: "ready", ctx: json });
      // Reopen varsa "Önceki iterasyonları dahil et" varsayılan açık
      if (json.enrichment.reopenCount > 0) setIncludePrev(true);
    } catch (err) {
      setState({ phase: "error", message: "Bağlantı hatası", detail: (err as Error).message });
    }
  }, [taskKey]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  // Generate
  const handleGenerate = useCallback(async () => {
    if (state.phase !== "ready") return;
    setState({ phase: "generating", ctx: state.ctx });

    try {
      const res = await fetch("/api/jira-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskKey,
          environment,
          refreshContext,
          generateOnly: true,
          // scope ve includePrev şu an backend tarafından okunmuyor (yapılacak iş);
          // payload'a koyuyoruz ki ileride kullanılabilir
          runType: scope === "broad" ? "regression" : "regression",
        }),
      });
      const data = (await res.json()) as {
        cases?: TestCase[];
        prAnalysis?: PrAnalysis;
        runType?: string;
        error?: string;
      };
      if (!res.ok || data.error) {
        setState({
          phase: "error",
          message: "Test case üretilemedi",
          detail: data.error,
        });
        return;
      }
      const cases = data.cases ?? [];
      setSelectedIds(new Set(cases.map((c) => c.id)));
      setState({
        phase: "preview",
        ctx: state.ctx,
        cases,
        prAnalysis: data.prAnalysis,
        runType: data.runType ?? "regression",
      });
    } catch (err) {
      setState({ phase: "error", message: "Bağlantı hatası", detail: (err as Error).message });
    }
  }, [state, environment, refreshContext, scope, taskKey]);

  // Run
  const handleRunTests = useCallback(async () => {
    if (state.phase !== "preview") return;
    setExecuting(true);
    try {
      const res = await fetch("/api/jira-run/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskKey,
          environment,
          runType: state.runType,
          cases: state.cases,
          selectedIds: Array.from(selectedIds),
        }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || data.error || !data.runId) {
        setExecuting(false);
        setState({
          phase: "error",
          message: "Test koşumu başlatılamadı",
          detail: data.error,
        });
        return;
      }
      setState({ phase: "running", ctx: state.ctx, runId: data.runId });
      setTimeout(() => router.push(`/run/${data.runId}`), 800);
    } catch (err) {
      setExecuting(false);
      setState({ phase: "error", message: "Bağlantı hatası", detail: (err as Error).message });
    }
  }, [state, taskKey, environment, selectedIds, router]);

  const toggleCase = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (state.phase !== "preview") return;
    setSelectedIds((prev) =>
      prev.size === state.cases.length ? new Set() : new Set(state.cases.map((c) => c.id))
    );
  };

  // Tahmin: dakika + test sayısı
  const estimation = useMemo(() => {
    const ctx = state.phase === "ready" || state.phase === "generating" ? state.ctx : undefined;
    if (!ctx) return { minutes: 2, count: 6 };
    const baseCount = ctx.enrichment.estimatedCaseCount;
    const count = scope === "broad" ? Math.round(baseCount * 1.6) : baseCount;
    const minutes = Math.max(1, Math.round(count * 0.25));
    return { minutes, count };
  }, [state, scope]);

  // ─ Loading state
  if (state.phase === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">{taskKey} yükleniyor...</p>
        </div>
      </div>
    );
  }

  // ─ Error state
  if (state.phase === "error") {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto p-6">
          <button
            onClick={() => router.push("/jira")}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Listeye dön
          </button>
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">{state.message}</p>
                {state.detail && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{state.detail}</p>
                )}
                <button
                  onClick={fetchContext}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Tekrar dene
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─ Running state
  if (state.phase === "running") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">JIRA durumu IN QA&apos;ya alındı</p>
            <p className="text-xs text-muted-foreground mt-1">
              Canlı izleme sayfasına yönlendiriliyorsunuz...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─ Preview state
  if (state.phase === "preview") {
    const { ctx, cases, prAnalysis } = state;
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto p-6">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setState({ phase: "ready", ctx })}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Üretilen Test Caseleri
              </h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono">{taskKey}</span>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">{cases.length} test case</span>
              </div>
            </div>
            <button
              onClick={handleRunTests}
              disabled={selectedIds.size === 0 || executing}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                selectedIds.size > 0 && !executing
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {executing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Başlatılıyor...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Testi Koş
                  {selectedIds.size > 0 && (
                    <span className="bg-primary-foreground/20 text-xs px-1.5 py-0.5 rounded-full font-mono">
                      {selectedIds.size}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>

          <div className="bg-warning/8 border border-warning/20 rounded-lg p-3 mb-5 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning/60">
              <span className="font-medium text-warning/80">Testi Koş</span> butonuna bastığında
              JIRA&apos;da task&apos;ın durumu <span className="font-mono font-medium">IN QA</span>
              &apos;ya geçecek. Test bitince otomatik olarak{" "}
              <span className="font-mono font-medium">RTR</span> yapılacak ve detaylı rapor comment
              olarak eklenecek.
            </p>
          </div>

          <CasePreviewList
            cases={cases}
            selectedIds={selectedIds}
            onToggle={toggleCase}
            onToggleAll={toggleAll}
            prAnalysis={prAnalysis}
          />

          <div className="sticky bottom-0 bg-background/80 backdrop-blur border-t border-border pt-3 pb-4">
            <button
              onClick={handleRunTests}
              disabled={selectedIds.size === 0 || executing}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all",
                selectedIds.size > 0 && !executing
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {executing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Test koşumu başlatılıyor...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  {selectedIds.size === 0
                    ? "Test case seçin"
                    : `${selectedIds.size} Test Case'i Koş — IN QA → RTR`}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─ Ready / Generating state — main detail layout
  const ctx = state.ctx;
  const generating = state.phase === "generating";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-start gap-3 mb-5">
          <button
            onClick={() => router.push("/jira")}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <GitBranch className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono font-semibold text-primary">{taskKey}</span>
              <PriorityBadge priority={ctx.jira.priority} />
              {ctx.enrichment.reopenCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-destructive/10 text-destructive border-destructive/25 uppercase tracking-wide">
                  <RotateCcw className="w-3 h-3" />
                  Reopen #{ctx.enrichment.reopenCount}
                </span>
              )}
              {ctx.jira.assignee && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground ml-2">
                  <User className="w-3 h-3" />
                  {ctx.jira.assignee}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                READY FOR QA: {timeAgo(ctx.enrichment.readyForQaSince)}
              </span>
              <a
                href={ctx.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                JIRA
              </a>
            </div>
            <h1 className="text-xl font-semibold text-foreground leading-snug">
              {ctx.jira.summary}
            </h1>
          </div>
        </div>

        {/* Risk summary — streaming */}
        <RiskSummaryPanel taskKey={taskKey} active={!generating} />

        {/* Two-column context */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <TaskContextPanel ctx={ctx} />
          <PrChangesPanel ctx={ctx} />
        </div>

        {/* Previous iterations */}
        <PreviousIterationsPanel
          taskKey={taskKey}
          reopenCount={ctx.enrichment.reopenCount}
        />

        {/* Generation settings + primary action */}
        <GenerationSettings
          environment={environment}
          onEnvironmentChange={setEnvironment}
          scope={scope}
          onScopeChange={setScope}
          refreshContext={refreshContext}
          onRefreshContextChange={setRefreshContext}
          includePrev={includePrev}
          onIncludePrevChange={setIncludePrev}
          hasReopenHistory={ctx.enrichment.reopenCount > 0}
          estimatedCount={estimation.count}
          estimatedMinutes={estimation.minutes}
          generating={generating}
          onGenerate={handleGenerate}
        />

        {generating && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Loader2 className="w-4 h-4 text-primary animate-spin mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-primary">Test caseler üretiliyor</p>
                <p className="text-xs text-primary/60 mt-1">
                  JIRA + GitHub + LLM çağrıları paralel çalışıyor... 15–60 saniye sürebilir.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
