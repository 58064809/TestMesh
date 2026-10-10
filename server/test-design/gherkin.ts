import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

export function normalizeChineseGherkin(source: string): string {
  let normalized = source
    .replace(/^(\s*)功能大纲[：:]/gm, "$1功能:")
    .replace(/^(\s*(?:功能|规则|背景|场景|场景大纲|例子))：/gm, "$1:");
  if (/^\s*例子:/m.test(normalized) && !/^\s*场景大纲:/m.test(normalized)) {
    normalized = normalized.replace(/^(\s*)场景:/m, "$1场景大纲:");
  }
  return normalized;
}

export function validateChineseGherkin(source: string): void {
  if (!source.trimStart().startsWith("# language: zh-CN")) {
    throw new Error("Gherkin 必须以“# language: zh-CN”声明简体中文");
  }
  try {
    const parser = new Parser(
      new AstBuilder(IdGenerator.incrementing()),
      new GherkinClassicTokenMatcher("zh-CN"),
    );
    const document = parser.parse(source);
    const feature = document.feature;
    if (!feature) throw new Error("缺少功能");
    const scenarioCount = feature.children.filter((child) => child.scenario).length
      + feature.children.flatMap((child) => child.rule?.children ?? [])
        .filter((child) => child.scenario).length;
    if (scenarioCount !== 1) throw new Error(`每条 TestCase 必须且只能包含一个场景或场景大纲，当前为 ${scenarioCount} 个`);
  } catch (error) {
    throw new Error(`Cucumber Gherkin 语法校验失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
