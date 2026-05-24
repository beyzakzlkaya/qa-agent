"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";

interface TagNode {
  tag: string;
  label: string;
  count: number;
}

interface DomainNode {
  domain: string;
  label: string;
  totalCount: number;
  children: TagNode[];
}

interface TreeNode {
  platform: string;
  label: string;
  totalCount: number;
  domains: DomainNode[];
}

interface Selected {
  platform: string;
  domain: string | null;
  tag: string | null;
}

interface Props {
  nodes: TreeNode[];
  selected: Selected | null;
  onSelect: (platform: string, domain: string | null, tag: string | null) => void;
}

const TAG_LABELS: Record<string, string> = {
  smoke: "Smoke",
  regression: "Regresyon",
  monkey: "Monkey",
};

export function SuiteTree({ nodes, selected, onSelect }: Props) {
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  const toggleDomain = (key: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="p-3 space-y-1">
      {nodes.map((node) => {
        const isPlatformSelected =
          selected?.platform === node.platform &&
          selected.domain === null &&
          selected.tag === null;

        return (
          <div key={node.platform}>
            {/* Platform row */}
            <button
              onClick={() => onSelect(node.platform, null, null)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                isPlatformSelected
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-accent text-foreground"
              )}
            >
              {isPlatformSelected ? (
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="flex-1 text-left capitalize">{node.label}</span>
              <span className="text-xs text-muted-foreground">{node.totalCount}</span>
            </button>

            {/* Domain rows */}
            {node.domains.map((domainNode) => {
              const domainKey = `${node.platform}::${domainNode.domain}`;
              const isDomainExpanded = expandedDomains.has(domainKey);
              const isDomainSelected =
                selected?.platform === node.platform &&
                selected.domain === domainNode.domain &&
                selected.tag === null;

              return (
                <div key={domainNode.domain}>
                  <button
                    onClick={() => {
                      onSelect(node.platform, domainNode.domain, null);
                      toggleDomain(domainKey);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 pl-5 pr-2 py-1 rounded-md text-sm transition-colors ml-0.5",
                      isDomainSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        "w-3 h-3 shrink-0 transition-transform",
                        isDomainExpanded && "rotate-90"
                      )}
                    />
                    <span className="flex-1 text-left">{domainNode.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {domainNode.totalCount}
                    </span>
                  </button>

                  {/* Tag rows */}
                  {isDomainExpanded &&
                    domainNode.children.map((child) => {
                      const isTagSelected =
                        selected?.platform === node.platform &&
                        selected.domain === domainNode.domain &&
                        selected.tag === child.tag;

                      return (
                        <button
                          key={child.tag}
                          onClick={() =>
                            onSelect(node.platform, domainNode.domain, child.tag)
                          }
                          className={cn(
                            "w-full flex items-center gap-2 pl-10 pr-2 py-1 rounded-md text-sm transition-colors ml-0.5",
                            isTagSelected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-accent text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <ChevronRight className="w-3 h-3 shrink-0 opacity-40" />
                          <span className="flex-1 text-left">
                            {TAG_LABELS[child.tag] ?? child.tag}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {child.count}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
