import fs from "fs";
import path from "path";
import type { CaseResult, TestRun } from "@/lib/types";

// data/ dizinini önceden oluştur — getDb'nin "dizin zaten var" dalını da kapsar
fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });

import { getDb } from "@/lib/db";
import * as q from "@/lib/db/queries";

function makeRun(overrides: Partial<TestRun> = {}): Omit<TestRun, "passedCases" | "failedCases"> {
  return {
    id: overrides.id ?? `run-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? "Smoke koşumu",
    environment: overrides.environment ?? "preprod",
    runType: overrides.runType ?? "smoke",
    status: overrides.status ?? "running",
    totalCases: overrides.totalCases ?? 2,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    finishedAt: overrides.finishedAt,
    triggeredBy: overrides.triggeredBy ?? "manual",
  };
}

function makeCaseResult(runId: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    id: overrides.id ?? `cr-${Math.random().toString(36).slice(2)}`,
    runId,
    caseId: overrides.caseId ?? "TC-001",
    platform: overrides.platform ?? "website",
    status: overrides.status ?? "success",
    steps: overrides.steps ?? [
      { index: 0, description: "adım", status: "success", timestamp: new Date().toISOString() },
    ],
    anomalies: overrides.anomalies ?? [],
    errorMessage: overrides.errorMessage,
    durationMs: overrides.durationMs,
    executedAt: overrides.executedAt ?? new Date().toISOString(),
  };
}

describe("db bağlantısı", () => {
  it("getDb singleton döner", () => {
    expect(getDb()).toBe(getDb());
  });
});

describe("runs", () => {
  it("createRun + getRun round-trip", () => {
    const run = q.createRun(makeRun({ id: "run-1", name: "Test A" }));
    expect(run.id).toBe("run-1");
    expect(run.passedCases).toBe(0);
    expect(q.getRun("run-1")?.name).toBe("Test A");
  });

  it("getRun bilinmeyen id için null döner", () => {
    expect(q.getRun("yok")).toBeNull();
  });

  it("listRuns başlangıç zamanına göre azalan sıralar", () => {
    q.createRun(makeRun({ id: "run-old", startedAt: "2026-01-01T00:00:00Z" }));
    q.createRun(makeRun({ id: "run-new", startedAt: "2026-06-01T00:00:00Z" }));
    const runs = q.listRuns(50);
    const ids = runs.map((r) => r.id);
    expect(ids.indexOf("run-new")).toBeLessThan(ids.indexOf("run-old"));
  });

  it("updateRunStatus alanları günceller", () => {
    q.createRun(makeRun({ id: "run-upd" }));
    q.updateRunStatus("run-upd", "success", 2, 0, "2026-06-01T01:00:00Z");
    const run = q.getRun("run-upd")!;
    expect(run.status).toBe("success");
    expect(run.passedCases).toBe(2);
    expect(run.finishedAt).toBe("2026-06-01T01:00:00Z");
  });

  it("finishedAt verilmeden de çalışır; finishedAt ile createRun edilebilir", () => {
    q.createRun(makeRun({ id: "run-nofin" }));
    q.updateRunStatus("run-nofin", "failed", 0, 2);
    expect(q.getRun("run-nofin")?.finishedAt).toBeNull();

    const withFin = q.createRun(
      makeRun({ id: "run-fin", finishedAt: "2026-06-02T00:00:00Z" })
    );
    expect(withFin.finishedAt).toBe("2026-06-02T00:00:00Z");
  });

  it("listRuns argümansız varsayılanlarla çalışır", () => {
    expect(Array.isArray(q.listRuns())).toBe(true);
  });

  it("markStaleRunsAsFailed running koşumları failed yapar", () => {
    q.createRun(makeRun({ id: "run-stale", status: "running" }));
    const changed = q.markStaleRunsAsFailed();
    expect(changed).toBeGreaterThanOrEqual(1);
    expect(q.getRun("run-stale")?.status).toBe("failed");
  });
});

describe("case_results", () => {
  it("createCaseResult + getCaseResultsByRun round-trip", () => {
    q.createRun(makeRun({ id: "run-cr" }));
    q.createCaseResult(makeCaseResult("run-cr", { id: "cr-1", errorMessage: "hata", durationMs: 1200 }));
    const results = q.getCaseResultsByRun("run-cr");
    expect(results).toHaveLength(1);
    expect(results[0].steps).toHaveLength(1);
    expect(results[0].errorMessage).toBe("hata");
  });

  it("saveCaseResults boş dizide hiçbir şey yapmaz", () => {
    expect(() => q.saveCaseResults([])).not.toThrow();
  });

  it("saveCaseResults toplu ekler", () => {
    q.createRun(makeRun({ id: "run-bulk" }));
    q.saveCaseResults([
      makeCaseResult("run-bulk", { id: "b1" }),
      makeCaseResult("run-bulk", { id: "b2", status: "failed" }),
    ]);
    expect(q.getCaseResultsByRun("run-bulk")).toHaveLength(2);
  });

  it("updateCaseResult durumu ve adımları günceller", () => {
    q.createRun(makeRun({ id: "run-ucr" }));
    q.createCaseResult(makeCaseResult("run-ucr", { id: "cr-upd" }));
    q.updateCaseResult("cr-upd", "failed", [], [], "patladı", 500);
    const [r] = q.getCaseResultsByRun("run-ucr");
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toBe("patladı");
  });

  it("updateCaseResult opsiyonel alanlar olmadan da çalışır", () => {
    q.createRun(makeRun({ id: "run-ucr2" }));
    q.createCaseResult(makeCaseResult("run-ucr2", { id: "cr-upd2" }));
    q.updateCaseResult("cr-upd2", "skipped", [], []);
    const [r] = q.getCaseResultsByRun("run-ucr2");
    expect(r.status).toBe("skipped");
    expect(r.errorMessage).toBeNull();
  });

  it("saveCaseResults opsiyonel alanları dolu satırları da ekler", () => {
    q.createRun(makeRun({ id: "run-bulk2" }));
    q.saveCaseResults([
      makeCaseResult("run-bulk2", { id: "bf1", errorMessage: "x", durationMs: 10 }),
    ]);
    const [r] = q.getCaseResultsByRun("run-bulk2");
    expect(r.durationMs).toBe(10);
  });
});

describe("saved_prompts", () => {
  it("create + list + increment + delete akışı", () => {
    q.createSavedPrompt({
      id: "p1",
      title: "Login testi",
      prompt: "Login ol",
      platform: "website",
      tags: ["smoke"],
      createdAt: new Date().toISOString(),
    });
    const prompts = q.listSavedPrompts();
    expect(prompts.some((p) => p.id === "p1")).toBe(true);

    q.incrementPromptRunCount("p1");
    const updated = q.listSavedPrompts().find((p) => p.id === "p1")!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastRunAt).toBeTruthy();

    expect(q.deleteSavedPrompt("p1")).toBe(true);
    expect(q.deleteSavedPrompt("p1")).toBe(false);
  });
});

describe("risk_analyses", () => {
  it("tüm alanlarla kaydeder ve en yenisini getirir", () => {
    const id = q.saveRiskAnalysis('{"a":1}', 42, "GM-1", "high", 80);
    expect(id).toBeGreaterThan(0);
    const row = q.getRiskAnalysis(42);
    expect(row?.risk_level).toBe("high");
  });

  it("opsiyonel alanlar olmadan kaydeder; bilinmeyen PR null döner", () => {
    q.saveRiskAnalysis('{"b":2}');
    expect(q.getRiskAnalysis(99999)).toBeNull();
  });
});

describe("screenshots", () => {
  it("kaydet + testCaseId/runId ile listele", () => {
    q.saveScreenshot("tc-a", "data/screenshots/tc-a/0-x.png", 0, "step", "run-ss");
    q.saveScreenshot("tc-a", "data/screenshots/tc-a/1-y.png");
    const byCase = q.getScreenshots("tc-a");
    expect(byCase).toHaveLength(2);
    expect(q.getScreenshotsByRun("run-ss")).toHaveLength(1);
  });

  it("getMaxScreenshotId ve getLatestScreenshotAfter", () => {
    expect(q.getMaxScreenshotId("tc-bos")).toBe(0);
    const before = q.getMaxScreenshotId("tc-a");
    expect(before).toBeGreaterThan(0);
    expect(q.getLatestScreenshotAfter("tc-a", before)).toBeNull();
    q.saveScreenshot("tc-a", "data/screenshots/tc-a/2-z.png", 2);
    expect(q.getLatestScreenshotAfter("tc-a", before)?.file_path).toContain("2-z");
  });
});

describe("jira cache tabloları", () => {
  it("risk summary: kaydet + cache hit/miss", () => {
    q.saveRiskSummary("GM-10", "hash1", "özet", 5);
    expect(q.getCachedRiskSummary("GM-10", "hash1")?.summary).toBe("özet");
    expect(q.getCachedRiskSummary("GM-10", "baska")).toBeNull();
    // pr_number olmadan da kaydedebilmeli
    q.saveRiskSummary("GM-11", "hash2", "özet2");
    expect(q.getCachedRiskSummary("GM-11", "hash2")?.pr_number).toBeNull();
  });

  it("qa effort: kaydet + cache hit/miss", () => {
    q.saveQaEffort("GM-20", "h1", '{"cases":[]}', 3, 45);
    expect(q.getCachedQaEffort("GM-20", "h1")?.total_minutes).toBe(45);
    expect(q.getCachedQaEffort("GM-20", "yok")).toBeNull();
  });

  it("jira iteration: index artar ve listelenir", () => {
    q.createRun(makeRun({ id: "run-j1" }));
    q.createRun(makeRun({ id: "run-j2" }));
    const first = q.recordJiraIteration("run-j1", "GM-30");
    const second = q.recordJiraIteration("run-j2", "GM-30");
    expect(first.iteration_index).toBe(1);
    expect(second.iteration_index).toBe(2);
    expect(q.getJiraIterations("GM-30")).toHaveLength(2);
  });
});

describe("analitik sorgular", () => {
  it("getDailyTrend bugünkü sonuçları toplar", () => {
    q.createRun(makeRun({ id: "run-trend" }));
    q.saveCaseResults([
      makeCaseResult("run-trend", { id: "t1", status: "success" }),
      makeCaseResult("run-trend", { id: "t2", status: "failed" }),
    ]);
    const trend = q.getDailyTrend(7);
    expect(trend.length).toBeGreaterThan(0);
    expect(trend[trend.length - 1].totalRuns).toBeGreaterThanOrEqual(2);
  });

  it("getRunsSummary oranları hesaplar", () => {
    q.createRun(makeRun({ id: "run-sum-ok", status: "running", totalCases: 4 }));
    q.updateRunStatus("run-sum-ok", "success", 4, 0);
    const summary = q.getRunsSummary();
    expect(summary.totalRuns).toBeGreaterThan(0);
    expect(summary.caseSuccessRate).toBeGreaterThanOrEqual(0);
    expect(summary.runSuccessRate).toBeGreaterThanOrEqual(0);
  });

  it("getRecentRunOutcomes bitmiş koşumları döner", () => {
    const outcomes = q.getRecentRunOutcomes(5);
    expect(Array.isArray(outcomes)).toBe(true);
    for (const o of outcomes) {
      expect(["success", "failed", "partial"]).toContain(o.status);
    }
  });

  it("getTestCaseHealth en az 2 koşumu olan case'leri döner", () => {
    q.createRun(makeRun({ id: "run-h1" }));
    q.createRun(makeRun({ id: "run-h2" }));
    q.saveCaseResults([
      makeCaseResult("run-h1", { id: "h1", caseId: "TC-HEALTH", status: "success" }),
      makeCaseResult("run-h2", { id: "h2", caseId: "TC-HEALTH", status: "failed" }),
    ]);
    const health = q.getTestCaseHealth();
    const target = health.find((h) => h.test_case_id === "TC-HEALTH");
    expect(target).toBeDefined();
    expect(target!.totalRuns).toBe(2);
    expect(target!.failCount).toBe(1);
  });
});

describe("snapshot testing tabloları", () => {
  const makeTarget = (id: string) => ({
    id,
    name: `Hedef ${id}`,
    platform: "website",
    environment: "preprod",
    path: "/",
    threshold: 0.5,
  });

  it("createSnapshotTarget + getSnapshotTarget round-trip", () => {
    const t = q.createSnapshotTarget(makeTarget("st-1"));
    expect(t.name).toBe("Hedef st-1");
    expect(t.baseline_path).toBeNull();
    expect(q.getSnapshotTarget("yok")).toBeNull();
  });

  it("listSnapshotTargets son sonucu iliştirir", () => {
    q.createSnapshotTarget(makeTarget("st-list"));
    let listed = q.listSnapshotTargets().find((t) => t.id === "st-list")!;
    expect(listed.last_result).toBeNull();

    q.insertSnapshotResult({ targetId: "st-list", status: "new", currentPath: "a.png" });
    q.insertSnapshotResult({
      targetId: "st-list",
      status: "mismatch",
      currentPath: "b.png",
      baselinePath: "base.png",
      diffPath: "d.png",
      diffPixels: 10,
      diffPercentage: 1.5,
      maskedPercentage: 4.2,
    });
    listed = q.listSnapshotTargets().find((t) => t.id === "st-list")!;
    expect(listed.last_result?.status).toBe("mismatch");
    expect(listed.last_result?.masked_percentage).toBe(4.2);
  });

  it("updateSnapshotTarget kısmi alan günceller; boş çağrı no-op", () => {
    q.createSnapshotTarget(makeTarget("st-upd"));
    q.updateSnapshotTarget("st-upd", {});
    q.updateSnapshotTarget("st-upd", { name: "Yeni Ad" });
    q.updateSnapshotTarget("st-upd", { path: "/sepet", threshold: 2 });
    const t = q.getSnapshotTarget("st-upd")!;
    expect(t.name).toBe("Yeni Ad");
    expect(t.path).toBe("/sepet");
    expect(t.threshold).toBe(2);
  });

  it("setSnapshotBaseline baseline yolunu ve zamanını yazar", () => {
    q.createSnapshotTarget(makeTarget("st-base"));
    q.setSnapshotBaseline("st-base", "data/screenshots/snapshot-baselines/st-base.png");
    const t = q.getSnapshotTarget("st-base")!;
    expect(t.baseline_path).toContain("st-base.png");
    expect(t.baseline_updated_at).toBeTruthy();
  });

  it("deleteSnapshotTarget hedefi ve sonuçlarını siler (cascade)", () => {
    q.createSnapshotTarget(makeTarget("st-del"));
    q.insertSnapshotResult({ targetId: "st-del", status: "new" });
    expect(q.deleteSnapshotTarget("st-del")).toBe(true);
    expect(q.deleteSnapshotTarget("st-del")).toBe(false);
    expect(q.listSnapshotResults("st-del")).toHaveLength(0);
  });

  it("insertSnapshotResult + getSnapshotResult + updateSnapshotResultStatus", () => {
    q.createSnapshotTarget(makeTarget("st-res"));
    const r = q.insertSnapshotResult({ targetId: "st-res", status: "mismatch", currentPath: "c.png" });
    expect(q.getSnapshotResult(r.id)?.status).toBe("mismatch");
    q.updateSnapshotResultStatus(r.id, "updated");
    expect(q.getSnapshotResult(r.id)?.status).toBe("updated");
    expect(q.getSnapshotResult(999999)).toBeNull();
  });

  it("listSnapshotResults en yeniden eskiye sıralar ve limit uygular", () => {
    q.createSnapshotTarget(makeTarget("st-hist"));
    for (let i = 0; i < 5; i++) {
      q.insertSnapshotResult({ targetId: "st-hist", status: i % 2 ? "match" : "mismatch" });
    }
    const limited = q.listSnapshotResults("st-hist", 3);
    expect(limited).toHaveLength(3);
    expect(limited[0].id).toBeGreaterThan(limited[1].id);
  });
});
