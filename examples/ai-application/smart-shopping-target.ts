import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

type Slots = { category?: string; quantity?: number; max_price?: number; weight_min?: number; weight_max?: number };
const products = [
  { product_id: "P001", name: "羽毛球拍A", price: 269, weight: 82, stock: 12, status: "ON_SALE" },
  { product_id: "P002", name: "羽毛球拍B", price: 299, weight: 85, stock: 8, status: "ON_SALE" },
];

function respond(response: ServerResponse, status: number, payload: unknown, sessionId?: string) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-trace-id": randomUUID().replaceAll("-", ""),
    ...(sessionId ? { "x-session-id": sessionId } : {}),
  });
  response.end(JSON.stringify(payload));
}

async function body(request: IncomingMessage) {
  let text = "";
  for await (const part of request) {
    text += part.toString();
    if (text.length > 16_384) throw new Error("模拟请求过大");
  }
  return JSON.parse(text) as { message?: unknown; session_id?: unknown };
}

export function createSmartShoppingServer() {
  const sessions = new Map<string, Slots>();
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/agent/invoke") {
      respond(response, 404, { error: "仅支持 POST /agent/invoke" }); return;
    }
    try {
      const input = await body(request);
      if (typeof input.message !== "string" || !input.message.trim()) {
        respond(response, 400, { error: "message 必须为非空字符串" }); return;
      }
      const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : randomUUID();
      const slots: Slots = { ...(sessions.get(sessionId) ?? {}) };
      const message = input.message;
      if (message.includes("羽毛球拍")) slots.category = "badminton_racket";
      if (message.includes("3款")) slots.quantity = 3;
      const budget = message.match(/(\d+)元以内/);
      if (budget) slots.max_price = Number(budget[1]);
      const weight = message.match(/(\d+)到(\d+)克/);
      if (weight) { slots.weight_min = Number(weight[1]); slots.weight_max = Number(weight[2]); }
      sessions.set(sessionId, slots);
      if (!slots.category) {
        respond(response, 200, {
          fixture: "simulated-smart-shopping-v1", intent: "product_recommendation", slots,
          state: "CLARIFYING", tool_calls: [], recommended_product_ids: [], answer: "请说明想推荐的商品品类。",
        }, sessionId); return;
      }
      const limit = slots.quantity ?? products.length;
      const filters = {
        ...(slots.max_price !== undefined ? { max_price: slots.max_price } : {}),
        ...(slots.weight_min !== undefined ? { weight_min: slots.weight_min } : {}),
        ...(slots.weight_max !== undefined ? { weight_max: slots.weight_max } : {}),
        status: "ON_SALE", in_stock: true,
      };
      const matched = products.filter((item) => item.stock > 0
        && (slots.max_price === undefined || item.price <= slots.max_price)
        && (slots.weight_min === undefined || item.weight >= slots.weight_min)
        && (slots.weight_max === undefined || item.weight <= slots.weight_max)).slice(0, limit);
      respond(response, 200, {
        fixture: "simulated-smart-shopping-v1", intent: "product_recommendation", slots,
        state: "COMPLETED",
        tool_calls: [{ name: "search_products", arguments: { category: slots.category, limit, filters, sort: { field: "recommendation_score", order: "desc" } } }],
        tool_response: { code: 0, data: { total: matched.length, products: matched } },
        recommended_product_ids: matched.map((item) => item.product_id),
        answer: matched.length < limit
          ? `当前只有${matched.length}款商品满足条件：${matched.map((item) => `${item.name}（${item.price}元、${item.weight}克）`).join("、")}。`
          : matched.map((item) => `${item.name}（${item.price}元、${item.weight}克）`).join("、"),
      }, sessionId);
    } catch (error) {
      respond(response, 400, { error: error instanceof Error ? error.message : "模拟请求无效" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SMART_SHOPPING_PORT ?? "8011");
  createSmartShoppingServer().listen(port, "127.0.0.1", () => {
    process.stdout.write(`simulated smart shopping target: http://127.0.0.1:${port}\n`);
  });
}
