"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TestRun } from "@/lib/types";
import { RunStatusBadge } from "@/components/dashboard/RunStatusBadge";
import { FileText } from "lucide-react";

export default function ReportsPage() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setRuns((d.runs ?? []).filter((r: TestRun) => r.status !== "running")))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Raporlar</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Tamamlanan testlerin detaylı raporları
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <FileText className="w-8 h-8 opacity-30" />
            <p className="text-sm">Henüz tamamlanan test yok.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/reports/${run.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <RunStatusBadge status={run.status} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{run.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {run.environment} •{" "}
                      {new Date(run.startedAt).toLocaleString("tr-TR")}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {run.passedCases}/{run.totalCases} geçti
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
