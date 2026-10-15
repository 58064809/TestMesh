import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { useState } from "react";

const { Text } = Typography;

export default function ScriptCandidateScaffold({ kind }: { kind: "api" | "ui" }) {
  const [candidate, setCandidate] = useState("");
  const sample = kind === "api"
    ? `# 演示候选，不可执行\nGET {{baseUrl}}/after-sales/{{orderId}}\nHTTP 200\n[Asserts]\njsonpath "$.code" == 0`
    : `// 演示候选，不可执行\ntest('查询售后单状态', async ({ page }) => {\n  await page.goto('/after-sales');\n  await expect(page.getByRole('heading')).toContainText('售后');\n});`;
  return <Card size="small" title={`${kind === "api" ? "API" : "UI"} AI 脚本候选 · 搭架预览`}>
    <Space direction="vertical" size={10} className="engineering-main-stack">
      <Alert type="warning" showIcon message="演示数据 / 不可用于验收" description="这里只验证“LLM 候选可人工修正”的交互。内容不写入数据库、不能批准、不能交给 Runner；真实契约/仓库生成接入后删除此假数据路径。" />
      {!candidate ? <Button onClick={() => setCandidate(sample)}>加载隔离演示候选</Button> : <>
        <Text strong>人工修正候选脚本</Text>
        <Input.TextArea value={candidate} onChange={(event) => setCandidate(event.target.value)} rows={kind === "api" ? 8 : 10} className="testcase-gherkin-editor" />
        <Button disabled>校验并提交审核（等待真实生成接入）</Button>
      </>}
    </Space>
  </Card>;
}
