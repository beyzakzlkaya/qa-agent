"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Clock4, Bug, ShieldCheck, AlertTriangle } from "lucide-react";

interface ActiveRun {
  id: string;
  name: string;
  environment: string;
  startedAt: string;
}

interface ActiveRunsResp {
  running: ActiveRun[];
  queued: ActiveRun[];
}

interface JiraBugStats {
  openP0: number;
  openP1: number;
  openTickets: number;
  available: boolean;
  projectKey: string;
  criticalBugsUrl?: string;
  highestBugsUrl?: string;
  highBugsUrl?: string;
}

interface EnvProbe {
  url: string;
  status: "up" | "down" | "degraded";
  httpStatus?: number;
  latencyMs?: number;
}

interface EnvHealth {
  env: string;
  overall: "up" | "down" | "degraded";
  probes: Record<string, EnvProbe>;
}

interface EnvHealthResp {
  preprod: EnvHealth;
  prod: EnvHealth;
}

export function LiveStatusStrip() {
  const [active, setActive] = useState<ActiveRunsResp | null>(null);
  const [jira, setJira] = useState<JiraBugStats | null>(null);
  const [env, setEnv] = useState<EnvHealthResp | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [a, j, e] = await Promise.all([
          fetch("/api/runs/active").then((r) => r.json()).catch(() => null),
          fetch("/api/jira/bug-stats").then((r) => r.json()).catch(() => null),
          fetch("/api/env-health").then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        if (a) setActive(a);
        if (j) setJira(j);
        if (e) setEnv(e);
      } catch {
        // silent
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const runningCount = active?.running.length ?? 0;
  const queuedCount = active?.queued.length ?? 0;
  const runningNames = (active?.running ?? []).slice(0, 6).map((r) => r.name).join("\n");

  const totalCritical = (jira?.openP0 ?? 0) + (jira?.openP1 ?? 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Şu an çalışan testler */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Şu an çalışan</p>
          <Activity className="w-3.5 h-3.5 text-primary" />
        </div>
        <p
          className={`text-3xl font-bold ${runningCount > 0 ? "text-primary" : "text-foreground"}`}
          title={runningNames || "Aktif test yok"}
        >
          {runningCount}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2 truncate" title={runningNames}>
          {runningCount > 0
            ? (active?.running[0]?.name ?? "")
            : "Aktif test yok"}
        </p>
      </div>

      {/* Kuyrukta bekleyen */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Kuyrukta</p>
          <Clock4 className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <p className={`text-3xl font-bold ${queuedCount > 0 ? "text-warning" : "text-foreground"}`}>
          {queuedCount}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">
          {queuedCount > 0 ? "Test sırada bekliyor" : "Sıra boş"}
        </p>
      </div>

      {/* Açık buglar — Highest + High (her biri ayrı tıklanabilir) */}
      <div className="bg-card border border-border rounded-lg p-4 hover:border-destructive/40 transition-colors">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Açık Buglar</p>
          <Bug
            className={`w-3.5 h-3.5 ${totalCritical > 0 ? "text-destructive" : "text-muted-foreground"}`}
          />
        </div>
        {jira?.available ? (
          <div className="flex items-end gap-3 mt-1">
            <a
              href={jira.highestBugsUrl ?? "/jira"}
              target={jira.highestBugsUrl ? "_blank" : undefined}
              rel="noreferrer"
              className="block hover:opacity-80 transition-opacity"
              title="JIRA'da Highest bug filtresini aç"
            >
              <p className="text-[10px] uppercase tracking-wide font-semibold text-destructive">
                Highest
              </p>
              <p className="text-3xl font-bold text-destructive leading-tight">
                {jira.openP0}
              </p>
            </a>
            <div className="h-8 w-px bg-border self-end" />
            <a
              href={jira.highBugsUrl ?? "/jira"}
              target={jira.highBugsUrl ? "_blank" : undefined}
              rel="noreferrer"
              className="block hover:opacity-80 transition-opacity"
              title="JIRA'da High bug filtresini aç"
            >
              <p className="text-[10px] uppercase tracking-wide font-semibold text-warning">
                High
              </p>
              <p className="text-3xl font-bold text-warning leading-tight">
                {jira.openP1}
              </p>
            </a>
            <a
              href={jira.criticalBugsUrl ?? "/jira"}
              target={jira.criticalBugsUrl ? "_blank" : undefined}
              rel="noreferrer"
              className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground ml-auto self-end pb-1 underline-offset-2 hover:underline"
              title="Highest + High bug filtresini aç"
            >
              toplam {totalCritical}
            </a>
          </div>
        ) : (
          <>
            <p className="text-3xl font-bold text-foreground">—</p>
            <p className="text-[11px] text-muted-foreground/70 mt-2">
              JIRA bağlı değil
            </p>
          </>
        )}
      </div>

      {/* Ortam sağlığı */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Ortam sağlığı</p>
          {env ? (
            env.preprod.overall === "up" && env.prod.overall === "up" ? (
              <ShieldCheck className="w-3.5 h-3.5 text-success" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            )
          ) : (
            <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
        <div className="mt-1 space-y-1.5">
          <EnvRow label="Preprod" env={env?.preprod} />
          <EnvRow label="Prod" env={env?.prod} />
        </div>
      </div>
    </div>
  );
}

function EnvRow({ label, env }: { label: string; env?: EnvHealth }) {
  const dotColor =
    env?.overall === "up"
      ? "bg-success"
      : env?.overall === "degraded"
      ? "bg-warning"
      : env?.overall === "down"
      ? "bg-destructive"
      : "bg-muted-foreground/40";

  const statusText =
    env?.overall === "up"
      ? "Erişilebilir"
      : env?.overall === "degraded"
      ? "Yavaş/uyarı"
      : env?.overall === "down"
      ? "Erişilemiyor"
      : "—";

  const tooltip = env
    ? Object.entries(env.probes)
        .map(
          ([k, p]) =>
            `${k}: ${p.status}${p.httpStatus ? ` (${p.httpStatus})` : ""}${
              p.latencyMs ? ` · ${p.latencyMs}ms` : ""
            }`
        )
        .join("\n")
    : "";

  return (
    <div
      className="flex items-center justify-between text-[11px]"
      title={tooltip}
    >
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className={`w-2 h-2 rounded-full inline-block ${dotColor}`} />
        {label}
      </span>
      <span className="font-medium text-muted-foreground">{statusText}</span>
    </div>
  );
}
