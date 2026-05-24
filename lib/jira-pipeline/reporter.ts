/**
 * lib/jira-pipeline/reporter.ts
 *
 * Test koşumu tamamlanınca JIRA REST API v3 üzerinden task'a
 * QA sonuç yorumu yazar (Atlassian Document Format).
 */

import type { CaseResult, RunStatus } from "../types";
import type { RiskAnalysis } from "../risk-analyzer/types";
import { jiraPost } from "./api-clients";

// ── Report formatter ───────────────────────────────────────────────────────────

export interface RunReport {
  taskKey: string;
  prUrl?: string;
  runId: string;
  caseResults: CaseResult[];
  startedAt: string;
  finishedAt: string;
  runStatus?: RunStatus;
  riskAnalysis?: RiskAnalysis;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── ADF (Atlassian Document Format) builder helpers ────────────────────────────

type AdfNode = Record<string, unknown>;

function adfDoc(...content: AdfNode[]): AdfNode {
  return { type: "doc", version: 1, content };
}

function adfHeading(level: 1 | 2 | 3, text: string): AdfNode {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function adfParagraph(...inlines: AdfNode[]): AdfNode {
  return { type: "paragraph", content: inlines };
}

function adfText(text: string, bold = false, color?: string): AdfNode {
  const marks: AdfNode[] = [];
  if (bold) marks.push({ type: "strong" });
  if (color) marks.push({ type: "textColor", attrs: { color } });
  return marks.length > 0
    ? { type: "text", text, marks }
    : { type: "text", text };
}

function adfRule(): AdfNode {
  return { type: "rule" };
}

function adfBulletList(items: AdfNode[]): AdfNode {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [item] }],
    })),
  };
}

function adfPanel(panelType: "info" | "success" | "warning" | "error", ...content: AdfNode[]): AdfNode {
  return { type: "panel", attrs: { panelType }, content };
}

// ── Main ADF document builder ──────────────────────────────────────────────────

function buildAdfComment(report: RunReport): AdfNode {
  const passed = report.caseResults.filter((r) => r.status === "success");
  const failed = report.caseResults.filter((r) => r.status === "failed");
  const total = report.caseResults.length;

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const runUrl = `${appBaseUrl}/run/${report.runId}`;
  const durationSec = Math.round(
    (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000
  );

  const overallStatus = report.runStatus;
  const allPassed = failed.length === 0;

  const nodes: AdfNode[] = [];

  // ── Title
  nodes.push(adfHeading(2, `🤖 QA Otomasyon Raporu — ${report.taskKey}`));

  // ── Result panel (success or warning)
  const panelType = allPassed ? "success" : failed.length === total ? "error" : "warning";
  const statusEmoji = allPassed ? "✅" : failed.length === total ? "❌" : "⚠️";
  const statusLabel = allPassed
    ? "Tüm testler başarıyla geçti"
    : failed.length === total
    ? "Tüm testler başarısız"
    : `${passed.length}/${total} test geçti`;

  nodes.push(
    adfPanel(
      panelType,
      adfParagraph(
        adfText(`${statusEmoji} ${statusLabel}`, true)
      )
    )
  );

  // ── Summary table rows as bullet list
  const summaryItems: AdfNode[] = [
    adfText(`📋 Toplam test: ${total}`),
    adfText(`✅ Geçti: ${passed.length}`),
    adfText(`❌ Başarısız: ${failed.length}`),
    adfText(`⏱ Süre: ${durationSec}s`),
    adfText(`📅 Tarih: ${formatDate(report.startedAt)}`),
  ];

  if (report.prUrl) {
    summaryItems.push(adfText(`🔗 PR: ${report.prUrl}`));
  }
  summaryItems.push(adfText(`🔗 Run: ${runUrl}`));

  nodes.push(adfBulletList(summaryItems));
  nodes.push(adfRule());

  // ── Failed tests section
  if (failed.length > 0) {
    nodes.push(adfHeading(3, "❌ Başarısız Testler"));

    for (const r of failed) {
      nodes.push(
        adfParagraph(adfText(`[${r.caseId}] — ${r.platform.toUpperCase()}`, true))
      );

      const details: AdfNode[] = [];

      if (r.errorMessage) {
        details.push(adfText(`Hata: ${r.errorMessage.slice(0, 400)}`));
      }

      if (r.steps.length > 0) {
        const lastStep = r.steps[r.steps.length - 1];
        details.push(adfText(`Son adım: ${lastStep.description.slice(0, 200)}`));
      }

      if (r.anomalies.length > 0) {
        details.push(
          adfText(
            `Anomaliler: ${r.anomalies.map((a) => a.message.slice(0, 100)).join(" | ")}`
          )
        );
      }

      if (details.length > 0) {
        nodes.push(adfBulletList(details));
      }
    }

    nodes.push(adfRule());
  }

  // ── Passed tests section
  if (passed.length > 0) {
    nodes.push(adfHeading(3, "✅ Geçen Testler"));

    const passedItems = passed.map((r) => {
      const dur = r.durationMs ? ` — ${Math.round(r.durationMs / 1000)}s` : "";
      return adfText(`[${r.caseId}] ${r.platform.toUpperCase()}${dur}`);
    });

    nodes.push(adfBulletList(passedItems));
    nodes.push(adfRule());
  }

  // ── Footer
  const nextStatus = allPassed ? "RTR (Ready to Release)" : "IN PROGRESS (teste geri döndü)";
  nodes.push(
    adfParagraph(
      adfText(`Sonraki durum: `, false),
      adfText(nextStatus, true)
    )
  );

  // ── Risk Analysis Section (if available)
  if (report.riskAnalysis) {
    const ra = report.riskAnalysis;
    nodes.push(adfRule());
    nodes.push(adfHeading(3, "🔍 Risk Analizi"));

    const riskBadge =
      ra.riskLevel === "critical"
        ? "🔴 Critical"
        : ra.riskLevel === "high"
        ? "🟠 High"
        : ra.riskLevel === "medium"
        ? "🟡 Medium"
        : "🟢 Low";

    nodes.push(
      adfPanel(
        ra.riskLevel === "critical" || ra.riskLevel === "high"
          ? "warning"
          : "info",
        adfParagraph(adfText(`Risk Seviyesi: ${riskBadge} (Skor: ${ra.riskScore}/100)`, true))
      )
    );

    if (ra.affectedScreens.length > 0) {
      nodes.push(
        adfParagraph(adfText(`Etkilenen Ekranlar: ${ra.affectedScreens.join(", ")}`))
      );
    }

    if (ra.regressionRisk.length > 0) {
      nodes.push(adfHeading(3, "⚠️ Regresyon Riskleri"));
      nodes.push(
        adfBulletList(ra.regressionRisk.map((r) => adfText(r)))
      );
    }

    if (ra.suggestedNewTestScenarios.length > 0) {
      nodes.push(adfHeading(3, "💡 Önerilen Yeni Test Senaryoları"));
      nodes.push(
        adfBulletList(
          ra.suggestedNewTestScenarios.map((s) =>
            adfText(`[${s.priority.toUpperCase()}] ${s.title}: ${s.description}`)
          )
        )
      );
    }
  }

  return adfDoc(...nodes);
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function reportToJira(report: RunReport): Promise<void> {
  console.log(`[jira-pipeline] JIRA'ya rapor yazılıyor: ${report.taskKey}`);

  const adfBody = buildAdfComment(report);

  try {
    await jiraPost(`/issue/${report.taskKey}/comment`, { body: adfBody });
    console.log(`[jira-pipeline] JIRA yorumu yazıldı: ${report.taskKey}`);
  } catch (err) {
    console.error(
      `[jira-pipeline] JIRA yorum yazılamadı: ${(err as Error).message}`
    );
  }
}
