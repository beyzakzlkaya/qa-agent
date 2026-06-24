import { buildRunSummary, type RunSummary } from "../reports/run-summary";

type SlackBlock = Record<string, unknown>;

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

function statusEmoji(summary: RunSummary): string {
  const { run, counts } = summary;
  if (run.status === "running") return ":hourglass_flowing_sand:";
  if (counts.failed === 0 && counts.passed > 0) return ":white_check_mark:";
  if (counts.passed === 0 && counts.failed > 0) return ":x:";
  return ":warning:";
}

function statusLabel(summary: RunSummary): string {
  const { counts } = summary;
  if (counts.failed === 0 && counts.passed > 0) return "Tüm testler başarıyla geçti";
  if (counts.passed === 0 && counts.failed > 0) return "Tüm testler başarısız";
  return `${counts.passed}/${counts.total} test geçti`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function buildSlackBlocks(summary: RunSummary): SlackBlock[] {
  const { run, counts, durationMs, errorTypes, topFailures, links } = summary;
  const durationSec = durationMs != null ? Math.round(durationMs / 1000) : null;

  const blocks: SlackBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `${statusEmoji(summary)} ${run.name}`,
      emoji: true,
    },
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${statusLabel(summary)}*\n_${run.environment.toUpperCase()} • ${run.runType} • ${run.triggeredBy}_`,
    },
  });

  const summaryFields: SlackBlock[] = [
    { type: "mrkdwn", text: `*Toplam:* ${counts.total}` },
    { type: "mrkdwn", text: `*Geçti:* ${counts.passed}` },
    { type: "mrkdwn", text: `*Başarısız:* ${counts.failed}` },
    { type: "mrkdwn", text: `*Süre:* ${durationSec != null ? `${durationSec}s` : "—"}` },
    { type: "mrkdwn", text: `*Başlangıç:* ${formatDate(run.startedAt)}` },
    {
      type: "mrkdwn",
      text: `*Durum:* ${run.status}`,
    },
  ];

  blocks.push({ type: "section", fields: summaryFields });

  const meaningfulErrorTypes = errorTypes.filter((b) => b.count > 0);
  if (meaningfulErrorTypes.length > 0) {
    const text = meaningfulErrorTypes
      .map((b) => `• *${b.type}* (${b.owner}): ${b.count}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Hata dağılımı*\n${text}` },
    });
  }

  if (topFailures.length > 0) {
    const failuresText = topFailures
      .slice(0, 5)
      .map((f) => {
        const err = f.errorMessage ? truncate(f.errorMessage, 180) : "—";
        return `• \`${f.caseId}\` (${f.platform}) — ${err}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Başarısız testler (ilk ${Math.min(5, topFailures.length)})*\n${failuresText}`,
      },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Canlı Run", emoji: true },
        url: links.runUrl,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Detaylı Rapor", emoji: true },
        url: links.reportUrl,
      },
    ],
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Run ID: \`${run.id}\``,
      },
    ],
  });

  return blocks;
}

export interface SendOptions {
  webhookUrl?: string;
}

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  status?: number;
}

async function postWebhook(
  webhookUrl: string,
  body: { text: string; blocks: SlackBlock[] }
): Promise<SendResult> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      reason: `Slack webhook hatası ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  return { ok: true, status: res.status };
}

export async function postRunSummaryToSlack(
  runId: string,
  opts: SendOptions = {}
): Promise<SendResult> {
  const webhookUrl = opts.webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, skipped: true, reason: "SLACK_WEBHOOK_URL tanımlı değil" };
  }

  const summary = buildRunSummary(runId);
  if (!summary) {
    return { ok: false, reason: `Run bulunamadı: ${runId}` };
  }

  const blocks = buildSlackBlocks(summary);
  const fallback = `${summary.run.name} — ${statusLabel(summary)}`;

  return postWebhook(webhookUrl, { text: fallback, blocks });
}
