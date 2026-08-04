import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listSnapshotTargets } from "@/lib/db/queries";
import { runSnapshotTargets } from "@/lib/snapshot-engine";

// Koşum sayfa yakalama beklemeleri içerir — Next.js default'u yetmez
export const maxDuration = 300;

const RunSchema = z.object({
  targetIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const data = RunSchema.parse(body);

    const ids =
      data.targetIds && data.targetIds.length > 0
        ? data.targetIds
        : listSnapshotTargets().map((t) => t.id);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Koşulacak snapshot hedefi yok. Önce hedef ekleyin." },
        { status: 400 }
      );
    }

    const outcomes = await runSnapshotTargets(ids);
    return NextResponse.json({ outcomes });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
