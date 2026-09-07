"""Load checked-in MySQL DDL without splitting quoted or commented semicolons."""

import sqlparse


def split_mysql_script(source: str) -> list[str]:
    # sqlparse tokenizes SQL strings/quoted identifiers before removing comments;
    # COMMENT 'platform;boss' and escaped quote literals therefore remain intact.
    uncommented = sqlparse.format(source, strip_comments=True)
    return [statement for statement in sqlparse.split(uncommented) if statement.strip().strip(";")]
