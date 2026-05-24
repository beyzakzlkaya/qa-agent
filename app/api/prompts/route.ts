import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  listSavedPrompts,
  createSavedPrompt,
} from "@/lib/db/queries";

const SaveSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  platform: z.enum(["backoffice", "partner", "website"]),
  tags: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    const prompts = listSavedPrompts();
    return NextResponse.json({ prompts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = SaveSchema.parse(body);

    const id = uuidv4();
    createSavedPrompt({
      id,
      title: data.title,
      prompt: data.prompt,
      platform: data.platform,
      tags: (data.tags ?? []) as import("@/lib/types").Tag[],
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
