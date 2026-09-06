"""Run only against an explicitly configured disposable CI/test MySQL database."""
import asyncio
from contextlib import asynccontextmanager
import os
import time
from uuid import uuid4
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import MetaData, Table, Column, BigInteger, Text, Boolean, DateTime, Integer, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from job_helper_agent.rejection.config import RejectionConfig
from job_helper_agent.rejection.store import RejectionStore
from job_helper_agent.rejection.model import RejectionModel
from job_helper_agent.rejection.service import RejectionService
from job_helper_agent.rejection.routes import router
from job_helper_agent.rejection.migration import business_metadata, migrate
from test_rejection import request, SECRET, ANALYSIS

DB_URL = os.getenv('AGENT_TEST_DATABASE_URL')


@pytest.mark.skipif(not DB_URL, reason='Disposable AGENT_TEST_DATABASE_URL is not configured')
def test_mysql_compatibility_migration_and_manual_business_flow():
    database = make_url(DB_URL).database or ''
    assert database.endswith(('_ci','_test')), 'Refusing tests against a non-test database'
    uid = 1_000_000 + uuid4().int % 100_000_000
    async def prepare():
        engine = create_async_engine(DB_URL)
        m = MetaData()
        u = Table('user_info',m,Column('id',BigInteger,primary_key=True),Column('is_active',Boolean),Column('preference',Text))
        r = Table('user_resume',m,Column('id',BigInteger,primary_key=True),Column('user_id',BigInteger),
                  Column('resume_content',Text),Column('is_active',Boolean),Column('updated_date',DateTime))
        Table('user_ai_config',m,Column('id',BigInteger,primary_key=True),Column('user_id',BigInteger),
              Column('is_active',Boolean),Column('status',Integer),Column('test_passed',Integer),
              Column('provider',Integer),Column('base_url',Text),Column('model_name',Text),
              Column('api_key',Text),Column('completions_path',Text))
        legacy = business_metadata()
        legacy.tables['rejection_analysis'].c.application_snapshot_id.nullable = False
        async with engine.begin() as c:
            existed = await c.run_sync(lambda x: inspect(x).has_table('rejection_analysis'))
            await c.run_sync(m.create_all)
            await c.run_sync(legacy.create_all)
            await c.execute(u.insert(),[dict(id=uid,is_active=True,preference='{}'),dict(id=uid+1,is_active=True,preference='{}')])
            await c.execute(r.insert(),[dict(id=uid,user_id=uid,resume_content='2年Python开发经验',is_active=True)])
        plan = await migrate(engine,apply=False)
        if not existed:
            assert plan == [] or any('nullable' in item for item in plan)
        await migrate(engine,apply=True)
        assert await migrate(engine,apply=False)==[]
        async with engine.connect() as c:
            columns=await c.run_sync(lambda x: inspect(x).get_columns('rejection_analysis'))
            assert next(x for x in columns if x['name']=='application_snapshot_id')['nullable']
        await engine.dispose()
    asyncio.run(prepare())
    calls=[]
    def model(req):
        calls.append(req)
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"findings":[]}'}}]})
    @asynccontextmanager
    async def lifespan(app):
        engine=create_async_engine(DB_URL)
        store=RejectionStore(engine); await store.open()
        config=RejectionConfig(enabled=True,secret=SECRET,model_key='fixture-model-key')
        client=RejectionModel(config,httpx.MockTransport(model))
        app.state.rejection_config=config
        app.state.rejection_service=RejectionService(store,client)
        try: yield
        finally:
            await client.client.aclose(); await engine.dispose()
    def make_app():
        app=FastAPI(lifespan=lifespan); app.include_router(router); return app
    with TestClient(make_app()) as client:
        # Multibyte job text exceeds MySQL TEXT: fresh schema must preserve LONGTEXT support.
        snapshot=dict(encryptJobId='Job'+str(uid),appliedAt=int(time.time()*1000),
                      jobBaseInfo='测试岗位',jobExtInfo='岗位描述'*6000,preMatchResult=None)
        result=request(client,'/snapshot',snapshot,uid=uid)
        assert result.status_code==200,result.text
        lower=request(client,'/snapshot',dict(snapshot,encryptJobId=snapshot['encryptJobId'].lower()),uid=uid)
        assert lower.status_code==200 and lower.json()['data']['id']!=result.json()['data']['id']
        payload=dict(ANALYSIS,encryptJobId=snapshot['encryptJobId'])
        first=request(client,'/analyze',payload,uid=uid)
        assert first.status_code==200,first.text
        report=first.json()['data']
        again=request(client,'/analyze',payload,uid=uid).json()['data']
        assert again['id']==report['id'] and len(calls)==1
        assert request(client,f"/reports/{report['id']}",uid=uid+1).status_code==404
        assert request(client,f"/reports/{report['id']}/feedback",{'action':'CONFIRM'},uid=uid).status_code==200
        absent=request(client,'/analyze',dict(ANALYSIS,encryptJobId='history-only-'+str(uid)),uid=uid)
        assert absent.status_code==200 and absent.json()['data']['applicationSnapshotId'] is None
    with TestClient(make_app()) as restarted:
        read=request(restarted,f"/reports/{report['id']}",uid=uid)
        assert read.status_code==200 and read.json()['data']['status']=='CONFIRMED'
