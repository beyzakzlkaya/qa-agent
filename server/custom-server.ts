import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWebSocketServer } from "./ws-handler";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000");

async function main() {
  const app = next({ dev });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // WebSocket server for live step streaming
  const wss = new WebSocketServer({ noServer: true });
  setupWebSocketServer(wss);

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!);
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  httpServer.listen(port, () => {
    console.log(`> Next.js sunucusu hazır: http://localhost:${port}`);
    console.log(`> WebSocket endpoint: ws://localhost:${port}/ws`);
    console.log(`> Bridge: test koşumunda otomatik başlatılır (port ${process.env.PAGE_AGENT_PORT || "38401"})`);
  });

  function shutdown(signal: string) {
    console.log(`\n> ${signal} alındı, sunucu kapatılıyor...`);
    wss.close();
    httpServer.close(() => {
      console.log("> Sunucu kapatıldı.");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(console.error);
