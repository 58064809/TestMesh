import httpx
import pytest

from testmesh_api.infrastructure.tracing.skywalking import SkyWalkingTraceReader


@pytest.mark.asyncio
async def test_reads_trace_by_id_from_skywalking_v2_api() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v2/traces/trace-12345678"
        return httpx.Response(200, json={"resourceSpans": [{"scopeSpans": [{"spans": [{"name": "tool.call"}]}]}]})

    async with SkyWalkingTraceReader("http://skywalking.test", transport=httpx.MockTransport(handler)) as reader:
        trace = await reader.get_trace("trace-12345678")
    assert trace["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["name"] == "tool.call"
