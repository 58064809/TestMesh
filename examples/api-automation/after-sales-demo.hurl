# TestMesh 本机受控演示；不代表真实业务验收。
# TC-003：退货信息确认后进入审核。
POST {{baseUrl}}/returns
Content-Type: application/json
{
  "orderId": "ORDER-DEMO-001",
  "reason": "not_needed",
  "confirmed": true
}
HTTP 201
[Captures]
return_id: jsonpath "$.id"
[Asserts]
jsonpath "$.orderId" == "ORDER-DEMO-001"
jsonpath "$.status" == "review_pending"

# 捕获首个响应的 ID，继续验证状态查询链路。
GET {{baseUrl}}/returns/{{return_id}}
HTTP 200
[Asserts]
jsonpath "$.id" == "{{return_id}}"
jsonpath "$.status" == "review_pending"

# TC-004：退货信息不完整或未确认时阻止提交。
POST {{baseUrl}}/returns
Content-Type: application/json
{
  "orderId": "ORDER-DEMO-002",
  "reason": "not_needed",
  "confirmed": false
}
HTTP 422
[Asserts]
jsonpath "$.code" == "RETURN_INFO_INCOMPLETE"
