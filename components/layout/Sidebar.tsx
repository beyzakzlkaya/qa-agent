"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FlaskConical,
  FileText,
  Terminal,
  GitBranch,
  BookOpen,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jira", label: "JIRA Pipeline", icon: GitBranch },
  { href: "/test-suite", label: "Test Suite", icon: FlaskConical },
  { href: "/prompt", label: "Prompt Editör", icon: Terminal },
  { href: "/reports", label: "Raporlar", icon: FileText },
  { href: "/domain", label: "Domain", icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[200px] shrink-0 border-r border-border bg-card flex flex-col h-screen sticky top-0 transition-colors duration-200" style={{ background: "var(--bg-sidebar, var(--card))", borderColor: "var(--border-sub, var(--border))" }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{ borderColor: "var(--border-sub, var(--border))" }}>
        <svg width="32" height="32" viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
          <rect width="72" height="72" rx="16" fill="#181c24"/>
          <line x1="28" y1="18" x2="22" y2="10" stroke="#7c9abf" strokeWidth="3" strokeLinecap="round"/>
          <line x1="44" y1="18" x2="50" y2="10" stroke="#7c9abf" strokeWidth="3" strokeLinecap="round"/>
          <circle cx="22" cy="9" r="3.5" fill="#7c9abf"/>
          <circle cx="50" cy="9" r="3.5" fill="#7c9abf"/>
          <ellipse cx="36" cy="30" rx="11" ry="7" fill="#354560"/>
          <ellipse cx="36" cy="44" rx="10" ry="12" fill="#2a3650"/>
          <circle cx="31" cy="30" r="2.5" fill="#7c9abf"/>
          <circle cx="41" cy="30" r="2.5" fill="#7c9abf"/>
          <line x1="26" y1="38" x2="16" y2="34" stroke="#7c9abf" strokeWidth="2" strokeLinecap="round"/>
          <line x1="26" y1="44" x2="15" y2="44" stroke="#7c9abf" strokeWidth="2" strokeLinecap="round"/>
          <line x1="26" y1="50" x2="16" y2="54" stroke="#7c9abf" strokeWidth="2" strokeLinecap="round"/>
          <line x1="46" y1="38" x2="56" y2="34" stroke="#7c9abf" strokeWidth="2" strokeLinecap="round"/>
          <line x1="46" y1="44" x2="57" y2="44" stroke="#7c9abf" strokeWidth="2" strokeLinecap="round"/>
          <line x1="46" y1="50" x2="56" y2="54" stroke="#7c9abf" strokeWidth="2" strokeLinecap="round"/>
          <line x1="26" y1="42" x2="46" y2="42" stroke="#1e2a3d" strokeWidth="1.5"/>
          <line x1="27" y1="50" x2="45" y2="50" stroke="#1e2a3d" strokeWidth="1.5"/>
        </svg>
        <div>
          <p className="text-sm font-bold text-foreground leading-tight">QA Agent</p>
          <p className="text-[10px] text-muted-foreground leading-tight">Getmobil</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "font-medium border-l-2"
                  : "hover:bg-accent"
              }`}
              style={isActive ? {
                background: "var(--bg-active, hsl(var(--accent)))",
                color: "var(--accent-color, hsl(var(--primary)))",
                borderLeftColor: "var(--accent-color, hsl(var(--primary)))",
              } : {
                color: "var(--txt-dim, hsl(var(--muted-foreground)))",
              }}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border-sub, var(--border))" }}>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Page Agent v1.7 • WebSocket Bridge
        </p>
      </div>
    </aside>
  );
}
