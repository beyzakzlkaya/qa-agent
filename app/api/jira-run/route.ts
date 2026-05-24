import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runJiraPipeline, generateOnlyPipeline } from "@/lib/jira-pipeline/jira-runner";
import { clearContextCache } from "@/lib/jira-pipeline/context-cache";

const JiraRunSchema = z.object({
  taskKey: z
    .string()
    .min(2)
    .regex(/^[A-Z][A-Z0-9]+-\d+$/, "Geçerli JIRA task numarası girin (örn. GM-123)"),
  environment: z.enum(["preprod", "prod"]),
  runType: z.enum(["smoke", "regression", "monkey", "custom"]).optional(),
  refreshContext: z.boolean().optional(),
  generateOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = JiraRunSchema.parse(body);

    if (data.refreshContext) {
      clearContextCache();
    }

    if (data.generateOnly) {
      const result = await generateOnlyPipeline({
        taskKey: data.taskKey,
        environment: data.environment,
        runType: data.runType,
      });

      return NextResponse.json({
        taskKey: result.taskKey,
        cases: result.cases,
        prUrl: result.prUrl ?? null,
        prAnalysis: result.prAnalysis ?? null,
        environment: data.environment,
        runType: data.runType ?? "regression",
      });
    }

    const result = await runJiraPipeline({
      taskKey: data.taskKey,
      environment: data.environment,
      runType: data.runType,
    });

    return NextResponse.json({
      runId: result.runId,
      taskKey: result.taskKey,
      caseCount: result.caseCount,
      prUrl: result.prUrl ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? err.message },
        { status: 400 }
      );
    }
    console.error("[api/jira-run] Pipeline hatası:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Bilinmeyen hata" },
      { status: 500 }
    );
  }
}
