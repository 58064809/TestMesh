import http from "node:http";
import { randomUUID } from "node:crypto";

const host = "127.0.0.1";
const port = Number(process.env.TESTMESH_DEMO_API_PORT ?? 3021);
const returns = new Map<string, { id: string; orderId: string; status: string }>();

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ready", target: "TestMesh controlled API demo" });
      return;
    }

    if (request.method === "POST" && request.url === "/returns") {
      const body = await readJson(request);
      if (
        typeof body.orderId !== "string" || body.orderId.length === 0
        || typeof body.reason !== "string" || body.reason.length === 0
        || body.confirmed !== true
      ) {
        json(response, 422, { code: "RETURN_INFO_INCOMPLETE", message: "退货信息不完整或尚未确认" });
        return;
      }
      const item = { id: randomUUID(), orderId: String(body.orderId), status: "review_pending" };
      returns.set(item.id, item);
      json(response, 201, item);
      return;
    }

    const match = /^\/returns\/([^/]+)$/.exec(request.url ?? "");
    if (request.method === "GET" && match) {
      const item = returns.get(decodeURIComponent(match[1]));
      if (!item) {
        json(response, 404, { code: "RETURN_NOT_FOUND" });
        return;
      }
      json(response, 200, item);
      return;
    }

    if (request.url === "/health" || request.url === "/returns" || match) {
      response.setHeader("allow", request.url === "/health" ? "GET" : request.url === "/returns" ? "POST" : "GET");
      json(response, 405, { code: "METHOD_NOT_ALLOWED" });
      return;
    }

    json(response, 404, { code: "NOT_FOUND" });
  } catch (error) {
    json(response, 400, { code: "INVALID_REQUEST", message: error instanceof Error ? error.message : "请求错误" });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`TestMesh controlled API demo: http://${host}:${port}\n`);
  process.stdout.write("This target is for platform demonstration only; it is not a business acceptance environment.\n");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
