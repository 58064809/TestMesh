import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { createZapPlan, parseZapReport, validateZapTargetUrl } from "../server/zap.js";

describe("P04-D ZAP passive baseline", () => {
  it("只生成 Traditional Spider、被动等待和 Traditional JSON 报告", () => {
    const plan = parse(createZapPlan("http://127.0.0.1:3301/#demo", "D:\\artifacts")) as {
      jobs: Array<{ type: string; parameters: Record<string, unknown> }>;
    };
    expect(plan.jobs.map((job) => job.type)).toEqual(["spider", "passiveScan-wait", "report"]);
    expect(plan.jobs[0].parameters.maxDuration).toBe(1);
    expect(plan.jobs[1].parameters.maxDuration).toBe(2);
    expect(plan.jobs[2].parameters.template).toBe("traditional-json");
    const text = JSON.stringify(plan).toLowerCase();
    expect(text).not.toContain("activescan");
    expect(text).not.toContain("ajax");
    expect(text).not.toContain("clientspider");
    expect(text).not.toContain("authentication");
  });

  it("限制为无认证 http/https 目标并移除 fragment", () => {
    expect(validateZapTargetUrl("http://example.test/path#section")).toBe("http://example.test/path");
    expect(() => validateZapTargetUrl("ftp://example.test/file")).toThrow("只支持 http 或 https");
    expect(() => validateZapTargetUrl("http://user:secret@example.test/")).toThrow("不支持");
  });

  it("从 Traditional JSON 唯一来源展开告警实例和风险计数", () => {
    const parsed = parseZapReport({
      site: [
        {
          alerts: [
            {
              pluginid: "10020",
              alert: "Missing Header",
              riskcode: "2",
              riskdesc: "Medium (High)",
              confidence: "High",
              desc: "Header missing",
              solution: "Add header",
              reference: "https://example.test/rule",
              instances: [
                { uri: "http://example.test/", method: "GET", param: "", evidence: "" },
                { uri: "http://example.test/about", method: "GET", param: "", evidence: "" },
              ],
            },
            {
              alertRef: "10021",
              name: "Information Disclosure",
              riskdesc: "Informational (Medium)",
              instances: [{ uri: "http://example.test/", method: "GET", evidence: "server" }],
            },
          ],
        },
      ],
    });
    expect(parsed.medium).toBe(1);
    expect(parsed.informational).toBe(1);
    expect(parsed.findings).toHaveLength(3);
    expect(parsed.findings[0]).toMatchObject({
      pluginId: "10020",
      name: "Missing Header",
      risk: "medium",
      url: "http://example.test/",
      method: "GET",
    });
  });

  it("报告结构不可靠时停止，不从终端补数据", () => {
    expect(() => parseZapReport({})).toThrow("缺少 site");
    expect(() => parseZapReport({ site: [{ alerts: {} }] })).toThrow("alerts 结构无效");
  });
});
