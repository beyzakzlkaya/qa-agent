import { NextRequest, NextResponse } from "next/server";
import { deleteSavedPrompt } from "@/lib/db/queries";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = deleteSavedPrompt(params.id);
    if (!deleted) {
      return NextResponse.json({ error: "Prompt bulunamadı" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
