import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "path param zorunlu" }, { status: 400 });
  }

  // Security: only serve files within data/screenshots/
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith("data/screenshots/") && !normalized.startsWith("data\\screenshots\\")) {
    return NextResponse.json({ error: "Geçersiz dosya yolu" }, { status: 403 });
  }

  const fullPath = path.join(process.cwd(), normalized);
  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 404 });
  }

  const buffer = fs.readFileSync(fullPath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
