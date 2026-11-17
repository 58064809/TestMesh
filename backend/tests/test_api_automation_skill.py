from pathlib import Path


def test_api_automation_skill_matches_runtime_boundaries() -> None:
    skill = Path("backend/testmesh_api/agent_skills/api-automation-yaml/SKILL.md").read_text(encoding="utf-8")
    assert "testmesh-api/v1" in skill
    assert "kind: foreach" in skill
    assert "${product.id}" in skill
    assert "不得从 PRD 猜接口" in skill
    assert "if / elif / else" in skill
    assert "kind: evidence" in skill
