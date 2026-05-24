"use client";

import { Sparkles, Settings2, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type Environment = "preprod" | "prod";
export type Scope = "smart" | "broad";

interface Props {
  environment: Environment;
  onEnvironmentChange: (env: Environment) => void;
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  refreshContext: boolean;
  onRefreshContextChange: (v: boolean) => void;
  includePrev: boolean;
  onIncludePrevChange: (v: boolean) => void;
  /** Reopen geçmişi varsa "Önceki iterasyonları dahil et" toggle'ı varsayılan açık */
  hasReopenHistory: boolean;
  estimatedCount: number;
  /** Tahmini süre (dakika) */
  estimatedMinutes: number;
  generating: boolean;
  onGenerate: () => void;
}

export function GenerationSettings({
  environment,
  onEnvironmentChange,
  scope,
  onScopeChange,
  refreshContext,
  onRefreshContextChange,
  includePrev,
  onIncludePrevChange,
  hasReopenHistory,
  estimatedCount,
  estimatedMinutes,
  generating,
  onGenerate,
}: Props) {
  return (
    <div className="border border-border bg-card rounded-lg p-4 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Üretim Ayarları</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Environment */}
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Ortam
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {(["preprod", "prod"] as Environment[]).map((env) => (
              <button
                key={env}
                type="button"
                disabled={generating}
                onClick={() => onEnvironmentChange(env)}
                className={cn(
                  "px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all",
                  environment === env
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                )}
              >
                {env === "preprod" ? "Preprod" : "Production"}
              </button>
            ))}
          </div>
        </div>

        {/* Scope */}
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Test Kapsamı
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={generating}
              onClick={() => onScopeChange("smart")}
              className={cn(
                "px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all",
                scope === "smart"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
              title="Sadece değişen kodu kapsayan test case'ler"
            >
              Akıllı
            </button>
            <button
              type="button"
              disabled={generating}
              onClick={() => onScopeChange("broad")}
              className={cn(
                "px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all",
                scope === "broad"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
              title="Etkilenen modüllerin tüm regresyon testleri"
            >
              Geniş
            </button>
          </div>
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2.5 mb-4">
        <ToggleRow
          label="Context güncelle"
          help="prompt-library cache'ini sıfırla"
          checked={refreshContext}
          onChange={onRefreshContextChange}
          disabled={generating}
        />
        {hasReopenHistory && (
          <ToggleRow
            label="Önceki iterasyonları dahil et"
            help="Reopen edilen testlere öncelik ver"
            checked={includePrev}
            onChange={onIncludePrevChange}
            disabled={generating}
          />
        )}
      </div>

      {/* Estimation */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground border-t border-border pt-3 mb-3">
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          ~{estimatedMinutes}dk
        </span>
        <span className="inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" />~{estimatedCount} test case üretilecek
        </span>
      </div>

      {/* Primary action */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all",
          generating
            ? "bg-muted text-muted-foreground cursor-not-allowed"
            : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
        )}
      >
        {generating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Test caseler üretiliyor...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Test Caseleri Üret
          </>
        )}
      </button>
    </div>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <div
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "w-9 h-5 rounded-full border transition-colors relative shrink-0",
          checked ? "bg-primary border-primary" : "bg-muted border-border group-hover:border-primary/50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
    </label>
  );
}
