import { describe, expect, it } from "vitest";
import { ProjectEnvironmentInputSchema, ProjectInputSchema } from "../server/project-config/schema.js";

describe("project configuration boundary", () => {
  it("accepts project metadata and non-sensitive environment configuration", () => {
    expect(ProjectInputSchema.parse({ name: "AI 售后系统", code: "ai-after-sales", description: "验收项目" })).toMatchObject({ code: "ai-after-sales" });
    expect(ProjectEnvironmentInputSchema.parse({
      name: "测试环境",
      baseUrl: "http://127.0.0.1:8080/",
      headers: [{ name: "X-Tenant-ID", value: "demo" }],
    })).toMatchObject({ baseUrl: "http://127.0.0.1:8080" });
  });

  it.each(["Authorization", "Cookie", "X-API-Key", "access-token", "client-secret", "db-password"])(
    "rejects persisted sensitive header %s",
    (name) => {
      const result = ProjectEnvironmentInputSchema.safeParse({
        name: "测试环境",
        baseUrl: "https://example.test",
        headers: [{ name, value: "must-not-persist" }],
      });
      expect(result.success).toBe(false);
    },
  );

  it("rejects non-http target URLs", () => {
    const result = ProjectEnvironmentInputSchema.safeParse({
      name: "测试环境",
      baseUrl: "file:///etc/passwd",
      headers: [],
    });
    expect(result.success).toBe(false);
  });
});
