import asyncio
from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from job_helper_agent.database import Base
from sqlalchemy import URL


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.getenv("AGENT_DATABASE_URL", "")
if not database_url:
    required = ("AGENT_DB_HOST", "AGENT_DB_USER", "AGENT_DB_PASSWORD", "AGENT_DB_NAME")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError("Agent database migration settings are incomplete: " + ", ".join(missing))
    database_url = URL.create(
        "mysql+asyncmy",
        username=os.environ["AGENT_DB_USER"],
        password=os.environ["AGENT_DB_PASSWORD"],
        host=os.environ["AGENT_DB_HOST"],
        port=int(os.getenv("AGENT_DB_PORT", "3306")),
        database=os.environ["AGENT_DB_NAME"],
        query={"charset": "utf8mb4"},
    ).render_as_string(hide_password=False)
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table="alembic_version_agent",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table="alembic_version_agent",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
