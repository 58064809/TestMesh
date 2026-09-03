import { describe, expect, it } from "vitest";
import { parseK6Summary } from "../server/k6.js";

describe("P04-C k6 summary-export", () => {
  it("从唯一 summary JSON 结果源提取指标与阈值", () => {
    const summary = parseK6Summary({
      metrics: {
        http_reqs: { count: 3 },
        http_req_failed: { value: 0 },
        iterations: { count: 3 },
        checks: { passes: 3, fails: 0 },
        http_req_duration: {
          avg: 10.5,
          max: 22.8,
          "p(90)": 19.4,
          "p(95)": 21.1,
          thresholds: { "p(95)<1000": false },
        },
      },
    });

    expect(summary).toEqual({
      httpRequests: 3,
      requestFailedRate: 0,
      iterations: 3,
      checksPassed: 3,
      checksFailed: 0,
      durationAvgMs: 10.5,
      durationP90Ms: 19.4,
      durationP95Ms: 21.1,
      durationMaxMs: 22.8,
      thresholds: [{ metric: "http_req_duration", expression: "p(95)<1000", failed: false }],
    });
  });

  it("保留 k6 2.2.0 的 threshold crossed 失败语义", () => {
    const summary = parseK6Summary({
      metrics: {
        http_req_duration: { thresholds: { "p(95)<0.001": true } },
      },
    });
    expect(summary.thresholds[0]).toEqual({
      metric: "http_req_duration",
      expression: "p(95)<0.001",
      failed: true,
    });
  });

  it("缺少 metrics 时停止，不从终端输出补数据", () => {
    expect(() => parseK6Summary({})).toThrow("缺少 metrics");
  });
});
