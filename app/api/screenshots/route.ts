import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { saveScreenshot, getScreenshots } from "@/lib/db/queries";

const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");
const MAX_SIZE_MB = parseInt(process.env.SCREENSHOT_MAX_SIZE_MB ?? "5", 10);

function sanitize(str: string): string {
  return str.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 80);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      testCaseId: string;
      stepIndex?: number;
      imageBase64: string;
      timestamp?: string;
      label?: string;
      runId?: string;
    };

    if (!body.testCaseId || !body.imageBase64) {
      return NextResponse.json(
        { error: "testCaseId ve imageBase64 zorunlu" },
        { status: 400 }
      );
    }

    // Size check
    const sizeBytes = Math.ceil((body.imageBase64.length * 3) / 4);
    if (sizeBytes > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `Screenshot çok büyük (max ${MAX_SIZE_MB}MB)` },
        { status: 413 }
      );
    }

    const tcId = sanitize(body.testCaseId);
    const label = body.label ? sanitize(body.label) : "screenshot";
    const stepIdx = body.stepIndex ?? 0;
    const filename = `${stepIdx}-${label}.png`;

    const dir = path.join(SCREENSHOTS_DIR, tcId);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, filename);
    const imgBuffer = Buffer.from(body.imageBase64, "base64");
    fs.writeFileSync(filePath, imgBuffer);

    const relativePath = path.join("data", "screenshots", tcId, filename);
    saveScreenshot(body.testCaseId, relativePath, stepIdx, body.label, body.runId);

    return NextResponse.json({ ok: true, filePath: relativePath });
  } catch (err) {
    console.error("[api/screenshots] POST hatası:", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const testCaseId = searchParams.get("testCaseId");

  if (!testCaseId) {
    return NextResponse.json(
      { error: "testCaseId query param zorunlu" },
      { status: 400 }
    );
  }

  const rows = getScreenshots(testCaseId);
  return NextResponse.json({ screenshots: rows });
}
