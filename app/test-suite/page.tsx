"use client";

import { useEffect, useState } from "react";
import { SuiteTree } from "@/components/test-suite/SuiteTree";
import { CaseCard } from "@/components/test-suite/CaseCard";
import { TagFilter } from "@/components/test-suite/TagFilter";
import type { TestCase, Tag } from "@/lib/types";
import { Play, CheckSquare } from "lucide-react";

const PLATFORM_LABELS: Record<string, string> = {
  backoffice: "Backoffice",
  partner: "Partner Panel",
  website: "Website",
};

const DOMAIN_LABELS: Record<string, string> = {
  identity: "Identity",
  order: "Order",
  inventory: "Inventory",
  buyback: "Buyback",
  warranty: "Garanti",
  refurbishment: "Refurbishment",
  financials: "Financials",
  general: "Genel",
};

const PLATFORMS = ["backoffice", "partner", "website"];
const TAGS = ["smoke", "regression", "monkey"];

interface SelectedNode {
  platform: string;
  domain: string | null;
  tag: string | null;
}

export default function TestSuitePage() {
  const [allCases, setAllCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [tagFilter, setTagFilter] = useState<Tag | "all">("all");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [env, setEnv] = useState<"preprod" | "prod">("preprod");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/test-cases")
      .then((r) => r.json())
      .then((d) => setAllCases(d.cases ?? []))
      .finally(() => setLoading(false));
  }, []);

  const treeNodes = PLATFORMS.map((platform) => {
    const platformCases = allCases.filter((c) =>
      c.platform.includes(platform as TestCase["platform"][number])
    );

    // Collect unique domains for this platform
    const domainSet = new Set<string>();
    platformCases.forEach((c) => {
      domainSet.add(c.domain ?? "general");
    });

    const domains = Array.from(domainSet)
      .sort()
      .map((domain) => {
        const domainCases = platformCases.filter(
          (c) => (c.domain ?? "general") === domain
        );
        return {
          domain,
          label: DOMAIN_LABELS[domain] ?? domain,
          totalCount: domainCases.length,
          children: TAGS.map((tag) => ({
            tag,
            label:
              tag === "smoke"
                ? "Smoke"
                : tag === "regression"
                ? "Regresyon"
                : "Monkey",
            count: domainCases.filter((c) => c.tags.includes(tag as Tag))
              .length,
          })).filter((c) => c.count > 0),
        };
      });

    return {
      platform,
      label: PLATFORM_LABELS[platform],
      totalCount: platformCases.length,
      domains,
    };
  });

  const visibleCases = allCases.filter((c) => {
    if (selected) {
      const matchPlatform = c.platform.includes(
        selected.platform as TestCase["platform"][number]
      );
      if (!matchPlatform) return false;
      if (selected.domain !== null) {
        const matchDomain = (c.domain ?? "general") === selected.domain;
        if (!matchDomain) return false;
      }
      if (selected.tag !== null) {
        const matchTag = c.tags.includes(selected.tag as Tag);
        if (!matchTag) return false;
      }
    }
    if (tagFilter !== "all" && !c.tags.includes(tagFilter)) return false;
    return true;
  });

  const toggleCase = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedIds.size === visibleCases.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(visibleCases.map((c) => c.id)));
    }
  };

  const runCases = async (
    caseIds: string[],
    name: string,
    platformFilter?: string
  ) => {
    setRunning(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          environment: env,
          runType: "custom",
          caseIds,
          triggeredBy: "manual",
          ...(platformFilter ? { selectedPlatforms: [platformFilter] } : {}),
        }),
      });
      const data = await res.json();
      if (data.runId) window.open(`/run/${data.runId}`, "_blank");
    } finally {
      setRunning(false);
    }
  };

  const runAll = async () => {
    let label = "Tüm Suite";
    if (selected) {
      const platformLabel = PLATFORM_LABELS[selected.platform];
      const domainLabel = selected.domain
        ? DOMAIN_LABELS[selected.domain] ?? selected.domain
        : null;
      const tagLabel = selected.tag ?? null;
      label = [platformLabel, domainLabel, tagLabel].filter(Boolean).join(" — ");
    }
    await runCases(
      visibleCases.map((c) => c.id),
      `${label} (${env})`,
      selected?.platform
    );
  };

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* Left: Tree */}
      <aside className="w-60 shrink-0 border-r border-border overflow-y-auto bg-card/50">
        <div className="p-3 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Platform Ağacı
          </p>
        </div>
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground">Yükleniyor...</div>
        ) : (
          <SuiteTree
            nodes={treeNodes}
            selected={selected}
            onSelect={(platform, domain, tag) =>
              setSelected((prev) =>
                prev?.platform === platform &&
                prev.domain === domain &&
                prev.tag === tag
                  ? null
                  : { platform, domain, tag }
              )
            }
          />
        )}
      </aside>

      {/* Right: Cases */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card/50 flex-wrap">
          <div className="flex items-center gap-3">
            <TagFilter active={tagFilter} onChange={setTagFilter} />
            <span className="text-xs text-muted-foreground">
              {visibleCases.length} case
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value as "preprod" | "prod")}
              className="text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground"
            >
              <option value="preprod">Preprod</option>
              <option value="prod">Prod</option>
            </select>

            {checkedIds.size > 0 && (
              <button
                onClick={() => {
                  const ids = Array.from(checkedIds);
                  runCases(
                    ids,
                    `Seçili ${ids.length} case (${env})`,
                    selected?.platform
                  );
                }}
                disabled={running}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {checkedIds.size} Seçiliyi Çalıştır
              </button>
            )}

            <button
              onClick={runAll}
              disabled={running || visibleCases.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent text-foreground disabled:opacity-50 transition-colors font-medium"
            >
              <Play className="w-3.5 h-3.5" />
              Tüm Suite'i Çalıştır
            </button>
          </div>
        </div>

        {/* Case list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : visibleCases.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              Bu filtre için test case bulunamadı.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  checked={
                    checkedIds.size === visibleCases.length &&
                    visibleCases.length > 0
                  }
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 accent-primary"
                />
                <span className="text-xs text-muted-foreground">Tümünü seç</span>
              </div>
              {visibleCases.map((c) => (
                <CaseCard
                  key={`${c.id}-${c.platform.join(",")}`}
                  id={c.id}
                  title={c.title}
                  priority={c.priority}
                  tags={c.tags}
                  platform={c.platform}
                  selected={checkedIds.has(c.id)}
                  onToggle={() => toggleCase(c.id)}
                  onRun={() =>
                    runCases([c.id], `${c.title} (${env})`, selected?.platform)
                  }
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
