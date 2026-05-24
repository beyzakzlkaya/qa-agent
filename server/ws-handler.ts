import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { WsMessage } from "../lib/types";
import { setBroadcastFn } from "../lib/test-engine/runner";

interface RunSubscribers {
  [runId: string]: Set<WebSocket>;
}

const subscribers: RunSubscribers = {};
// Clients connected without a runId (e.g. Header listening for hub_status)
const globalClients: Set<WebSocket> = new Set();

// Per-run message buffer: keeps all broadcast messages so late-joining WS clients
// receive the full history (e.g. run page opens after steps already emitted)
const runBuffers: Map<string, WsMessage[]> = new Map();
const MAX_BUFFER = 500;

function bufferMessage(runId: string, msg: WsMessage): void {
  let buf = runBuffers.get(runId);
  if (!buf) {
    buf = [];
    runBuffers.set(runId, buf);
  }
  buf.push(msg);
  if (buf.length > MAX_BUFFER) buf.shift();
  // Clean up buffer after run finishes
  if (msg.type === "run_end") {
    setTimeout(() => runBuffers.delete(runId), 60_000);
  }
}

export function broadcastGlobal(msg: WsMessage): void {
  const data = JSON.stringify(msg);
  Array.from(globalClients).forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
  // Also fan out to all run subscribers so any open run page receives hub_status
  for (const subs of Object.values(subscribers)) {
    Array.from(subs).forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}

export function setupWebSocketServer(wss: WebSocketServer): void {
  setBroadcastFn((runId: string, msg: WsMessage) => {
    // Buffer every message for late-joining subscribers
    bufferMessage(runId, msg);

    const subs = subscribers[runId];
    if (!subs) return;

    const data = JSON.stringify(msg);
    Array.from(subs).forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "ws://localhost");
    const runId = url.searchParams.get("runId");

    if (!runId) {
      // Global client — used by Header to receive hub_status pushes
      globalClients.add(ws);
      ws.on("close", () => globalClients.delete(ws));
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type: string };
          if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
        } catch { /* ignore */ }
      });
      ws.send(JSON.stringify({ type: "log", payload: { message: "Global bağlantı kuruldu" } }));
      return;
    }

    if (!subscribers[runId]) {
      subscribers[runId] = new Set();
    }
    subscribers[runId].add(ws);

    // Replay buffered messages so late-joining clients see all past steps
    const buffered = runBuffers.get(runId);
    if (buffered && buffered.length > 0) {
      for (const msg of buffered) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }
    }

    ws.on("close", () => {
      subscribers[runId]?.delete(ws);
      if (subscribers[runId]?.size === 0) {
        delete subscribers[runId];
      }
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string };
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed
      }
    });

    ws.send(JSON.stringify({ type: "log", payload: { message: "Bağlantı kuruldu" } }));
  });
}
