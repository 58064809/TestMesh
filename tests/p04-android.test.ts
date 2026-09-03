import { describe, expect, it } from "vitest";
import { parseWdioJUnit } from "../server/android.js";

describe("P04-B WebdriverIO JUnit results", () => {
  it("maps passed, failed and skipped test cases", () => {
    const results = parseWdioJUnit(`<?xml version="1.0"?>
      <testsuites>
        <testsuite name="Settings">
          <testcase classname="Android Settings" name="opens settings" time="1.25" />
          <testcase classname="Android Settings" name="shows failure" time="0.5">
            <failure message="expected package">AssertionError: mismatch</failure>
          </testcase>
          <testcase classname="Android Settings" name="pending"><skipped /></testcase>
        </testsuite>
      </testsuites>`);

    expect(results).toEqual([
      { title: "opens settings", suite: "Android Settings", status: "passed", durationMs: 1250, error: "" },
      { title: "shows failure", suite: "Android Settings", status: "failed", durationMs: 500, error: "expected package\nAssertionError: mismatch" },
      { title: "pending", suite: "Android Settings", status: "skipped", durationMs: 0, error: "" },
    ]);
  });

  it("stops when JUnit has no test cases", () => {
    expect(() => parseWdioJUnit("<testsuites><testsuite name=\"empty\" /></testsuites>"))
      .toThrow("没有可持久化的测试结果");
  });
});
