"use client";

import type { Anomaly } from "@/lib/types";
import { AlertTriangle, Bug, AlertCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const ANOMALY_ICONS = {
  console_error: Bug,
  http_error: AlertCircle,
  outcome_mismatch: AlertTriangle,
  unexpected: Zap,
};

const ANOMALY_LABELS = {
  console_error: "Konsol Hatası",
  http_error: "HTTP Hatası",
  outcome_mismatch: "Sonuç Uyuşmazlığı",
  unexpected: "Beklenmeyen",
};

interface Props {
  anomalies: Anomaly[];
}

export function AnomalyPanel({ anomalies }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/50">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Anomaliler
        </h3>
        {anomalies.length > 0 && (
          <span className="text-xs bg-warning/10 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full">
            {anomalies.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {anomalies.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Anomali bulunamadı ✓
          </div>
        ) : (
          anomalies.map((a, i) => {
            const Icon = ANOMALY_ICONS[a.type];
            return (
              <div
                key={i}
                className="bg-warning/5 border border-warning/20 rounded-lg p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-3.5 h-3.5 text-warning shrink-0" />
                  <span className="text-xs font-medium text-warning">
                    {ANOMALY_LABELS[a.type]}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(a.timestamp).toLocaleTimeString("tr-TR")}
                  </span>
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">
                  {a.message}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
