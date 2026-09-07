import sqlite3
from pathlib import Path

from _mysql_scripts import split_mysql_script


def test_sql_loader_preserves_quoted_semicolons_and_escaped_quotes():
    source = """
    -- A header; must not become an executable statement.
    CREATE TABLE example ("quoted;identifier" TEXT);
    INSERT INTO example VALUES ('literal;semicolon'); /* comment; */
    INSERT INTO example VALUES ('it''s still; one value');
    # MySQL-style trailing comment; ignored.
    """
    statements = split_mysql_script(source)
    assert len(statements) == 3
    with sqlite3.connect(":memory:") as connection:
        for statement in statements:
            connection.execute(statement)
        assert connection.execute("SELECT * FROM example").fetchall() == [
            ("literal;semicolon",),
            ("it's still; one value",),
        ]


def test_entire_standalone_mysql_schema_yields_nine_complete_table_statements():
    source = (Path(__file__).parents[1] / "schema.sql").read_text(encoding="utf-8-sig")
    statements = split_mysql_script(source)
    assert len(statements) == 9
    assert all(
        statement.lstrip().upper().startswith("CREATE TABLE IF NOT EXISTS")
        for statement in statements
    )
    user_info = next(
        statement for statement in statements if "CREATE TABLE IF NOT EXISTS user_info" in statement
    )
    assert "'平台唯一id;boss平台id'" in user_info


def test_comment_only_mysql_script_contains_no_queries():
    assert split_mysql_script("-- empty;\n/* also; empty */\n# final;") == []
