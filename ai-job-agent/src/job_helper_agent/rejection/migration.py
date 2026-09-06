"""Explicit, idempotent compatibility migration. Never invoked during app startup."""
import argparse
import asyncio
from sqlalchemy import (MetaData, Table, Column, BigInteger, Integer, String, Text,
                        UniqueConstraint, inspect, text)
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.dialects.mysql import LONGTEXT, VARCHAR
from job_helper_agent.config import load_config


def business_metadata():
    m = MetaData()
    ident = BigInteger().with_variant(Integer, 'sqlite')
    long_text = Text().with_variant(LONGTEXT(), 'mysql')
    job_id = String(255).with_variant(VARCHAR(255, collation='utf8mb4_bin'), 'mysql')
    Table('job_application_snapshot', m,
        Column('id',ident,primary_key=True,autoincrement=True), Column('user_id',BigInteger,nullable=False),
        Column('encrypt_job_id',job_id,nullable=False), Column('applied_at',BigInteger,nullable=False),
        Column('job_base_info',long_text), Column('job_ext_info',long_text), Column('jd_hash',String(64),nullable=False),
        Column('resume_record_id',BigInteger,nullable=False), Column('resume_content',long_text,nullable=False),
        Column('resume_hash',String(64),nullable=False), Column('preference_snapshot',long_text),
        Column('pre_match_result',long_text), Column('created_at',BigInteger,nullable=False),
        UniqueConstraint('user_id','encrypt_job_id',name='uq_snapshot_user_job'))
    Table('rejection_analysis', m,
        Column('id',ident,primary_key=True,autoincrement=True), Column('user_id',BigInteger,nullable=False),
        Column('application_snapshot_id',BigInteger,nullable=True), Column('encrypt_job_id',job_id,nullable=False),
        Column('conversation_key',String(255)), Column('conversation_completeness',String(32),nullable=False),
        Column('conversation_json',long_text,nullable=False), Column('conversation_hash',String(64),nullable=False),
        Column('analysis_json',long_text,nullable=False), Column('status',String(32),nullable=False),
        Column('analysis_source',String(32),nullable=False), Column('model',String(160),nullable=False),
        Column('prompt_version',String(64),nullable=False), Column('corrected_reason',String(1000)),
        Column('corrected_code',String(80)), Column('created_at',BigInteger,nullable=False),
        Column('updated_at',BigInteger,nullable=False))
    Table('rejection_gateway_nonce', m, Column('nonce',String(32),primary_key=True),
        Column('user_id',BigInteger,nullable=False), Column('issued_at',BigInteger,nullable=False,index=True))
    return m


async def migrate(engine, *, apply=False):
    async with engine.connect() as conn:
        names = await conn.run_sync(lambda c: set(inspect(c).get_table_names()))
        missing = {'user_info','user_resume','user_ai_config'} - names
        if missing: raise RuntimeError('Business user tables missing; refusing migration')
        nullable = True
        if 'rejection_analysis' in names:
            columns = await conn.run_sync(lambda c: inspect(c).get_columns('rejection_analysis'))
            column = next(c for c in columns if c['name']=='application_snapshot_id')
            nullable = column['nullable']
    plan = ['create ' + n for n in business_metadata().tables if n not in names]
    if not nullable: plan.append('make rejection_analysis.application_snapshot_id nullable; keep all rows')
    if not apply: return plan
    async with engine.begin() as conn:
        await conn.run_sync(business_metadata().create_all)
        if not nullable:
            if engine.dialect.name != 'mysql':
                raise RuntimeError('Legacy nullability migration is supported only on MySQL')
            await conn.execute(text('ALTER TABLE rejection_analysis MODIFY COLUMN application_snapshot_id BIGINT NULL'))
    return plan


async def main(apply):
    engine = create_async_engine(load_config().sqlalchemy_url(), echo=False)
    try:
        plan = await migrate(engine, apply=apply)
        print(('APPLIED: ' if apply else 'PLAN ONLY: ') + '; '.join(plan or ['already compatible']))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply after a verified backup; default is plan only')
    args = parser.parse_args()
    asyncio.run(main(args.apply))
