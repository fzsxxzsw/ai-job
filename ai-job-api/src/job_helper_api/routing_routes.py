from fastapi import Depends

from .errors import envelope
from .model import effective_config
from .routing_contracts import QuotaImport, RouteTest, RoutingInput


def install_routing_routes(app, require_user, writable):
    async def config(uid):
        return effective_config(app.state.settings, await app.state.db.ai_config(uid))

    @app.get("/api/user/ai/routing")
    async def routing_view(uid=Depends(require_user)):
        return envelope(await app.state.model.view(await config(uid)))

    @app.post("/api/user/ai/routing")
    async def routing_save(payload: RoutingInput, uid=Depends(writable)):
        return envelope(await app.state.model.save(await config(uid), payload))

    @app.post("/api/user/ai/routing/quotas")
    async def routing_import(payload: QuotaImport, uid=Depends(writable)):
        return envelope(await app.state.model.import_quota(await config(uid), payload))

    @app.post("/api/user/ai/routing/discover")
    async def routing_discover(uid=Depends(writable)):
        return envelope(await app.state.model.discover(await config(uid)))

    @app.post("/api/user/ai/routing/test")
    async def routing_test(payload: RouteTest, uid=Depends(writable)):
        return envelope(await app.state.model.test_model(await config(uid), payload.id))
