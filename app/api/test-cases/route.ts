import { NextRequest, NextResponse } from "next/server";
import { loadAllCases, loadTestCases } from "@/lib/test-engine/parser";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get("platform");
    const tag = searchParams.get("tag");

    let cases;
    if (platform && tag) {
      cases = loadTestCases(platform, tag);
    } else {
      cases = loadAllCases();
    }

    return NextResponse.json({ cases });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
