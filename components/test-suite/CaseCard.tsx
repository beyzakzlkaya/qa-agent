import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

const TAG_CONFIG: Record<Tag, { label: string; classes: string }> = {
  smoke: {
    label: "Smoke",
    classes: "bg-primary/10 text-primary border-primary/30",
  },
  regression: {
    label: "Regresyon",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  monkey: {
    label: "Monkey",
    classes: "bg-warning/10 text-warning border-warning/30",
  },
};

const PRIORITY_CONFIG = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-warning/10 text-warning border-warning/30",
  medium: "bg-warning/5 text-warning/80 border-warning/20",
  low: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_LABELS = {
  critical: "Kritik",
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
};

interface Props {
  id: string;
  title: string;
  priority: keyof typeof PRIORITY_CONFIG;
  tags: Tag[];
  platform: string[];
  selected?: boolean;
  onToggle?: () => void;
  onRun?: () => void;
}

export function CaseCard({
  id,
  title,
  priority,
  tags,
  platform,
  selected,
  onToggle,
  onRun,
}: Props) {
  return (
    <div
      className={cn(
        "bg-card border rounded-lg p-3 flex items-start gap-3 transition-colors",
        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80"
      )}
    >
      {onToggle && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-0.5 w-3.5 h-3.5 accent-primary shrink-0"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">{id}</span>
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded border font-medium",
              PRIORITY_CONFIG[priority]
            )}
          >
            {PRIORITY_LABELS[priority]}
          </span>
          {tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "text-xs px-1.5 py-0.5 rounded border",
                TAG_CONFIG[tag].classes
              )}
            >
              {TAG_CONFIG[tag].label}
            </span>
          ))}
        </div>
        <p className="text-sm text-foreground mt-1 truncate" title={title}>
          {title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {platform.join(", ")}
        </p>
      </div>

      {onRun && (
        <button
          onClick={onRun}
          className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
        >
          Çalıştır
        </button>
      )}
    </div>
  );
}
