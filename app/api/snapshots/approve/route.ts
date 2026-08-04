import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approveSnapshot } from "@/lib/snapshot-engine";

const ApproveSchema = z.object({
  resultIds: z.array(z.number().int().positive()).min(1),
});

/**
 * jest --updateSnapshot karşılığı: seçilen mismatch sonuçların current
 * görüntüsünü yeni baseline yapar.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = ApproveSchema.parse(body);

    const updated: number[] = [];
    const errors: { resultId: number; error: string }[] = [];
    for (const id of data.resultIds) {
      try {
        approveSnapshot(id);
        updated.push(id);
      } catch (err) {
        errors.push({ resultId: id, error: (err as Error).message });
      }
    }
    return NextResponse.json({ updated, errors });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
