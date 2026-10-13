import { createServer } from "node:http";

const port = Number(process.env.UI_DEMO_PORT ?? 3022);
const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>售后退货受控演示</title>
<style>body{font-family:sans-serif;max-width:720px;margin:48px auto;padding:0 20px}label{display:block;margin:14px 0 6px}input,select,button{font:inherit;padding:8px;width:100%;box-sizing:border-box}button{margin-top:20px;background:#1677ff;color:#fff;border:0}#result{margin-top:20px;padding:12px;background:#f5f5f5}</style></head>
<body><h1>申请退货</h1><form id="form"><label for="order">订单号</label><input id="order" name="order"><label for="reason">退货原因</label><select id="reason" name="reason"><option value="">请选择</option><option value="damaged">商品损坏</option><option value="wrong">发错商品</option></select><button type="submit">提交申请</button></form><div id="result" role="status">等待提交</div>
<script>document.querySelector('#form').addEventListener('submit',event=>{event.preventDefault();const order=document.querySelector('#order').value.trim();const reason=document.querySelector('#reason').value;document.querySelector('#result').textContent=order&&reason?'申请已提交，等待人工审核':'请填写订单号并选择退货原因';});</script></body></html>`;

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Controlled UI target: http://127.0.0.1:${port}\n`);
});
