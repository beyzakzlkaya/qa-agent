"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Send, Save, ChevronDown, X, BookmarkPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Platform, Tag, SavedPrompt } from "@/lib/types";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "backoffice", label: "Backoffice" },
  { value: "partner", label: "Partner Panel" },
  { value: "website", label: "Website" },
];

const TAGS: { value: Tag; label: string }[] = [
  { value: "smoke", label: "Smoke" },
  { value: "regression", label: "Regresyon" },
  { value: "monkey", label: "Monkey" },
];

// ─── Saved Prompts Dropdown ────────────────────────────────────────────────────
function SavedPromptsDropdown({
  prompts,
  onSelect,
  onDelete,
}: {
  prompts: SavedPrompt[];
  onSelect: (p: SavedPrompt) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (prompts.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <span>Kayıtlı Promptlar ({prompts.length})</span>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto">
            {prompts.map((p) => (
              <div
                key={p.id}
                className="group flex items-start justify-between gap-2 px-3 py-2.5 hover:bg-accent cursor-pointer border-b border-border/50 last:border-0"
              >
                <div
                  className="flex-1 min-w-0"
                  onClick={() => { onSelect(p); setOpen(false); }}
                >
                  <div className="text-xs font-medium text-foreground truncate">{p.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {p.prompt.slice(0, 60)}...
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                  className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all"
                  title="Sil"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Save Dialog ───────────────────────────────────────────────────────────────
function SaveDialog({
  defaultName,
  onConfirm,
  onCancel,
}: {
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);

  return (
    <div className="flex items-center gap-2 p-2.5 rounded-md border border-primary/30 bg-primary/5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Prompt adı..."
        className="flex-1 px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        type="button"
        disabled={!name.trim()}
        onClick={() => name.trim() && onConfirm(name.trim())}
        className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        Kaydet
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs px-2 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        İptal
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export function PromptEditor() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(["backoffice"]);
  const [env, setEnv] = useState<"preprod" | "prod">("preprod");
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [loading, setLoading] = useState<"run" | "save" | null>(null);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Fetch saved prompts on mount
  useEffect(() => {
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((d) => setSavedPrompts(d.prompts ?? []))
      .catch(() => {});
  }, []);

  const togglePlatform = (p: Platform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const toggleTag = (t: Tag) => {
    setSelectedTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const loadSavedPrompt = (p: SavedPrompt) => {
    setTitle(p.title);
    setPrompt(p.prompt);
    setSelectedPlatforms([p.platform]);
    setSelectedTags(p.tags);
  };

  const deleteSavedPrompt = async (id: string) => {
    await fetch(`/api/prompts/${id}`, { method: "DELETE" }).catch(() => {});
    setSavedPrompts((prev) => prev.filter((p) => p.id !== id));
  };

  const savePromptOnly = async (promptTitle: string) => {
    if (!prompt.trim()) return;
    setLoading("save");
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: promptTitle,
          prompt,
          platform: selectedPlatforms[0] ?? "backoffice",
          tags: selectedTags,
        }),
      });
      const data = await res.json();
      if (data.id) {
        const newPrompt: SavedPrompt = {
          id: data.id,
          title: promptTitle,
          prompt,
          platform: selectedPlatforms[0] ?? "backoffice",
          tags: selectedTags,
          createdAt: new Date().toISOString(),
          runCount: 0,
        };
        setSavedPrompts((prev) => [newPrompt, ...prev]);
        if (!title) setTitle(promptTitle);
      }
    } finally {
      setLoading(null);
      setShowSaveDialog(false);
    }
  };

  const execute = async (save: boolean) => {
    if (!prompt.trim() || !title.trim()) return;
    setLoading(save ? "save" : "run");

    try {
      if (save) {
        await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            prompt,
            platform: selectedPlatforms[0] ?? "backoffice",
            tags: selectedTags,
          }),
        });
      }

      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title,
          environment: env,
          runType: "custom",
          customPrompt: {
            title,
            prompt,
            platform: selectedPlatforms,
            expectedOutcome: expectedOutcome || "Test başarıyla tamamlanmalı",
            tags: selectedTags,
          },
        }),
      });

      const data = await res.json();
      if (data.runId) router.push(`/run/${data.runId}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Test Adı *
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Örn: Admin Login Flow"
          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-muted-foreground">Prompt *</label>
          <SavedPromptsDropdown
            prompts={savedPrompts}
            onSelect={loadSavedPrompt}
            onDelete={deleteSavedPrompt}
          />
        </div>

        {showSaveDialog && (
          <div className="mb-2">
            <SaveDialog
              defaultName={title}
              onConfirm={savePromptOnly}
              onCancel={() => setShowSaveDialog(false)}
            />
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Page Agent'a göndereceğin talimatları buraya yaz..."
          rows={8}
          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Beklenen Sonuç
        </label>
        <input
          value={expectedOutcome}
          onChange={(e) => setExpectedOutcome(e.target.value)}
          placeholder="Başarı kriteri (opsiyonel)"
          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Platform
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                onClick={() => togglePlatform(p.value)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-md border transition-colors",
                  selectedPlatforms.includes(p.value)
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Ortam
          </label>
          <div className="flex gap-1.5">
            {(["preprod", "prod"] as const).map((e) => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-md border transition-colors",
                  env === e
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {e === "preprod" ? "Preprod" : "Prod"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Etiketler
        </label>
        <div className="flex gap-1.5">
          {TAGS.map((t) => (
            <button
              key={t.value}
              onClick={() => toggleTag(t.value)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-md border transition-colors",
                selectedTags.includes(t.value)
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => execute(false)}
          disabled={!prompt.trim() || !title.trim() || !!loading}
          className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
        >
          {loading === "run" ? (
            <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          Test Çalıştır
        </button>

        <button
          type="button"
          onClick={() => setShowSaveDialog((v) => !v)}
          disabled={!prompt.trim() || !!loading}
          className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border hover:bg-accent text-foreground disabled:opacity-50 transition-colors"
          title="Prompt'u kaydet"
        >
          <BookmarkPlus className="w-4 h-4" />
        </button>

        <button
          onClick={() => execute(true)}
          disabled={!prompt.trim() || !title.trim() || !!loading}
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md border border-border hover:bg-accent text-foreground disabled:opacity-50 transition-colors font-medium"
        >
          {loading === "save" ? (
            <div className="w-4 h-4 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Kaydet & Çalıştır
        </button>
      </div>
    </div>
  );
}
