import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { createSnapshotTarget, listSnapshotTargets } from "@/lib/db/queries";
import { isSnapshotRunInProgress } from "@/lib/snapshot-engine";

const CreateTargetSchema = z.object({
  name: z.string().min(1).max(120),
  platform: z.enum(["backoffice", "partner", "website"]),
  environment: z.enum(["preprod", "prod"]),
  path: z.string().max(500).default("/"),
  threshold: z.number().min(0).max(100).default(0.5),
});

export async function GET() {
  const targets = listSnapshotTargets();
  return NextResponse.json({ targets, running: isSnapshotRunInProgress() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = CreateTargetSchema.parse(body);
    const target = createSnapshotTarget({
      id: uuidv4(),
      name: data.name,
      platform: data.platform,
      environment: data.environment,
      path: data.path || "/",
      threshold: data.threshold,
    });
    return NextResponse.json({ target }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
