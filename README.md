# TestMesh

TestMesh 是一个 reuse-first 的 AI 测试工程工作台。当前已完成 P01–P03，以及 P04 的 Playwright、Android Emulator + Appium 和 k6 子阶段。

## P01 能力

- Refine + Ant Design 中文工作台。
- AI Chat 文本、图片和文件上传。
- Chat Attachment 与 Project Knowledge 分区。
- 服务端直接调用 OpenAI Responses API。
- 结构化需求、风险、待确认问题与证据。
- 无法可靠定位页/段时显式标记，不生成无证据的替代结果。

## P02 能力

- SQLite 持久化 Requirement、Risk、Evidence、TestCase 与 TestRun。
- 导入 OpenAPI 3.x JSON/YAML，一条 operation 生成一条 TestCase 定义。
- TestCase 关联需求与证据。
- 固定通过 `uvx schemathesis@4.24.3` 执行，单 worker、deterministic、zero retry。
- JUnit 失败结果保存 operation、checks、request、response 与 reproduction。
- 最小 Header/Bearer/Basic Auth 输入仅用于本次运行，不持久化。

## P04-C 性能测试

- 固定使用 `D:\TestHome\k6\2.2.0\k6.exe`，宿主 Windows 单进程执行。
- 用户选择 Git 仓库与一个本地 `.js` k6 脚本，每次运行前明确授权。
- VU、时长、scenario 和 threshold 由脚本定义，TestMesh 不修改脚本。
- `--summary-export` JSON 是唯一结构化结果源；保存 summary 与终端输出 Evidence。
- 无 summary 时立即标记运行错误，不从终端输出补建结果。

## 启动

要求 Node.js 22 或更高版本、`uv`，在 Windows 机器环境变量中提供 `OPENAI_API_KEY`，并启用 Windows 系统代理。

```bash
npm install
npm run build
npm start
```

打开 `http://localhost:3000`。启动脚本会确定性读取 Windows 系统代理；代理或密钥缺失时会停止并显示原因，不会绕过或静默降级。

## 验证

```bash
npm run lint
npm test
npm run build
npm start
```

生产启动前设置 `NODE_ENV=production`。P01 固定使用单一模型 `gpt-5.6-luna`，不会自动切换模型或生成 mock 结果。单次输出上限为 40,000 tokens，并关闭隐式提示缓存写入；按 2026-09-01 官方价格及 1.05M 上下文窗口计算，理论 token 费用上限约为 0.476 美元。

## 文件定位说明

- PDF：OpenAI Responses API 同时读取抽取文本与页面图像，可提供页码证据。
- TXT/Markdown/JSON/HTML/XML：服务端先加入稳定段落编号，可提供段落证据。
- 独立图片：证据关联到整张图片。
- DOC/DOCX/RTF/ODT/PPT/PPTX：只提取文本，无法可靠定位页码，且嵌入图片不会进入模型上下文。请优先转成 PDF，或把图片单独上传。

项目规则与阶段边界见 [AGENTS.md](./AGENTS.md) 和 [docs/ROADMAP.md](./docs/ROADMAP.md)。
