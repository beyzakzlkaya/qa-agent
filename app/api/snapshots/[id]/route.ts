import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSnapshotTarget,
  updateSnapshotTarget,
  deleteSnapshotTarget,
  listSnapshotResults,
} from "@/lib/db/queries";

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  path: z.string().max(500).optional(),
  threshold: z.number().min(0).max(100).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const target = getSnapshotTarget(params.id);
  if (!target) {
    return NextResponse.json({ error: "Hedef bulunamadı" }, { status: 404 });
  }
  const results = listSnapshotResults(params.id, 30);
  return NextResponse.json({ target, results });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const data = PatchSchema.parse(body);
    if (!getSnapshotTarget(params.id)) {
      return NextResponse.json({ error: "Hedef bulunamadı" }, { status: 404 });
    }
    updateSnapshotTarget(params.id, data);
    return NextResponse.json({ target: getSnapshotTarget(params.id) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const deleted = deleteSnapshotTarget(params.id);
  if (!deleted) {
    return NextResponse.json({ error: "Hedef bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
