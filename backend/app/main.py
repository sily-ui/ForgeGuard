"""ForgeGuard 后端入口：面向可编排 Agent 的自适应红队测评与动态旁路监护平台。

全部工具调用为内存仿真，不触达真实系统；模型接口仅使用 MODEL_BASE_URL 配置地址。
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.openapi import custom_openapi
from .api.v1 import (
    admin,
    auth,
    configs,
    experiments,
    instances,
    reports,
    samples,
    sessions,
    templates,
)
from .core.config import settings
from .core.errors import ApiError
from .core.security import GENERAL_LIMIT, rate_limiter
from .core.state import runtime
from .internal.events import bind_main_loop
from .models.db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("forgeguard")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from .models import db as dbmod
    from .orchestration.suggestions import prune_cache

    with dbmod.session_scope() as db:
        pruned = prune_cache(db)
    if pruned:
        logger.info("启动收口：清理孤儿推荐缓存 %d 行", pruned)
    bind_main_loop()
    runtime.init_redis()
    rate_limiter.bind_redis(runtime._redis)
    if not runtime.redis_reachable:
        logger.info("Redis 不可用，限流回退进程内存；多副本部署需配置 REDIS_URL 以共享限流计数")
    else:
        logger.info("Redis 可达，限流计数已跨副本共享")
    from .models.db import get_engine

    dialect = get_engine().dialect.name
    if dialect == "sqlite":
        logger.info("存储为本地 SQLite（单进程）；多副本部署请置 DATABASE_URL 为共享 PostgreSQL")
    else:
        logger.info("存储为共享 %s；运行态（质询/任务/事件）仍为进程内存，多副本须按会话亲和路由", dialect)
    if not settings.model_configured:
        logger.info("未配置 MODEL_* 环境变量，使用离线仿真推理（可随时配置真实模型接口）")
    logger.info("ForgeGuard 后端就绪，监听 %s:%s", settings.host, settings.port)
    yield


app = FastAPI(
    title="ForgeGuard API",
    description="面向可编排 Agent 的自适应红队测评与动态旁路监护平台（全仿真）",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_headers(request: Request, call_next):
    response = await call_next(request)
    ip = request.client.host if request.client else "unknown"
    remaining, reset = rate_limiter.remaining(f"ip:{ip}", GENERAL_LIMIT)
    response.headers["X-RateLimit-Limit"] = str(GENERAL_LIMIT)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Reset"] = str(reset)
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    # 仅约束 framing/base-uri/form-action，不限制脚本样式资源，避免破坏 Swagger UI。
    response.headers.setdefault(
        "Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


for module in (auth, templates, configs, instances, sessions, samples, experiments, reports, admin):
    app.include_router(module.router, prefix="/api/v1")
app.include_router(reports.public_router)

app.openapi = lambda: custom_openapi(app)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.http_status, content=exc.to_body(), headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    field_errors = [
        {"field": ".".join(str(loc) for loc in err.get("loc", [])), "error": err.get("msg", "")}
        for err in exc.errors()
    ]
    body = {
        "code": 40000,
        "message": "参数校验失败",
        "data": None,
        "detail": "请求参数不符合接口契约",
        "field_errors": field_errors,
    }
    return JSONResponse(status_code=400, content=body)


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    logger.exception("未归类异常：%s %s", request.method, request.url.path)
    body = {"code": 50000, "message": "内部错误", "data": None, "detail": "服务内部异常，请重试或联系管理员"}
    return JSONResponse(status_code=500, content=body)


@app.get("/api/v1/health")
def health():
    from .core import quota
    from .models.db import get_engine

    return {
        "code": 0,
        "message": "ok",
        "data": {
            "status": "ok",
            "mode": quota.get_mode(),
            "model_configured": settings.model_configured,
            "state_backend": runtime.state_backend,
            "db_backend": get_engine().dialect.name,
            "rate_limit_backend": "redis" if runtime.redis_reachable else "memory",
            "simulation": True,
            "guest_daily_quota": settings.quota_guest_daily,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)