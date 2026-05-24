import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

const ALL_TAGS: { value: Tag | "all"; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "smoke", label: "Smoke" },
  { value: "regression", label: "Regresyon" },
  { value: "monkey", label: "Monkey" },
];

interface Props {
  active: Tag | "all";
  onChange: (tag: Tag | "all") => void;
}

export function TagFilter({ active, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {ALL_TAGS.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "text-xs px-3 py-1 rounded-full border transition-colors font-medium",
            active === t.value
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:border-border/60"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
