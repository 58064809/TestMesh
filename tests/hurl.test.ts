import { describe, expect, it } from "vitest";
import { parseHurlJUnit, validateHurlScenario } from "../server/hurl.js";

describe("Hurl scenario validation", () => {
  it("accepts project-bound requests and runtime secrets", () => {
    expect(() => validateHurlScenario(`GET {{baseUrl}}/health\nAuthorization: Bearer {{token}}\nHTTP 200`)).not.toThrow();
  });

  it("rejects hard-coded targets and persisted secrets", () => {
    expect(() => validateHurlScenario("GET https://example.com/health\nHTTP 200")).toThrow(/baseUrl/);
    expect(() => validateHurlScenario("GET {{baseUrl}}/health\nAuthorization: Bearer saved-secret\nHTTP 200")).toThrow(/明文/);
    expect(() => validateHurlScenario("POST {{baseUrl}}/upload\nfile,../../secret.txt;\nHTTP 201")).toThrow(/本机文件/);
  });
});

describe("Hurl JUnit", () => {
  it("parses passed and failed scenarios", () => {
    const result = parseHurlJUnit(`<?xml version="1.0"?>
      <testsuites tests="2" failures="1">
        <testsuite name="checkout">
          <testcase name="login" classname="checkout" time="0.1" />
          <testcase name="pay" classname="checkout" time="0.2">
            <failure message="assertion failed">expected 200 but received 500</failure>
          </testcase>
        </testsuite>
      </testsuites>`);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items[1]).toMatchObject({ name: "pay", status: "failed" });
    expect(result.items[1].detail).toContain("received 500");
  });
});
