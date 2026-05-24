import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchPRDiff } from "@/lib/risk-analyzer/pr-fetcher";
import { analyzeRisk } from "@/lib/risk-analyzer/analyzer";
import { saveRiskAnalysis } from "@/lib/db/queries";
import { createTestPlan } from "@/lib/tc-planner/planner";

const AnalyzePRSchema = z.object({
  prNumber: z.number().int().positive(),
  jiraIssueKey: z.string().optional(),
  repoOwner: z.string().optional(),
  repoName: z.string().optional(),
  maxTestCases: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = AnalyzePRSchema.parse(body);

    // 1. Fetch PR diff
    const prDiff = await fetchPRDiff(
      data.prNumber,
      data.repoOwner,
      data.repoName
    );

    // 2. Analyze risk
    const riskAnalysis = await analyzeRisk(prDiff);

    // 3. Save to SQLite
    saveRiskAnalysis(
      JSON.stringify(riskAnalysis),
      data.prNumber,
      data.jiraIssueKey,
      riskAnalysis.riskLevel,
      riskAnalysis.riskScore
    );

    // 4. Create test plan
    const testPlan = await createTestPlan({
      riskAnalysis,
      maxTestCases: data.maxTestCases ?? 20,
      includeRegression: true,
    });

    return NextResponse.json({ riskAnalysis, testPlan });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[api/analyze-pr] Hata:", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
