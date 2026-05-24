import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startRun, runWithPlan } from "@/lib/test-engine/runner";
import { loadCasesByIds, loadCasesByTag, loadAllCases } from "@/lib/test-engine/parser";
import type { TestCase } from "@/lib/types";

const ExecuteSchema = z.object({
  name: z.string().min(1),
  environment: z.enum(["preprod", "prod"]),
  runType: z.enum(["smoke", "regression", "monkey", "custom"]),
  caseIds: z.array(z.string()).optional(),
  /** Explicit platform filter — only run on these platforms */
  selectedPlatforms: z.array(z.enum(["backoffice", "partner", "website"])).optional(),
  customPrompt: z
    .object({
      title: z.string(),
      prompt: z.string(),
      platform: z.array(z.enum(["backoffice", "partner", "website"])),
      expectedOutcome: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  triggeredBy: z.enum(["manual", "scheduled"]).optional(),
  /** If provided, run test cases in the order defined by this plan */
  planId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = ExecuteSchema.parse(body);

    // Plan-based run
    if (data.planId) {
      const runId = await runWithPlan(data.planId, {
        name: data.name,
        environment: data.environment,
        runType: data.runType,
        triggeredBy: data.triggeredBy ?? "manual",
        selectedPlatforms: data.selectedPlatforms as import("@/lib/config/environments").Platform[] | undefined,
      });
      return NextResponse.json({ runId, planId: data.planId });
    }

    let cases: TestCase[] = [];

    if (data.customPrompt) {
      cases = [
        {
          id: `CUSTOM-${Date.now()}`,
          title: data.customPrompt.title,
          platform: data.customPrompt.platform as TestCase["platform"],
          tags: (data.customPrompt.tags ?? []) as TestCase["tags"],
          priority: "high",
          prompt: data.customPrompt.prompt,
          expectedOutcome:
            data.customPrompt.expectedOutcome ?? "Test başarıyla tamamlanmalı",
        },
      ];
    } else if (data.caseIds && data.caseIds.length > 0) {
      cases = loadCasesByIds(data.caseIds);
    } else if (data.runType !== "custom") {
      cases = loadCasesByTag(data.runType);
    } else {
      cases = loadAllCases();
    }

    if (cases.length === 0) {
      return NextResponse.json(
        { error: "Çalıştırılacak test case bulunamadı" },
        { status: 400 }
      );
    }

    const runId = await startRun({
      name: data.name,
      cases,
      environment: data.environment,
      runType: data.runType,
      triggeredBy: data.triggeredBy ?? "manual",
      // For customPrompt, the platform list IS the selection; for caseIds use explicit selectedPlatforms if provided
      selectedPlatforms: data.customPrompt
        ? (data.customPrompt.platform as import("@/lib/config/environments").Platform[])
        : (data.selectedPlatforms as import("@/lib/config/environments").Platform[] | undefined),
    });

    return NextResponse.json({ runId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
