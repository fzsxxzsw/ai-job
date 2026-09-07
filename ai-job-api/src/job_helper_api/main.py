import asyncio
import hmac
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from httpx import AsyncBaseTransport
from starlette.exceptions import HTTPException

from . import audit, conversation, filtering, prompts, rejections, users
from .automation.routes import register_routes as register_automation_routes
from .config import Settings, load_settings
from .contracts import (
    AskInput,
    AuditInput,
    ConfigInput,
    DebugInput,
    FeedbackInput,
    FilterInput,
    PreferenceInput,
    RejectionInput,
    SnapshotInput,
)
from .database import Database, now_ms
from .errors import ApiError, envelope
from .execution_authority import bump_authority
from .middleware import RequestSizeLimitMiddleware
from .model import PROVIDERS, effective_config, row_config
from .model_routing import ModelRouter
from .notifications import MailTransport, Notifier
from .outcomes.routes import register_routes as register_outcome_routes
from .routing_routes import install_routing_routes
from .security import issue_token, verify_token

ALLOWED_ORIGINS = [
    "https://www.zhipin.com",
    "https://zhipin.com",
    "http://127.0.0.1:5173",
    # The existing Chrome installation uses the canonical local extension directory.
    "chrome-extension://dkogipipnemadnlpchlgpphagpboekmm",
]
log = logging.getLogger("job_helper_api")


def create_app(
    settings: Settings | None = None,
    transport: AsyncBaseTransport | None = None,
    mail_transport: MailTransport | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings or load_settings()
        app.state.db = Database(app.state.settings.database_url)
        app.state.model = ModelRouter(app.state.settings, app.state.db, transport)
        app.state.notifier = Notifier(app.state.settings, mail_transport)
        app.state.pdf_lock = asyncio.Semaphore(1)
        await app.state.db.health()
        try:
            yield
        finally:
            await app.state.notifier.close()
            await app.state.model.http.aclose()
            await app.state.db.close()

    app = FastAPI(title="Job Helper Python API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Job-Helper-Backend", "X-Job-Helper-Build"],
    )
    app.add_middleware(RequestSizeLimitMiddleware)

    @app.middleware("http")
    async def boundaries(request, call_next):
        request.state.request_id = uuid4().hex
        origin = request.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS:
            return JSONResponse(
                envelope(code=403, message="不允许此网页来源", request_id=request.state.request_id),
                status_code=403,
            )
        response = await call_next(request)
        response.headers["X-Job-Helper-Backend"] = "python"
        response.headers["X-Job-Helper-Build"] = app.state.settings.build_id
        return response

    @app.exception_handler(ApiError)
    async def api_error(request, error):
        return JSONResponse(
            envelope(code=error.code, message=error.message, request_id=request.state.request_id),
            status_code=error.http_status,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Do not echo request values, because an invalid field may be a secret.
        return JSONResponse(
            envelope(
                code=422, message="请求参数格式或长度不正确", request_id=request.state.request_id
            ),
            status_code=422,
        )

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse(
            envelope(
                code=error.status_code,
                message="接口不存在或请求方式不支持",
                request_id=request.state.request_id,
            ),
            status_code=error.status_code,
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        log.error(
            "request_failed request_id=%s type=%s", request.state.request_id, type(error).__name__
        )
        return JSONResponse(
            envelope(
                code=500,
                message="服务内部异常，请依据请求编号检查本地日志",
                request_id=request.state.request_id,
            ),
            status_code=500,
        )

    async def require_user(request: Request):
        config, db = request.app.state.settings, request.app.state.db
        token = request.headers.get("Authorization", "")
        uid = verify_token(token, config.signing_key, config.owner_user_id)
        if not await db.health():
            raise ApiError("数据库未就绪", 503)
        if not await db.user(uid):
            raise ApiError("账号已停用", 401)
        return uid

    async def writable(request: Request, uid=Depends(require_user)):
        if request.app.state.settings.read_only:
            raise ApiError("Python 影子验证为只读模式，尚未接管写入", 503)
        return uid

    @app.get("/health/live")
    async def live():
        return {"status": "alive", "implementation": "python"}

    @app.get("/health/ready")
    @app.get("/actuator/health")
    async def health(request: Request):
        ok = await app.state.db.health()
        model_status = "not_configured"
        if ok:
            current_model = await app.state.db.ai_config(app.state.settings.owner_user_id)
            if current_model and current_model.get("status") == 1:
                model_status = (
                    "configured"
                    if current_model.get("test_passed") == 1 and current_model.get("api_key")
                    else "custom_not_verified"
                )
            elif app.state.settings.model_key:
                model_status = "configured"
        return JSONResponse(
            {
                "status": "UP" if ok else "DOWN",
                "implementation": "python",
                "buildId": app.state.settings.build_id,
                "version": app.state.settings.version,
                "readOnly": app.state.settings.read_only,
                "checks": {"database": "ready" if ok else "not_ready", "model": model_status},
            },
            status_code=200 if ok else 503,
        )

    @app.get("/api/deployment/mode")
    async def mode(uid=Depends(require_user)):
        return envelope(
            {
                "personalMode": True,
                "salesEnabled": False,
                "implementation": "python",
                "buildId": app.state.settings.build_id,
                "version": app.state.settings.version,
            }
        )

    @app.post("/api/user/silently/login")
    async def login(request: Request, uniqueId: str = Query(min_length=1, max_length=32)):
        cfg, db = app.state.settings, app.state.db
        if not await db.health():
            raise ApiError("数据库未就绪", 503)
        user = await db.user(cfg.owner_user_id)
        if not user or not hmac.compare_digest(
            str(user["unique_id"] or "").encode(), uniqueId.encode()
        ):
            raise ApiError("该BOSS账号不是本机已绑定的个人账号", 401)
        return envelope(issue_token(user["id"], cfg.signing_key, cfg.session_ttl))

    @app.post("/api/user/userinfo")
    async def info(uid=Depends(require_user)):
        return envelope(await users.user_view(app.state.db, uid))

    @app.post("/api/user/save/preference")
    async def preference(payload: PreferenceInput, uid=Depends(writable)):
        await users.save_preference(app.state.db, uid, payload)
        return envelope()

    @app.post("/api/user/import/resume")
    async def import_resume(
        uniqueId: str = Form(min_length=1, max_length=32),
        resumeId: str = Form(min_length=1, max_length=64),
        file: UploadFile = File(),
        uid=Depends(writable),
    ):
        user = await app.state.db.user(uid)
        if str(user["unique_id"]) != uniqueId:
            raise ApiError("简历账号与登录账号不一致", 403)
        async with app.state.pdf_lock:
            data = await file.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise ApiError("简历不能超过20MB", 413)
            text = await users.parse_pdf(data)
        return envelope(await users.save_resume(app.state.db, uid, text, resumeId))

    @app.post("/api/job/filter/one")
    async def filter_job(payload: FilterInput, uid=Depends(require_user)):
        if app.state.settings.automation_enabled:
            raise ApiError("AUTOMATION_REQUIRED", 409)
        return envelope(
            await filtering.filter_job(
                app.state.db, app.state.model, app.state.settings, uid, payload
            )
        )

    @app.post("/api/job/ai/assistant/generate/greeting")
    async def greeting(uid=Depends(require_user)):
        resume = await app.state.db.resume(uid)
        if not resume:
            raise ApiError("请先导入简历", 422)
        config = effective_config(app.state.settings, await app.state.db.ai_config(uid))
        return envelope(
            await app.state.model.complete(
                config,
                [
                    {"role": "system", "content": prompts.GREETING},
                    {"role": "user", "content": resume["resume_content"][:30000]},
                ],
                task="greeting",
            )
        )

    @app.post("/api/job/seeker/cloned/ask")
    async def ask(payload: AskInput, uid=Depends(writable)):
        if app.state.settings.automation_enabled:
            raise ApiError("AUTOMATION_REQUIRED", 409)
        return envelope(
            await conversation.conversation_reply(
                app.state.db,
                app.state.model,
                app.state.settings,
                uid,
                payload,
                notifier=app.state.notifier,
            )
        )

    @app.post("/api/user/ai/config/debug")
    async def debug(payload: DebugInput, uid=Depends(require_user)):
        return envelope(
            await conversation.debug_reply(
                app.state.db, app.state.model, app.state.settings, uid, payload
            )
        )

    @app.post("/api/job/seeker/cloned/change/session/status")
    async def stop_session(
        jobKey: str = Query(min_length=1, max_length=64), stop: bool = True, uid=Depends(writable)
    ):
        key = "stop:*" if jobKey == "globalJobKey" else "stop:" + jobKey
        # Resume starts an explicit new authorization period. Serialize it with
        # reply persistence; stopping must still interrupt an in-flight model.
        lock_key = "conversation:" + jobKey if not stop and jobKey != "globalJobKey" else key
        async with app.state.db.lock(uid, lock_key):
            async with app.state.db.engine.begin() as c:
                epoch = await bump_authority(app.state.db, c, uid)
                await app.state.db.set_control(c, uid, key, stop)
                if not stop and jobKey != "globalJobKey":
                    await app.state.db.set_control(c, uid, "chat-rounds:" + jobKey, 0)
                    await app.state.db.set_control(c, uid, "graph-round-reset:" + jobKey, epoch)
        return envelope(True)

    @app.post("/api/job/seeker/cloned/change/session/user/stop")
    async def stop_user(uid=Depends(writable)):
        await users.save_preference(app.state.db, uid, PreferenceInput(aiSeatStatus=False))
        return envelope(True)

    @app.post("/api/job/seeker/cloned/change/session/admin/status")
    async def stop_admin(
        jobKey: str = Query(min_length=1, max_length=64), stop: bool = True, uid=Depends(writable)
    ):
        if uid not in app.state.settings.admin_ids:
            raise ApiError("需要管理员权限", 403)
        return await stop_session(jobKey, stop, uid)

    @app.get("/api/user/ai/config/all/provider")
    async def providers(uid=Depends(require_user)):
        return envelope(PROVIDERS)

    @app.get("/api/user/ai/config/provider/{code}")
    async def provider(code: int, uid=Depends(require_user)):
        if not 0 <= code < len(PROVIDERS):
            raise ApiError("模型供应商不存在", 404)
        return envelope(PROVIDERS[code])

    @app.get("/api/user/ai/config/current")
    async def current(uid=Depends(require_user)):
        return envelope(users.config_view(await app.state.db.ai_config(uid)))

    @app.post("/api/user/ai/config/save")
    async def config_save(payload: ConfigInput, uid=Depends(writable)):
        return envelope(await users.save_config(app.state.db, app.state.model, uid, payload))

    @app.post("/api/user/ai/config/temp/save")
    async def config_temp(payload: ConfigInput, uid=Depends(writable)):
        return envelope(
            await users.save_config(app.state.db, app.state.model, uid, payload, temporary=True)
        )

    @app.post("/api/user/ai/config/test")
    async def config_test(payload: ConfigInput, uid=Depends(writable)):
        merged = users.merge_config(await app.state.db.ai_config(uid), payload, uid)
        cfg = row_config(merged)
        result = await app.state.model.complete(
            cfg, [{"role": "user", "content": "你好，请用一句话自我介绍。"}]
        )
        async with app.state.db.lock(uid, "config"):
            async with app.state.db.engine.begin() as c:
                await app.state.db.set_control(c, uid, "model-test:" + cfg.fingerprint(), now_ms())
        return envelope(result)

    @app.post("/api/user/ai/config/disable/{ident}")
    async def config_disable(ident: int, uid=Depends(writable)):
        old = await app.state.db.ai_config(uid)
        if not old or old["id"] != ident:
            raise ApiError("无权修改此配置", 403)
        return envelope(
            await users.save_config(
                app.state.db, app.state.model, uid, ConfigInput(id=ident, status=0)
            )
        )

    @app.post("/api/job/delivery/audit")
    async def delivery(payload: AuditInput, uid=Depends(writable)):
        return envelope(await audit.record_audit(app.state.db, uid, payload))

    @app.post("/api/job/ai/applications/snapshot")
    async def snapshot(payload: SnapshotInput, uid=Depends(writable)):
        return envelope(await audit.save_snapshot(app.state.db, uid, payload))

    @app.post("/api/job/ai/rejections/analyze")
    async def analyze(payload: RejectionInput, uid=Depends(writable)):
        return envelope(
            await rejections.analyze(
                app.state.db, app.state.model, app.state.settings, uid, payload
            )
        )

    @app.post("/api/job/ai/rejections/{ident}/feedback")
    async def feedback(ident: int, payload: FeedbackInput, uid=Depends(writable)):
        return envelope(await rejections.feedback(app.state.db, uid, ident, payload))

    @app.get("/api/job/ai/rejections/summary")
    async def summary(uid=Depends(require_user)):
        return envelope(await rejections.summary(app.state.db, uid))

    @app.get("/api/job/ai/rejections/history")
    async def rejection_history(uid=Depends(require_user)):
        return envelope(await rejections.history(app.state.db, uid))

    @app.get("/api/job/ai/rejections/status")
    async def rejection_status(uid=Depends(require_user)):
        return envelope(
            {
                "ready": app.state.db.ready,
                "implementation": "python",
                "automaticTrigger": False,
                "buildId": app.state.settings.build_id,
                "version": app.state.settings.version,
            }
        )

    @app.get("/api/job/ai/rejections/{ident}")
    async def rejection_report(ident: int, uid=Depends(require_user)):
        return envelope(await rejections.get_report(app.state.db, uid, ident))

    @app.post("/api/product/user/product/list")
    async def products(uid=Depends(require_user)):
        return envelope([])

    @app.get("/api/user/trial/aiSeat/list")
    async def trials(uid=Depends(require_user)):
        return envelope([])

    @app.api_route("/api/pay/{path:path}", methods=["GET", "POST"])
    @app.api_route("/api/user/invites/{path:path}", methods=["GET", "POST"])
    @app.api_route("/api/sse/connect", methods=["GET"])
    async def sales_disabled(path: str = ""):
        raise ApiError("个人自用模式已关闭售卖、支付和邀请兑换功能", 410)

    register_outcome_routes(app, require_user, writable)
    register_automation_routes(app, require_user, writable)
    install_routing_routes(app, require_user, writable)
    return app


app = create_app()
