"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Camera,
  Play,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Sparkles,
  RotateCcw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

// ─── Types (API row shape) ────────────────────────────────────────────────────

type SnapshotStatus = "new" | "match" | "mismatch" | "updated" | "error";

interface SnapshotResult {
  id: number;
  target_id: string;
  status: SnapshotStatus;
  current_path: string | null;
  baseline_path: string | null;
  diff_path: string | null;
  diff_pixels: number | null;
  diff_percentage: number | null;
  masked_percentage: number | null;
  error_message: string | null;
  created_at: string;
}

interface SnapshotTarget {
  id: string;
  name: string;
  platform: string;
  environment: string;
  path: string;
  threshold: number;
  baseline_path: string | null;
  baseline_updated_at: string | null;
  created_at: string;
  last_result: SnapshotResult | null;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_META: Record<
  SnapshotStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  new: { label: "Yeni baseline", className: "bg-blue-500/10 text-blue-500 border-blue-500/30", Icon: Sparkles },
  match: { label: "Eşleşti", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", Icon: CheckCircle2 },
  mismatch: { label: "Fark var", className: "bg-red-500/10 text-red-500 border-red-500/30", Icon: XCircle },
  updated: { label: "Güncellendi", className: "bg-violet-500/10 text-violet-500 border-violet-500/30", Icon: RotateCcw },
  error: { label: "Hata", className: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: AlertTriangle },
};

function StatusBadge({ status }: { status: SnapshotStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.className}`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

// ─── Image panel ──────────────────────────────────────────────────────────────

function ImagePanel({ title, path: imgPath }: { title: string; path: string | null }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        {title}
      </p>
      {imgPath ? (
        <a
          href={`/api/screenshot-file?path=${encodeURIComponent(imgPath)}`}
          target="_blank"
          rel="noreferrer"
          title="Yeni sekmede aç"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/screenshot-file?path=${encodeURIComponent(imgPath)}`}
            alt={title}
            className="w-full rounded-md border border-border bg-background object-contain max-h-[420px]"
          />
        </a>
      ) : (
        <div className="flex items-center justify-center h-32 rounded-md border border-dashed border-border text-xs text-muted-foreground">
          Görüntü yok
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SnapshotsPage() {
  const [targets, setTargets] = useState<SnapshotTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [approving, setApproving] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPlatform, setFormPlatform] = useState("website");
  const [formEnv, setFormEnv] = useState("preprod");
  const [formPath, setFormPath] = useState("/");
  const [formThreshold, setFormThreshold] = useState("0.5");
  const [creating, setCreating] = useState(false);

  const fetchTargets = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/snapshots");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { targets: SnapshotTarget[] };
      setTargets(data.targets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          platform: formPlatform,
          environment: formEnv,
          path: formPath.trim() || "/",
          threshold: parseFloat(formThreshold) || 0.5,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setFormName("");
      setFormPath("/");
      setShowForm(false);
      await fetchTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hedef oluşturulamadı");
    } finally {
      setCreating(false);
    }
  };

  const runTargets = async (ids?: string[]) => {
    const running = ids ?? targets.map((t) => t.id);
    if (running.length === 0) return;
    setError(null);
    setNotice(null);
    if (ids) setRunningIds((prev) => new Set([...Array.from(prev), ...ids]));
    else setRunningAll(true);
    try {
      const res = await fetch("/api/snapshots/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { targetIds: ids } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        outcomes?: { targetName: string; result: SnapshotResult | null; error?: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const counts = { new: 0, match: 0, mismatch: 0, error: 0 };
      const errorLines: string[] = [];
      for (const o of data.outcomes ?? []) {
        const s = o.result?.status;
        if (s === "new") counts.new++;
        else if (s === "match") counts.match++;
        else if (s === "mismatch") counts.mismatch++;
        else {
          counts.error++;
          const msg = o.result?.error_message ?? o.error ?? "Bilinmeyen hata";
          errorLines.push(`${o.targetName}: ${msg}`);
        }
      }
      const parts: string[] = [];
      if (counts.new) parts.push(`${counts.new} yeni baseline`);
      if (counts.match) parts.push(`${counts.match} eşleşme`);
      if (counts.mismatch) parts.push(`${counts.mismatch} fark`);
      if (counts.error) parts.push(`${counts.error} hata`);
      setNotice(`Koşum tamamlandı: ${parts.join(", ") || "sonuç yok"}`);
      if (errorLines.length > 0) {
        setError(errorLines.join("\n"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Koşum başarısız");
    } finally {
      if (ids) {
        setRunningIds((prev) => {
          const next = new Set(prev);
          ids.forEach((i) => next.delete(i));
          return next;
        });
      } else setRunningAll(false);
      await fetchTargets();
    }
  };

  const approveResults = async (resultIds: number[]) => {
    if (resultIds.length === 0) return;
    setApproving((prev) => new Set([...Array.from(prev), ...resultIds]));
    setError(null);
    try {
      const res = await fetch("/api/snapshots/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        updated?: number[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNotice(`${data.updated?.length ?? 0} baseline güncellendi`);
      await fetchTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Baseline güncellenemedi");
    } finally {
      setApproving((prev) => {
        const next = new Set(prev);
        resultIds.forEach((i) => next.delete(i));
        return next;
      });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`"${name}" snapshot hedefi silinsin mi? Baseline geçmişi de silinir.`)) return;
    try {
      const res = await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (expandedId === id) setExpandedId(null);
      await fetchTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Silinemedi");
    }
  };

  const mismatchResultIds = targets
    .filter((t) => t.last_result?.status === "mismatch")
    .map((t) => t.last_result!.id);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Snapshot Testleri
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Jest tarzı görsel regresyon: ilk koşumda baseline alınır, sonraki koşumlar
            piksel piksel karşılaştırılır. Fark bilinçliyse baseline&apos;ı güncelleyin
            (<code className="text-[11px]">jest -u</code> karşılığı).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md border border-border text-muted-foreground bg-card hover:bg-accent transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Yeni Hedef
          </button>
          {mismatchResultIds.length > 0 && (
            <button
              onClick={() => approveResults(mismatchResultIds)}
              disabled={approving.size > 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
              title="Tüm farklı snapshot'ların baseline'ını güncelle (jest -u)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Tüm Farkları Onayla ({mismatchResultIds.length})
            </button>
          )}
          <button
            onClick={() => runTargets()}
            disabled={runningAll || runningIds.size > 0 || targets.length === 0}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {runningAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Tümünü Çalıştır
          </button>
        </div>
      </div>

      {/* Notices */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive whitespace-pre-line">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
          {notice}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-card border border-border rounded-lg p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end"
        >
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              İsim
            </label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              placeholder="örn. Website ana sayfa"
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Platform
            </label>
            <select
              value={formPlatform}
              onChange={(e) => setFormPlatform(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground"
            >
              <option value="website">website</option>
              <option value="backoffice">backoffice</option>
              <option value="partner">partner</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Ortam
            </label>
            <select
              value={formEnv}
              onChange={(e) => setFormEnv(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground"
            >
              <option value="preprod">preprod</option>
              <option value="prod">prod</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Path
            </label>
            <input
              value={formPath}
              onChange={(e) => setFormPath(e.target.value)}
              placeholder="/kategori/telefon"
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Eşik (% fark)
            </label>
            <div className="flex gap-2">
              <input
                value={formThreshold}
                onChange={(e) => setFormThreshold(e.target.value)}
                type="number"
                step="0.1"
                min="0"
                max="100"
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground"
              />
              <button
                type="submit"
                disabled={creating}
                className="shrink-0 px-3.5 py-2 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {creating ? "..." : "Ekle"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Targets list */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : targets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Camera className="w-8 h-8 opacity-30" />
            <p className="text-sm">Henüz snapshot hedefi yok.</p>
            <p className="text-xs">
              &quot;Yeni Hedef&quot; ile izlemek istediğiniz sayfayı ekleyin; ilk koşumda
              baseline otomatik oluşturulur.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {targets.map((t) => {
              const last = t.last_result;
              const isRunning = runningAll || runningIds.has(t.id);
              const isExpanded = expandedId === t.id;
              const canExpand = !!last;
              return (
                <div key={t.id}>
                  <div
                    className={`flex items-center justify-between px-4 py-3 gap-3 ${canExpand ? "cursor-pointer hover:bg-accent/30" : ""} transition-colors`}
                    onClick={() => canExpand && setExpandedId(isExpanded ? null : t.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {canExpand ? (
                        isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        )
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate">
                            {t.name}
                          </p>
                          {last ? (
                            <StatusBadge status={last.status} />
                          ) : (
                            <span className="text-[11px] text-muted-foreground border border-border rounded-full px-2 py-0.5">
                              Hiç koşulmadı
                            </span>
                          )}
                          {last?.diff_percentage != null && last.status === "mismatch" && (
                            <span className="text-[11px] font-mono text-red-500">
                              %{last.diff_percentage.toFixed(2)} fark
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {t.platform} • {t.environment} • {t.path} • eşik %{t.threshold}
                          {last && ` • son koşum: ${new Date(last.created_at + "Z").toLocaleString("tr-TR")}`}
                        </p>
                        {last?.status === "error" && last.error_message && (
                          <p className="text-xs text-amber-600 mt-1 line-clamp-2">
                            {last.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {last?.status === "mismatch" && (
                        <button
                          onClick={() => approveResults([last.id])}
                          disabled={approving.has(last.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-violet-600/10 text-violet-600 border border-violet-600/30 hover:bg-violet-600/20 transition-colors disabled:opacity-50"
                          title="Bu farkı kabul et, baseline'ı güncelle"
                        >
                          {approving.has(last.id) ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Baseline&apos;ı Güncelle
                        </button>
                      )}
                      <button
                        onClick={() => runTargets([t.id])}
                        disabled={isRunning || runningAll}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        {isRunning ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        Çalıştır
                      </button>
                      <button
                        onClick={() => handleDelete(t.id, t.name)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Hedefi sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Diff viewer */}
                  {isExpanded && last && (
                    <div className="px-4 pb-4 pt-1 bg-accent/10 border-t border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-muted-foreground">
                          {last.status === "mismatch" ? (
                            <>
                              <span className="font-semibold text-red-500">
                                %{last.diff_percentage?.toFixed(2) ?? "?"} piksel farkı
                              </span>
                              {last.diff_pixels != null && ` (${last.diff_pixels.toLocaleString("tr-TR")} piksel)`}
                              {" — eşik: %"}{t.threshold}
                              {last.masked_percentage != null && last.masked_percentage > 0 && (
                                <span className="text-blue-500"> • %{last.masked_percentage.toFixed(1)} dinamik alan (banner vb.) maskelendi</span>
                              )}
                            </>
                          ) : last.status === "match" ? (
                            <>
                              Baseline ile eşleşti (%{last.diff_percentage?.toFixed(2) ?? "0"} fark, eşik %{t.threshold})
                              {last.masked_percentage != null && last.masked_percentage > 0 && (
                                <span className="text-blue-500"> • %{last.masked_percentage.toFixed(1)} dinamik alan maskelendi</span>
                              )}
                            </>
                          ) : last.status === "new" ? (
                            <>İlk koşum — bu görüntü baseline olarak kaydedildi</>
                          ) : last.status === "error" ? (
                            <>Koşum hata ile sonuçlandı</>
                          ) : (
                            <>Baseline bu görüntüyle güncellendi</>
                          )}
                        </p>
                        <button
                          onClick={() => fetchTargets()}
                          className="p-1 rounded text-muted-foreground hover:bg-accent"
                          title="Yenile"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      </div>
                      {last.status === "error" && (
                        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                          <p className="text-xs font-semibold text-amber-600 flex items-center gap-1.5 mb-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Hata detayı
                          </p>
                          <p className="text-xs text-foreground whitespace-pre-line font-mono bg-amber-500/10 rounded px-2 py-1.5">
                            {last.error_message ?? "Hata mesajı kaydedilmemiş"}
                          </p>
                        </div>
                      )}
                      {(last.current_path || last.baseline_path || t.baseline_path) ? (
                        <div className="flex gap-3 flex-col lg:flex-row">
                          <ImagePanel title="Baseline (beklenen)" path={last.baseline_path ?? t.baseline_path} />
                          <ImagePanel title="Güncel (bu koşum)" path={last.current_path} />
                          {last.status === "mismatch" && (
                            <ImagePanel title="Diff (fark haritası)" path={last.diff_path} />
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          Bu koşumda ekran görüntüsü alınamadı.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs font-semibold text-foreground mb-2">Nasıl çalışır? (Jest snapshot modeli)</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li><span className="font-medium text-foreground">İlk koşum:</span> sayfanın ekran görüntüsü alınır ve baseline (referans) olarak kaydedilir — Jest&apos;in ilk <code>.snap</code> dosyası yazması gibi.</li>
          <li><span className="font-medium text-foreground">Sonraki koşumlar:</span> yeni görüntü baseline ile pixelmatch kullanılarak karşılaştırılır. Fark eşiğin altındaysa <span className="text-emerald-500">eşleşti</span>, üstündeyse <span className="text-red-500">fark var</span> (test kaldı) ve fark haritası üretilir. Süreli banner/karüsel geçişleri otomatik tespit edilip <span className="text-blue-500">maskelenir</span> (diff haritasında açık mavi) — yanlış alarm üretmez.</li>
          <li><span className="font-medium text-foreground">Bilinçli değişiklik:</span> fark beklenen bir tasarım değişikliğiyse &quot;Baseline&apos;ı Güncelle&quot; ile onaylayın — <code>jest --updateSnapshot</code> karşılığı. Fark bir hataysa baseline&apos;ı güncellemeyin, hatayı düzeltin.</li>
        </ol>
        <p className="text-[11px] text-muted-foreground mt-2">
          Not: Görüntüler sistemde kurulu Chrome ile headless olarak alınır (1440px genişlik, sayfa sonuna kadar scroll edilip <span className="font-medium">tam sayfa</span>) — bridge/extension gerekmez. Dinamik içerikli sayfalarda (kampanya banner&apos;ı, stok durumu) eşiği yükseltmek yanlış alarmları azaltır.
        </p>
      </div>
    </div>
  );
}
