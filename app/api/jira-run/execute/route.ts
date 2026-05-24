import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startRun } from "@/lib/test-engine/runner";
import { transitionIssue } from "@/lib/jira-pipeline/api-clients";
import { schedulePostRunActions } from "@/lib/jira-pipeline/jira-runner";
import type { TestCase } from "@/lib/types";

const ExecuteSchema = z.object({
  taskKey: z.string().min(2),
  environment: z.enum(["preprod", "prod"]),
  runType: z.enum(["smoke", "regression", "monkey", "custom"]).optional(),
  cases: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      platform: z.array(z.enum(["backoffice", "partner", "website"])),
      tags: z.array(z.enum(["smoke", "regression", "monkey"])),
      priority: z.enum(["critical", "high", "medium", "low"]),
      prompt: z.string(),
      expectedOutcome: z.string(),
    })
  ),
  selectedIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = ExecuteSchema.parse(body);

    let casesToRun: TestCase[] = data.cases as TestCase[];

    if (data.selectedIds && data.selectedIds.length > 0) {
      casesToRun = casesToRun.filter((c) => data.selectedIds!.includes(c.id));
    }

    if (casesToRun.length === 0) {
      return NextResponse.json(
        { error: "Çalıştırılacak test case seçilmedi." },
        { status: 400 }
      );
    }

    const runName = `[JIRA] ${data.taskKey}`;
    const runId = await startRun({
      name: runName,
      cases: casesToRun,
      environment: data.environment,
      runType: data.runType ?? "regression",
      triggeredBy: "manual",
    });

    // Transition Jira task to "IN QA" — fire and forget
    transitionIssue(data.taskKey, "IN QA").catch((err) =>
      console.warn(`[execute] IN QA geçişi başarısız: ${(err as Error).message}`)
    );

    // Schedule post-run actions (comment + RTR or IN PROGRESS transition)
    schedulePostRunActions(runId, data.taskKey);

    return NextResponse.json({ runId, caseCount: casesToRun.length });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? err.message },
        { status: 400 }
      );
    }
    console.error("[api/jira-run/execute] Hata:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Bilinmeyen hata" },
      { status: 500 }
    );
  }
}
