import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

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
    if (scenarioCount < 1) throw new Error("至少需要一个场景或场景大纲");
  } catch (error) {
    throw new Error(`Cucumber Gherkin 语法校验失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
