from contextlib import asynccontextmanager
import asyncio
import logging
import re
from uuid import uuid4
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from .config import RejectionConfig
from .contracts import (MAX_BODY_BYTES, MAX_ID, RejectionError, SnapshotInput, AnalysisInput, FeedbackInput)
from .security import verify, PREFIX
from .store import RejectionStore
from .model import RejectionModel
from .service import RejectionService

router = APIRouter(prefix=PREFIX)
log = logging.getLogger('job_helper_agent.rejection')


@asynccontextmanager
async def rejection_runtime(app):
    app.state.rejection_service = None
    try:
        config = getattr(app.state, 'rejection_config_override', None) or RejectionConfig.from_env()
    except ValueError:
        log.error('rejection_configuration_invalid')
        yield
        return
    if not config.enabled or not hasattr(app.state, 'database_engine'):
        yield
        return
    store = RejectionStore(app.state.database_engine)
    model = RejectionModel(config, getattr(app.state, 'rejection_transport', None))
    try:
        app.state.rejection_service = RejectionService(store, model)
        app.state.rejection_config = config
        try:
            await store.open()
        except (SQLAlchemyError, RejectionError, KeyError):
            log.error('rejection_schema_not_ready')
        yield
    finally:
        await model.client.aclose()
        app.state.rejection_service = None


async def dispatch(request):
    service = request.app.state.rejection_service
    if service is None: raise RejectionError(503, '拒绝分析尚未启用或数据库迁移未就绪')
    if request.headers.get('origin') or request.url.query:
        raise RejectionError(403, '内部接口不接受浏览器来源或查询参数')
    parts, size = [], 0
    async for part in request.stream():
        size += len(part)
        if size > MAX_BODY_BYTES: raise RejectionError(413, '请求内容超过限制')
        parts.append(part)
    body = b''.join(parts)
    uid, nonce, issued = verify(request.app.state.rejection_config.secret, request.method,
                                request.url.path, request.headers, body)
    if not service.store.ready:
        await service.store.open()
    await service.store.authorize_once(uid, nonce, issued)
    path = request.url.path[len(PREFIX):]
    if request.method == 'GET':
        if body: raise RejectionError(422, '查询接口不接受请求正文')
        if path == '/summary': return await service.summary(uid)
        if path == '/history': return await service.history(uid)
        if path == '/status': return dict(ready=True, implementation='python',
            buildId=request.app.state.rejection_config.build_id, automaticTrigger=False)
        match = re.fullmatch(r'/reports/([1-9][0-9]{0,15})', path)
        if match and int(match[1]) <= MAX_ID: return await service.get_report(uid,int(match[1]))
    elif request.method == 'POST':
        if request.headers.get('content-type','').split(';')[0].strip().lower() != 'application/json':
            raise RejectionError(415, '只接受JSON请求')
        if path == '/snapshot': return await service.save_snapshot(uid, SnapshotInput.model_validate_json(body))
        if path == '/analyze': return await service.analyze(uid, AnalysisInput.model_validate_json(body))
        match = re.fullmatch(r'/reports/([1-9][0-9]{0,15})/feedback',path)
        if match and int(match[1]) <= MAX_ID:
            return await service.feedback(uid,int(match[1]),FeedbackInput.model_validate_json(body))
    raise RejectionError(404, '不支持的拒绝分析接口')


async def endpoint(request: Request):
    request_id = uuid4().hex
    try:
        async with asyncio.timeout(15):
            result = await dispatch(request)
        return JSONResponse(dict(code=200,message='成功',data=result,requestId=request_id,extend=None))
    except RejectionError as error:
        code, message = error.code, error.message
    except ValidationError:
        code, message = 422, '请求参数格式、长度或字段不正确'
    except TimeoutError:
        code, message = 504, '拒绝分析请求超时，请稍后查看已保存报告，不会触发投递'
    except Exception as error:
        log.error('rejection_request_failed request_id=%s type=%s',request_id,type(error).__name__)
        code, message = 503, '拒绝分析暂不可用，请根据请求编号检查本地日志'
    return JSONResponse(dict(code=code,message=message,data=None,requestId=request_id,extend=None),status_code=code)


for path in ['/snapshot','/analyze','/reports/{ident}/feedback']:
    router.add_api_route(path,endpoint,methods=['POST'])
for path in ['/summary','/history','/status','/reports/{ident}']:
    router.add_api_route(path,endpoint,methods=['GET'])
