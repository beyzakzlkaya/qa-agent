import { NextRequest, NextResponse } from "next/server";
import { indexRepository } from "@/lib/domain-agent/indexer";

export async function POST(req: NextRequest) {
  const owner =
    process.env.GITHUB_OWNER ??
    process.env.GITHUB_REPO_OWNER ??
    "Getmobil";
  const repo =
    process.env.GITHUB_REPO ??
    process.env.PROMPT_LIBRARY_REPO_NAME ??
    "getmobil-e2e-test-prompt-library";

  let refresh = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { refresh?: boolean };
    refresh = body.refresh ?? false;
  } catch {
    // body parse hatası — devam et
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        send({ type: "start", owner, repo, refresh });

        const result = await indexRepository(owner, repo, refresh, {
          onProgress: (msg: string) => send({ type: "progress", log: msg }),
        });

        send({
          type: "complete",
          filesProcessed: result.filesProcessed,
          chunksIndexed: result.chunksIndexed,
          durationMs: result.durationMs,
        });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
