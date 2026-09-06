import asyncio
from contextlib import asynccontextmanager
import json
import sqlite3
import time
from uuid import uuid4
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import MetaData, Table, Column, Integer, Text, Boolean, DateTime
from sqlalchemy.ext.asyncio import create_async_engine
from job_helper_agent.rejection.config import RejectionConfig
from job_helper_agent.rejection.contracts import RejectionError
from job_helper_agent.rejection.security import sign, verify, PREFIX
from job_helper_agent.rejection.store import RejectionStore
from job_helper_agent.rejection.model import RejectionModel
from job_helper_agent.rejection.service import RejectionService
from job_helper_agent.rejection.routes import router
from job_helper_agent.rejection.migration import business_metadata, migrate
from job_helper_agent.rejection.rules import analyze_rules, validate_ai

SECRET = 'test-only-gateway-secret-' * 2
ANALYSIS = dict(encryptJobId='JobCase', conversationKey='peer-job-1', completeness='POSSIBLY_INCOMPLETE',
                messages=[dict(role='HR',text='这个岗位已经招满了')])


def headers(method, path, body=b'', uid=3, now=None, nonce=None):
    timestamp = str(int(time.time()) if now is None else now)
    nonce = nonce or uuid4().hex
    return {'Content-Type':'application/json','X-JH-User':str(uid),'X-JH-Timestamp':timestamp,
            'X-JH-Nonce':nonce, 'X-JH-Signature':sign(SECRET,method,path,str(uid),timestamp,nonce,body)}


def request(client, path, payload=None, uid=3):
    method = 'POST' if payload is not None else 'GET'
    body = json.dumps(payload,ensure_ascii=False).encode() if payload is not None else b''
    path = PREFIX + path
    return client.request(method,path,content=body,headers=headers(method,path,body,uid))


@pytest.fixture
def world(tmp_path):
    path = tmp_path/'rejection.sqlite'
    url = 'sqlite+aiosqlite:///' + path.as_posix()
    async def initialize():
        engine = create_async_engine(url)
        m = MetaData()
        users = Table('user_info',m,Column('id',Integer,primary_key=True),Column('is_active',Boolean),Column('preference',Text))
        resumes = Table('user_resume',m,Column('id',Integer,primary_key=True),Column('user_id',Integer),
            Column('resume_content',Text),Column('is_active',Boolean),Column('updated_date',DateTime))
        Table('user_ai_config',m,Column('id',Integer,primary_key=True),Column('user_id',Integer),
              Column('is_active',Boolean),Column('status',Integer),Column('test_passed',Integer),
              Column('provider',Integer),Column('base_url',Text),Column('model_name',Text),
              Column('api_key',Text),Column('completions_path',Text))
        async with engine.begin() as conn:
            await conn.run_sync(m.create_all)
            await conn.run_sync(business_metadata().create_all)
            await conn.execute(users.insert(),[dict(id=3,is_active=True,preference='{}'),dict(id=9,is_active=True,preference='{}')])
            await conn.execute(resumes.insert(),[dict(id=1,user_id=3,resume_content='旧简历：2年开发经验，Python',is_active=True),
                                                 dict(id=2,user_id=9,resume_content='另一个用户的私密简历',is_active=True)])
        await engine.dispose()
    asyncio.run(initialize())
    world = dict(path=path,url=url,calls=[],output='{"findings":[]}',status=200,exception=None)
    def model(request):
        world['calls'].append(json.loads(request.content))
        if world['exception']: raise world['exception']
        return httpx.Response(world['status'],json={'choices':[{'message':{'content':world['output']}}]})
    @asynccontextmanager
    async def lifespan(app):
        engine = create_async_engine(url)
        store = RejectionStore(engine)
        await store.open()
        config = RejectionConfig(enabled=True,secret=SECRET,model_key='fixture-key',build_id='test-gateway')
        client = RejectionModel(config,httpx.MockTransport(model))
        app.state.rejection_config, app.state.rejection_service = config, RejectionService(store,client)
        try: yield
        finally:
            await client.client.aclose()
            await engine.dispose()
    def application():
        app = FastAPI(lifespan=lifespan)
        app.include_router(router)
        return app
    world['app'] = application
    return world


@pytest.fixture
def client(world):
    with TestClient(world['app']()) as client: yield client


def test_cross_language_signature_vector():
    body = '{"message":"岗位"}'.encode()
    assert sign(SECRET,'POST',PREFIX+'/analyze','3','1712345678','0'*32,body) == 'fe4eb765aaa7e86b3d1b0f160945e5c52298f207b1da8430f9c5961320143082'


@pytest.mark.parametrize('field,value',[('x-jh-user','9'),('x-jh-nonce','1'*32),('x-jh-timestamp','1700000000'),('x-jh-signature','0'*64)])
def test_tampered_identity_rejected(field,value):
    path = PREFIX+'/analyze'
    h = {k.lower():v for k,v in headers('POST',path,b'{}').items()}
    h[field] = value
    with pytest.raises(RejectionError): verify(SECRET,'POST',path,h,b'{}')


def test_browser_headers_and_unsigned_calls_are_not_identity(client):
    assert client.get(PREFIX+'/summary',headers={'X-JH-User':'3'}).status_code == 401
    assert client.get(PREFIX+'/summary',headers={'X-Internal-Token':SECRET}).status_code == 401
    h = headers('GET',PREFIX+'/summary'); h['Origin']='https://www.zhipin.com'
    assert client.get(PREFIX+'/summary',headers=h).status_code == 403
    assert client.get(PREFIX+'/summary?userId=3',headers=headers('GET',PREFIX+'/summary')).status_code == 403


def test_body_user_identity_is_rejected(client):
    assert request(client,'/analyze',dict(ANALYSIS,userId=9)).status_code == 422


def test_signed_payload_cannot_be_changed(client):
    path = PREFIX+'/analyze'
    h = headers('POST',path,b'{}')
    assert client.post(path,content=b'{"userId":9}',headers=h).status_code == 401


def test_nonce_replay_survives_restart(world):
    path = PREFIX+'/summary'; h = headers('GET',path)
    with TestClient(world['app']()) as first:
        assert first.get(path,headers=h).status_code == 200
    with TestClient(world['app']()) as second:
        assert second.get(path,headers=h).status_code == 409


def test_dialogue_only_analysis_persists_without_fake_snapshot(client,world):
    response = request(client,'/analyze',ANALYSIS)
    assert response.status_code == 200, response.text
    report = response.json()['data']
    assert report['applicationSnapshotId'] is None
    assert report['explicitReasons'][0]['code']=='POSITION_CLOSED'
    assert report['inferredRisks']==[]
    with sqlite3.connect(world['path']) as conn:
        assert conn.execute('SELECT COUNT(*) FROM job_application_snapshot').fetchone()[0]==0
        assert conn.execute('SELECT COUNT(*) FROM user_resume').fetchone()[0]==2


def test_same_analysis_is_saved_once_and_does_not_call_model_again(client,world):
    first = request(client,'/analyze',ANALYSIS).json()['data']
    second = request(client,'/analyze',ANALYSIS).json()['data']
    assert first['id']==second['id'] and len(world['calls'])==1


def test_reports_feedback_history_and_summary_are_owner_scoped(client):
    report = request(client,'/analyze',ANALYSIS).json()['data']
    ident = report['id']
    assert request(client,f'/reports/{ident}',uid=9).status_code==404
    assert request(client,f'/reports/{ident}/feedback',{'action':'CONFIRM'},uid=9).status_code==404
    assert request(client,'/history',uid=9).json()['data']==[]
    assert request(client,'/summary',uid=9).json()['data']['totalConfirmed']==0
    assert request(client,f'/reports/{ident}/feedback',{'action':'CONFIRM'}).json()['data']['status']=='CONFIRMED'
    assert request(client,'/summary').json()['data']==dict(visible=False,totalConfirmed=1,categoryCounts={})


def test_snapshot_evidence_uses_old_resume_and_complete_job_description(client,world):
    payload = dict(encryptJobId='JobCase',appliedAt=int(time.time()*1000),jobBaseInfo='Python岗位',
                   jobExtInfo='要求8年相关经验，必须具备物流行业经验',preMatchResult=None)
    first = request(client,'/snapshot',payload)
    assert first.status_code==200,first.text
    with sqlite3.connect(world['path']) as conn:
        conn.execute("UPDATE user_resume SET resume_content='新简历' WHERE user_id=3")
    again = request(client,'/snapshot',dict(payload,jobExtInfo='changed')).json()['data']
    assert again['id']==first.json()['data']['id'] and again['jdHash']==first.json()['data']['jdHash']
    result = request(client,'/analyze',ANALYSIS).json()['data']
    evidence = {e['id']:e['text'] for e in result['evidence']}
    assert '旧简历' in evidence['R1'] and evidence['J2']==payload['jobExtInfo']
    prompt = world['calls'][-1]['messages'][-1]['content']
    assert '旧简历' in prompt and '物流行业经验' in prompt


def test_no_backfill_of_fabricated_historical_resume(client):
    payload = dict(encryptJobId='old',appliedAt=1700000000000,jobBaseInfo='{}',jobExtInfo='{}')
    assert request(client,'/snapshot',payload).status_code==422


@pytest.mark.parametrize('upstream_status',[401,429,500])
def test_model_errors_have_explicit_rule_fallback(client,world,upstream_status):
    world['status']=upstream_status
    result = request(client,'/analyze',ANALYSIS)
    assert result.status_code==200
    assert result.json()['data']['analysisSource']=='RULES_ONLY'
    assert any('规则分析' in s for s in result.json()['data']['unknowns'])
    assert 'fixture-key' not in result.text


def test_timeout_does_not_become_fake_ai_success(client,world):
    world['exception']=httpx.ReadTimeout('fixture error')
    result=request(client,'/analyze',ANALYSIS).json()['data']
    assert result['analysisSource']=='RULES_ONLY'


@pytest.mark.parametrize('text',['不太合适','不是学历不符','如果学历不符再讨论'])
def test_no_invented_education_reason(text):
    result=analyze_rules([dict(id='D1',source='HR_DIALOGUE',text=text)])
    assert not result['explicitReasons']


def test_forged_or_wrong_source_model_evidence_rejected():
    evidence=[dict(id='D1',source='USER_DIALOGUE',text='岗位已经招满')]
    answer=json.dumps({'findings':[dict(code='POSITION_CLOSED',label='关闭',classification='EXPLICIT',reason='已招满',evidenceIds=['D1'])]})
    assert validate_ai(answer,evidence) is False
    assert validate_ai(answer.replace('D1','D99'),evidence) is False


def test_rule_validated_model_analysis_is_marked(client,world):
    world['output']=json.dumps({'findings':[dict(code='POSITION_CLOSED',label='关闭',classification='EXPLICIT',reason='岗位已招满',evidenceIds=['D1'])]})
    assert request(client,'/analyze',ANALYSIS).json()['data']['analysisSource']=='RULES_AI'


def test_deidentified_evidence_before_model_and_response(client,world):
    payload=dict(ANALYSIS,messages=[dict(role='HR',text='岗位招满，联系test@example.com或13800138000')])
    response=request(client,'/analyze',payload)
    assert 'test@example.com' not in response.text and '13800138000' not in response.text
    assert 'test@example.com' not in json.dumps(world['calls'])


def test_only_signed_internal_status_can_report_python_build(client):
    result=request(client,'/status').json()['data']
    assert result==dict(ready=True,implementation='python',buildId='test-gateway',automaticTrigger=False)


def test_job_credentials_are_removed_from_model_evidence(client,world):
    job = dict(jobName='Python岗位',securityId='private-routing-credential',encryptBossId='private-boss-id',
               details={'apiKey':'private-model-key','description':'岗位要求5年经验'})
    snapshot = dict(encryptJobId='JobCase',appliedAt=int(time.time()*1000),
                    jobBaseInfo=json.dumps(job),jobExtInfo='要求Python开发',preMatchResult=None)
    assert request(client,'/snapshot',snapshot).status_code==200
    response=request(client,'/analyze',ANALYSIS)
    serialized=json.dumps(world['calls'],ensure_ascii=False)+response.text
    assert response.status_code==200
    assert 'private-routing-credential' not in serialized
    assert 'private-boss-id' not in serialized
    assert 'private-model-key' not in serialized
    assert 'Python岗位' in serialized


def test_structured_job_identifiers_and_keys_are_removed_before_model():
    from job_helper_agent.rejection.rules import redact
    raw = json.dumps({'jobName':'Python岗位','securityId':'private-security-value',
                      'encryptJobId':'private-job-id','apiKey':'private-credential'})
    clean = redact(raw)
    assert 'Python岗位' in clean
    assert 'private-' not in clean


def test_default_application_keeps_rejection_disabled_without_breaking_graph():
    from job_helper_agent.main import create_app
    with TestClient(create_app()) as client:
        assert client.get('/health/ready').status_code == 200
        assert client.get(PREFIX+'/status').status_code == 503
