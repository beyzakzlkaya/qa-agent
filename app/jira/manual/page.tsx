"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitBranch, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const TASK_KEY_REGEX = /^[A-Z][A-Z0-9]+-\d+$/;

export default function ManualTaskEntryPage() {
  const router = useRouter();
  const [taskKey, setTaskKey] = useState("");
  const trimmed = taskKey.trim().toUpperCase();
  const isValid = TASK_KEY_REGEX.test(trimmed);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    router.push(`/jira/${trimmed}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push("/jira")}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-primary" />
              Manuel Task Girişi
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              READY FOR QA dışında bir task için pipeline başlat
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-card border border-border rounded-lg p-5 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              JIRA Task Numarası
            </label>
            <input
              type="text"
              value={taskKey}
              onChange={(e) => setTaskKey(e.target.value.toUpperCase())}
              placeholder="GM-123"
              autoFocus
              className={cn(
                "w-full px-3 py-2 rounded-md border bg-background text-foreground",
                "placeholder:text-muted-foreground text-sm font-mono",
                "focus:outline-none focus:ring-2 focus:ring-ring transition-colors",
                taskKey && !isValid ? "border-destructive focus:ring-destructive/30" : "border-border"
              )}
            />
            {taskKey && !isValid && (
              <p className="text-xs text-destructive mt-1">
                Geçerli format: GM-123, PROJECT-456 gibi
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!isValid}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all",
              isValid
                ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            Detaya Git
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
