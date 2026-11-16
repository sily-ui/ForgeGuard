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
    bind_main_loop()
    runtime.init_redis()
    if runtime.state_backend == "memory":
        logger.info("Redis 不可用，实例状态降级为单进程内存态（不支持多实例并发扩展）")
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
    allow_origins=["*"],
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

    return {
        "code": 0,
        "message": "ok",
        "data": {
            "status": "ok",
            "mode": quota.get_mode(),
            "model_configured": settings.model_configured,
            "state_backend": runtime.state_backend,
            "simulation": True,
            "insecure_demo_mode": settings.uses_default_passcodes,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)