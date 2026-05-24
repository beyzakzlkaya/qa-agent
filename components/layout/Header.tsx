"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, PlugZap, AlertTriangle, Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

interface LlmStatus {
  baseURL: string;
  model: string;
  apiKeySet: boolean;
  compatible: boolean;
  warning: string | null;
}

const LAUNCHER_URL = "http://localhost:38401";
const WS_RECONNECT_MS = 2000;

export function Header({ title }: { title?: string }) {
  const [hubConnected, setHubConnected] = useState<boolean | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Bootstrap once, then receive hub_status updates via WebSocket push
  useEffect(() => {
    let ws: WebSocket | null = null;
    let unmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let bootstrapped = false;

    const fetchBootstrap = async () => {
      if (bootstrapped) return;
      bootstrapped = true;
      try {
        const res = await fetch("/api/hub-status");
        const data = await res.json();
        setHubConnected(data.connected);
        if (data.llm) setLlmStatus(data.llm);
        if (data.connected) setConnecting(false);
      } catch {
        setHubConnected(false);
      }
    };

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

      ws.onopen = () => {
        // Only fetch bootstrap if WS connected successfully but we haven't bootstrapped yet
        fetchBootstrap();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            payload?: { connected: boolean; busy: boolean };
          };
          if (msg.type === "hub_status" && msg.payload) {
            setHubConnected(msg.payload.connected);
            if (msg.payload.connected) setConnecting(false);
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        // Reconnect silently — do NOT call fetchBootstrap again
        if (!unmounted) {
          reconnectTimer = setTimeout(connect, WS_RECONNECT_MS);
        }
      };

      ws.onerror = () => {
        // If WS can't connect at all, do a single bootstrap fetch
        fetchBootstrap();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const handleConnect = () => {
    setConnecting(true);
    window.open(LAUNCHER_URL, "_blank", "width=600,height=500,noopener");
  };

  return (
    <header className="h-12 border-b border-border bg-card flex items-center justify-between px-5 sticky top-0 z-10">
      <h1 className="text-sm font-semibold text-foreground">
        {title ?? "QA Agent Platform"}
      </h1>

      <div className="flex items-center gap-2">
        {llmStatus && !llmStatus.apiKeySet && (
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border text-warning border-warning/40 bg-warn-bg/50 dark:text-warning dark:border-warning/30 dark:bg-warn-bg/30">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span>LLM key eksik</span>
          </div>
        )}

        {hubConnected === false && (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border font-medium transition-all ${
              connecting
                ? "border-primary/30 bg-primary/5 text-primary cursor-wait"
                : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
            }`}
          >
            <PlugZap className={`w-3.5 h-3.5 ${connecting ? "animate-pulse" : ""}`} />
            {connecting ? "Bağlanıyor..." : "Bağlan"}
          </button>
        )}

        <div
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
            hubConnected === true
              ? "border-success/30 bg-success/5 text-success"
              : hubConnected === false
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-border bg-muted/30 text-muted-foreground"
          }`}
        >
          {hubConnected ? (
            <Wifi className="w-3 h-3" />
          ) : (
            <WifiOff className="w-3 h-3" />
          )}
          {hubConnected === true
            ? "Page Agent Bağlı"
            : hubConnected === false
            ? "Bağlı Değil"
            : "..."}
        </div>

        {/* Dark mode toggle — only rendered after hydration to avoid SSR mismatch */}
        {mounted && (
          <button
            onClick={toggle}
            title={theme === "dark" ? "Açık moda geç" : "Koyu moda geç"}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </header>
  );
}
