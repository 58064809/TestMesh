import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createSmartShoppingServer } from "../examples/ai-application/smart-shopping-target.js";

const server = createSmartShoppingServer();
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function turn(message: string, sessionId?: string) {
  const response = await fetch(`${baseUrl}/agent/invoke`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  const result = await response.json() as {
    slots: Record<string, unknown>; state: string;
    tool_calls: Array<{ arguments: { category: string; limit: number; filters: Record<string, unknown> } }>;
    recommended_product_ids: string[]; answer: string;
  };
  return { status: response.status, sessionId: response.headers.get("x-session-id"), result };
}

describe("simulated smart shopping target", () => {
  it("carries all valid constraints into the third turn and does not invent a third product", async () => {
    const first = await turn("帮我推荐3款羽毛球拍");
    const second = await turn("300元以内", first.sessionId!);
    const third = await turn("要轻一点的，80到85克", first.sessionId!);
    expect(first.status).toBe(200);
    expect(second.sessionId).toBe(first.sessionId);
    expect(third.result.slots).toEqual({ category: "badminton_racket", quantity: 3, max_price: 300, weight_min: 80, weight_max: 85 });
    expect(third.result.tool_calls[0].arguments).toMatchObject({
      category: "badminton_racket", limit: 3,
      filters: { max_price: 300, weight_min: 80, weight_max: 85, status: "ON_SALE", in_stock: true },
    });
    expect(third.result.recommended_product_ids).toEqual(["P001", "P002"]);
    expect(third.result.answer).toContain("只有2款");
    expect(third.result.answer).not.toContain("P003");
  });

  it("keeps sessions isolated and clarifies when the required category is absent", async () => {
    const unrelated = await turn("300元以内");
    expect(unrelated.result.state).toBe("CLARIFYING");
    expect(unrelated.result.tool_calls).toEqual([]);
  });
});
