import { NextResponse } from "next/server";
import { getDailyTrend, getTestCaseHealth } from "@/lib/db/queries";

export async function GET() {
  return NextResponse.json({
    dailyTrend: getDailyTrend(14),
    testCaseHealth: getTestCaseHealth(),
  });
}
