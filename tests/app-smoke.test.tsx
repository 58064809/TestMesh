import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import App from "../src/App.js";

vi.mock("../src/ApiTesting.js", () => ({ default: () => null }));
vi.mock("../src/UiTesting.js", () => ({ default: () => null }));
vi.mock("../src/AppTesting.js", () => ({ default: () => null }));
vi.mock("../src/PerformanceTesting.js", () => ({ default: () => null }));
vi.mock("../src/SecurityTesting.js", () => ({ default: () => null }));
vi.mock("../src/RequirementAnalysisView.js", () => ({ default: () => null }));

describe("workbench first render", () => {
  it("renders the analysis page without a startup exception", () => {
    const html = renderToString(createElement(App));
    expect(html).toContain("AI 需求分析");
  });
});
