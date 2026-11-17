import pytest

from testmesh_api.infrastructure.database.query_runner import validate_read_only_sql


@pytest.mark.parametrize("dialect,sql", [
    ("postgres", "SELECT id FROM orders WHERE id = :order_id"),
    ("postgres", "WITH recent AS (SELECT id FROM orders) SELECT * FROM recent"),
    ("mysql", "SELECT id, status FROM orders WHERE user_id = :user_id"),
])
def test_accepts_single_read_only_query(dialect: str, sql: str) -> None:
    validate_read_only_sql(sql, dialect)


@pytest.mark.parametrize("sql", [
    "UPDATE orders SET status = 'paid'",
    "DELETE FROM orders",
    "SELECT 1; SELECT 2",
    "CREATE TABLE unsafe(id INT)",
])
def test_rejects_write_or_multiple_statements(sql: str) -> None:
    with pytest.raises(ValueError):
        validate_read_only_sql(sql, "postgres")
