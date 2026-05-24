import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  RunStatus,
  { label: string; classes: string; dot: string }
> = {
  running: {
    label: "Çalışıyor",
    classes: "bg-primary/10 text-primary border-primary/30",
    dot: "bg-primary animate-pulse-dot",
  },
  success: {
    label: "Başarılı",
    classes: "bg-success/10 text-success border-success/30",
    dot: "bg-success",
  },
  failed: {
    label: "Başarısız",
    classes: "bg-destructive/10 text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  partial: {
    label: "Kısmi",
    classes: "bg-warning/10 text-warning border-warning/30",
    dot: "bg-warning",
  },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border",
        config.classes
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}
