# P04-D：Windows Defender 检测复核材料

- **状态**：`BLOCKED`；Microsoft 表单已预填、ZAP 官方讨论稿已准备，尚未完成外部提交。
- **记录时间**：2026-09-03（Asia/Shanghai）。
- **边界**：被拦截的 ZIP 未恢复、未解压、未执行；未添加 Defender 排除项，未关闭或绕过 Defender；未更换下载源、ZAP 版本或运行方式。

## 样本与检测信息

- 官方下载 URL：`https://github.com/zaproxy/zaproxy/releases/download/v2.17.0/ZAP_2.17.0_Crossplatform.zip`
- 官方发布页：`https://www.zaproxy.org/docs/desktop/releases/2.17.0/`
- 文件名：`ZAP_2.17.0_Crossplatform.zip`
- 完整大小：`286,652,857 bytes`
- 阶段批准的预期 SHA-256：`94c8f767b1c2e94f0db66b3ae56514d5e3f5a728ee1b6c798e0c8fe2d61fbff0`
- 本地 SHA-256：未完成。Defender 在读取文件、完成哈希计算之前拦截访问，因此不得声称本地文件已匹配预期哈希。
- 下载及首次检测时间：`2026-09-03 15:22 CST (UTC+8)`
- Defender 检测名：`Program:Java/Multiverze!rfn`
- Threat ID：`453479`
- 严重性：高
- Defender 引擎版本：`1.1.26070.7`
- 安全情报版本：`1.457.447.0`
- 安全情报更新时间：`2026-09-02 00:05:59 UTC+8`

## Microsoft Security Intelligence URL 提交稿

Microsoft 标准文件提交表单的大小上限不足以接收此 `286,652,857 bytes` ZIP，因此使用官方“Submit a file download url for analysis”渠道提交官方下载 URL；不上传、不读取本地被拦截文件。

```text
Potential false positive affecting the official OWASP ZAP 2.17.0 cross-platform release.

Official download URL:
https://github.com/zaproxy/zaproxy/releases/download/v2.17.0/ZAP_2.17.0_Crossplatform.zip

File: ZAP_2.17.0_Crossplatform.zip
Published size: 286,652,857 bytes
Expected SHA-256 (not locally verified because Defender blocked file access): 94c8f767b1c2e94f0db66b3ae56514d5e3f5a728ee1b6c798e0c8fe2d61fbff0
Download/detection time: 2026-09-03 15:22 China Standard Time (UTC+8)
Official release page: https://www.zaproxy.org/docs/desktop/releases/2.17.0/

Microsoft Defender Antivirus detection:
Program:Java/Multiverze!rfn
Threat ID: 453479
Severity: High
Engine: 1.1.26070.7
Security intelligence: 1.457.447.0
Definitions updated: 2026-09-02 00:05:59 UTC+8

Defender blocked access before the local SHA-256 could be completed. The archive was not restored, extracted, or executed. No exclusion or security bypass was attempted.

Please analyze the file served by the official download URL and confirm whether this detection is correct or a false positive. This blocks a pinned OWASP ZAP 2.17.0 integration.
```

## ZAP 官方 Developer Group 发帖稿

主题：

```text
Windows Defender flags official ZAP 2.17.0 Crossplatform ZIP as Program:Java/Multiverze!rfn
```

正文：

```text
Hello ZAP maintainers,

Microsoft Defender Antivirus flags the official ZAP 2.17.0 cross-platform package at:
https://github.com/zaproxy/zaproxy/releases/download/v2.17.0/ZAP_2.17.0_Crossplatform.zip

Observed details:
- File: ZAP_2.17.0_Crossplatform.zip
- Size: 286,652,857 bytes
- Expected SHA-256 (not locally verified): 94c8f767b1c2e94f0db66b3ae56514d5e3f5a728ee1b6c798e0c8fe2d61fbff0
- Download/detection time: 2026-09-03 15:22 CST (UTC+8)
- Detection: Program:Java/Multiverze!rfn
- Threat ID: 453479
- Severity: High
- Defender engine: 1.1.26070.7
- Security intelligence: 1.457.447.0

Defender blocked access before the local SHA-256 could be completed. The archive was not restored, extracted, or executed, and no Defender exclusion or bypass was attempted.

Microsoft's standard file submission form has a 50 MB limit, so I prepared the official download URL for submission through Microsoft's URL-analysis form.

Could you please confirm:
1. Whether the exact official package and expected SHA-256 above are valid for the 2.17.0 release.
2. Whether this Defender detection is known or reproducible.
3. Whether the project can provide a credible false-positive statement or submit the exact release artifact to Microsoft for analysis.

The integration remains blocked pending Microsoft or ZAP confirmation.

Thank you.
```

## 恢复开发条件

P04-D 继续保持 `BLOCKED`。只有满足以下任一条件并经用户确认后，才恢复原固定路径：

1. Microsoft 明确判定误报，或更新 Defender 安全情报后不再拦截；
2. ZAP 官方确认该具体发行包及预期哈希，并给出可信的 Defender 误报说明。

在此之前不得更换下载源、ZAP 版本或执行方式，不得添加 Defender 排除项、恢复文件、关闭 Defender、改用 Docker，也不得进入 P05。
