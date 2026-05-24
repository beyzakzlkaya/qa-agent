"use client";
import { useState } from "react";

interface Stats {
  filesProcessed: number;
  chunksIndexed: number;
}

export default function DomainPage() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  async function run(refresh = false) {
    setStatus("running");
    setLogs([]);
    setStats(null);

    const res = await fetch("/api/index-domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });

    if (!res.body) {
      setStatus("error");
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const d = JSON.parse(line.slice(6)) as {
            type?: string;
            log?: string;
            done?: boolean;
            error?: boolean;
            message?: string;
            filesProcessed?: number;
            chunksIndexed?: number;
          };
          if (d.type === "progress" && d.log) {
            setLogs((p) => [...p, d.log!]);
          } else if (d.type === "complete") {
            setStats({ filesProcessed: d.filesProcessed ?? 0, chunksIndexed: d.chunksIndexed ?? 0 });
            setStatus("done");
          } else if (d.type === "error") {
            setLogs((p) => [...p, `Hata: ${d.message}`]);
            setStatus("error");
          } else if (d.type === "start" && d.log) {
            setLogs((p) => [...p, d.log!]);
          }
          // Legacy SSE format support
          if (d.log && d.type === undefined) setLogs((p) => [...p, d.log!]);
          if (d.done && d.type === undefined) {
            setStats({ filesProcessed: (d as unknown as Stats).filesProcessed ?? 0, chunksIndexed: (d as unknown as Stats).chunksIndexed ?? 0 });
            setStatus("done");
          }
          if (d.error && d.type === undefined) setStatus("error");
        } catch {
          // ignore parse errors
        }
      }
    }
    if (status === "running") setStatus("done");
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground mb-1.5">
        Domain bilgi tabanı
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        GitHub reposundaki dokümanları indeksler. Test koşmadan önce güncel tutun.
      </p>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => run(false)}
          disabled={status === "running"}
          className="px-4 py-2 rounded-lg text-sm border transition-colors disabled:opacity-60 bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
        >
          {status === "running" ? "Çalışıyor..." : "İndeksle"}
        </button>
        <button
          onClick={() => run(true)}
          disabled={status === "running"}
          className="px-4 py-2 rounded-lg text-sm border transition-colors disabled:opacity-60 bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground"
        >
          Sıfırdan yenile
        </button>
      </div>

      {stats && (
        <div className="flex gap-3 mb-5">
          {[
            { label: "Dosya işlendi", value: stats.filesProcessed },
            { label: "Chunk indexlendi", value: stats.chunksIndexed },
          ].map((s) => (
            <div
              key={s.label}
              className="flex-1 p-4 rounded-xl border bg-card border-border"
            >
              <div className="text-2xl font-semibold text-foreground">{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div className="font-mono text-xs bg-card border border-border rounded-lg p-4 max-h-72 overflow-y-auto space-y-0.5">
          {logs.map((l, i) => (
            <div key={i} className="text-muted-foreground leading-relaxed">
              {l}
            </div>
          ))}
        </div>
      )}

      {status === "done" && (
        <p className="text-sm text-green-600 dark:text-green-400 mt-3 font-medium">
          ✓ İndeksleme tamamlandı
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400 mt-3 font-medium">
          ✗ Bir hata oluştu — loglara bakın
        </p>
      )}
    </div>
  );
}
