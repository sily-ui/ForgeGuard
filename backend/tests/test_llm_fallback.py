"""模型档位降级：主模型额度耗尽或上游故障时自动切换备用模型。

约定与其余用例一致：同步函数内 asyncio.run 驱动协程，不依赖真实网关。
"""

import asyncio
import json
import types

import httpx

from app.core.config import settings
from app.core.errors import ModelUnavailable
from app.internal.llm import proxy

PRIMARY_URL = "https://primary.example/v2"
FALLBACK_URL = "https://fallback.example/v1"
PRIMARY_KEY = "ak-primary-secret"
FALLBACK_KEY = "tp-fallback-secret"


def _configure(monkeypatch, with_fallback=True):
    """把档位配置指向假网关；settings 上的属性是实例值，可安全 monkeypatch。"""
    monkeypatch.setattr(settings, "model_base_url", PRIMARY_URL, raising=False)
    monkeypatch.setattr(settings, "model_api_key", PRIMARY_KEY, raising=False)
    monkeypatch.setattr(settings, "model_name", "spark-x2.6", raising=False)
    monkeypatch.setattr(settings, "guardian_model_name", "spark-x2.6", raising=False)
    fb = (
        (FALLBACK_URL, FALLBACK_KEY, "u2-flash")
        if with_fallback
        else ("", "", "")
    )
    monkeypatch.setattr(settings, "fallback_model_base_url", fb[0], raising=False)
    monkeypatch.setattr(settings, "fallback_model_api_key", fb[1], raising=False)
    monkeypatch.setattr(settings, "fallback_model_name", fb[2], raising=False)
    # 内部限流与配额只记次数，避免单测写库
    spent = []
    monkeypatch.setattr(
        proxy,
        "quota",
        types.SimpleNamespace(
            check_guest_call_rate=lambda: spent.append("rate"),
            consume_model_quota=lambda sid=None: spent.append(sid),
        ),
    )
    return spent


def _ok(text):
    return {
        "payload": {
            "choices": [{"message": {"content": text}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 5},
        }
    }


def _empty_content():
    """推理型模型把 token 预算全花在 reasoning_content 上时的响应形态。"""
    return {
        "payload": {
            "choices": [{"message": {"content": "", "reasoning_content": "思考中..."}}],
            "usage": {"completion_tokens": 32},
        }
    }


def _quota_exhausted():
    return {
        "status": 429,
        "payload": {"error": {"code": "insufficient_quota", "message": "额度不足"}},
    }


def _sse(parts, usage=None):
    lines = ["data: " + json.dumps({"choices": [{"delta": {"content": p}}]}) for p in parts]
    if usage:
        lines.append("data: " + json.dumps({"choices": [], "usage": usage}))
    lines.append("data: [DONE]")
    return {"lines": lines}


def _delta_lines(key, *parts):
    """只含指定 delta 字段的流式脚本，用于模拟只有 reasoning 或首句后即断流。"""
    return {"lines": ["data: " + json.dumps({"choices": [{"delta": {key: p}}]}) for p in parts]}


def _install(monkeypatch, scripts):
    """用脚本化的假 httpx.AsyncClient 替换代理里的 httpx，记录每次出站调用。"""
    calls = []

    def spec_for(url):
        for prefix, spec in scripts.items():
            if url.startswith(prefix):
                return spec
        raise AssertionError(f"未预期的调用地址 {url}")

    class _Response:
        def __init__(self, url, spec):
            self.url = url
            self.status_code = spec.get("status", 200)
            self._payload = spec.get("payload")
            self.text = json.dumps(self._payload or {}, ensure_ascii=False)

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError(
                    "upstream error", request=httpx.Request("POST", self.url), response=self
                )

        def json(self):
            if self._payload is None:
                raise ValueError("响应不是 JSON")
            return self._payload

    class _StreamResponse:
        def __init__(self, url, spec):
            self.url = url
            self.status_code = spec.get("status", 200)
            self._lines = spec.get("lines", [])
            self._fail_after = spec.get("fail_after")
            self._payload = spec.get("payload")
            self._read = False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def aread(self):
            self._read = True
            return b""

        def json(self):
            # 与 httpx 一致：未 aread 的流式响应取 JSON 会抛 ResponseNotRead(RuntimeError)
            if not self._read:
                raise httpx.ResponseNotRead()
            return self._payload or {}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError(
                    "upstream error", request=httpx.Request("POST", self.url), response=self
                )

        async def aiter_lines(self):
            for index, line in enumerate(self._lines):
                yield line
                if self._fail_after is not None and index + 1 >= self._fail_after:
                    raise httpx.ReadError("连接中断")

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            calls.append({"url": url, "body": json, "auth": (headers or {}).get("Authorization")})
            return _Response(url, spec_for(url))

        def stream(self, method, url, json=None, headers=None):
            calls.append({"url": url, "body": json, "auth": (headers or {}).get("Authorization")})
            return _StreamResponse(url, spec_for(url))

    monkeypatch.setattr(
        proxy, "httpx", types.SimpleNamespace(AsyncClient=_Client, HTTPError=httpx.HTTPError)
    )
    return calls


def test_primary_429_switches_to_fallback(monkeypatch):
    """主模型额度耗尽（429 insufficient_quota）时由备用模型应答，并保留档位留痕字段。"""
    _configure(monkeypatch)
    calls = _install(monkeypatch, {PRIMARY_URL: _quota_exhausted(), FALLBACK_URL: _ok("备用模型应答")})

    async def scenario():
        return await proxy.llm_proxy.chat("business", [{"role": "user", "content": "hi"}])

    result = asyncio.run(scenario())
    assert result["content"] == "备用模型应答"
    assert result["simulated"] is False
    assert result["provider"] == "fallback"
    assert result["model"] == "u2-flash"
    assert [c["url"] for c in calls] == [
        f"{PRIMARY_URL}/chat/completions",
        f"{FALLBACK_URL}/chat/completions",
    ]


def test_failover_never_reuses_primary_credentials(monkeypatch):
    """切换档位必须换用备用档位自己的密钥，不能把主模型凭据发往备用网关。"""
    _configure(monkeypatch)
    calls = _install(monkeypatch, {PRIMARY_URL: _quota_exhausted(), FALLBACK_URL: _ok("ok")})

    asyncio.run(proxy.llm_proxy.chat("guardian", [{"role": "user", "content": "hi"}]))
    assert calls[0]["auth"] == f"Bearer {PRIMARY_KEY}"
    assert calls[1]["auth"] == f"Bearer {FALLBACK_KEY}"
    # 监护角色在备用档位统一使用备用模型名
    assert calls[0]["body"]["model"] == "spark-x2.6"
    assert calls[1]["body"]["model"] == "u2-flash"


def test_empty_content_counts_as_failure(monkeypatch):
    """主模型只吐 reasoning 不吐正文时视为失败，继续向后档位重试。"""
    _configure(monkeypatch)
    calls = _install(monkeypatch, {PRIMARY_URL: _empty_content(), FALLBACK_URL: _ok("正文")})

    result = asyncio.run(proxy.llm_proxy.chat("redteam", [{"role": "user", "content": "hi"}]))
    assert result["provider"] == "fallback"
    assert len(calls) == 2


def test_both_tiers_fail_raises_model_unavailable(monkeypatch):
    """两档都不可用时抛 ModelUnavailable，且明细里能看到两档各自的失败原因。"""
    _configure(monkeypatch)
    _install(
        monkeypatch,
        {
            PRIMARY_URL: _quota_exhausted(),
            FALLBACK_URL: {"status": 500, "payload": {"error": {"code": "internal_error"}}},
        },
    )

    async def scenario():
        return await proxy.llm_proxy.chat("business", [{"role": "user", "content": "hi"}])

    try:
        asyncio.run(scenario())
        raise AssertionError("应当抛出 ModelUnavailable")
    except ModelUnavailable as exc:
        assert "primary:spark-x2.6 HTTP 429 code=insufficient_quota" in exc.detail
        assert "fallback:u2-flash HTTP 500 code=internal_error" in exc.detail


def test_failure_detail_never_leaks_credentials(monkeypatch):
    """失败摘要只含状态码与错误码，不携带请求原文，密钥不会进入异常与日志。"""
    _configure(monkeypatch)
    _install(
        monkeypatch,
        {
            PRIMARY_URL: {"status": 401, "payload": {"error": {"code": "invalid_api_key"}}},
            FALLBACK_URL: {"status": 401, "payload": {"error": {"code": "invalid_api_key"}}},
        },
    )

    async def scenario():
        return await proxy.llm_proxy.chat("business", [{"role": "user", "content": "hi"}])

    try:
        asyncio.run(scenario())
        raise AssertionError("应当抛出 ModelUnavailable")
    except ModelUnavailable as exc:
        assert PRIMARY_KEY not in exc.detail
        assert FALLBACK_KEY not in exc.detail


def test_without_fallback_behaviour_unchanged(monkeypatch):
    """未配置备用模型时只打主模型一档，失败即抛错，与接入备用档位前的行为一致。"""
    _configure(monkeypatch, with_fallback=False)
    calls = _install(monkeypatch, {PRIMARY_URL: _quota_exhausted()})

    try:
        asyncio.run(proxy.llm_proxy.chat("business", [{"role": "user", "content": "hi"}]))
        raise AssertionError("应当抛出 ModelUnavailable")
    except ModelUnavailable:
        assert len(calls) == 1
        assert settings.fallback_configured is False


def test_internal_quota_consumed_once_across_failover(monkeypatch):
    """切档属于同一次业务调用：限流计一次、配额只扣一次，避免降级放大消耗。"""
    spent = _configure(monkeypatch)
    _install(monkeypatch, {PRIMARY_URL: _quota_exhausted(), FALLBACK_URL: _ok("ok")})

    asyncio.run(proxy.llm_proxy.chat("business", [{"role": "user", "content": "hi"}], "sess-1"))
    assert spent == ["rate", "sess-1"]


def test_simulated_call_still_rate_limited(monkeypatch):
    """离线仿真不扣配额，但游客模型调用限流照常计数，防止借仿真链路刷接口。"""
    spent = _configure(monkeypatch, with_fallback=False)
    monkeypatch.setattr(settings, "model_base_url", "", raising=False)  # 未接入真实模型

    asyncio.run(proxy.llm_proxy.chat("business", [{"role": "user", "content": "hi"}], "sess-1"))
    assert spent == ["rate"]


def test_stream_failover_before_first_delta(monkeypatch):
    """主模型在建流阶段就失败时，备用模型接管流式输出。"""
    _configure(monkeypatch)
    calls = _install(
        monkeypatch,
        {
            PRIMARY_URL: {"status": 429, "payload": {"error": {"code": "insufficient_quota"}}},
            FALLBACK_URL: _sse(
                ["备用", "流式", "正文"], usage={"prompt_tokens": 3, "completion_tokens": 3}
            ),
        },
    )

    async def scenario():
        deltas, end = [], None
        async for kind, payload in proxy.llm_proxy.chat_stream(
            "business", [{"role": "user", "content": "hi"}]
        ):
            if kind == "delta":
                deltas.append(payload)
            else:
                end = payload
        return deltas, end

    deltas, end = asyncio.run(scenario())
    assert "".join(deltas) == "备用流式正文"
    assert end["provider"] == "fallback"
    assert end["usage"]["completion_tokens"] == 3
    assert len(calls) == 2
    # 备用网关只在显式声明时回传 usage，否则降级后 token 统计会归零
    assert calls[1]["body"]["stream_options"] == {"include_usage": True}


def test_stream_no_retry_after_first_delta(monkeypatch):
    """已经吐出增量后断流不再切档，否则前端会看到重复正文。"""
    _configure(monkeypatch)
    calls = _install(
        monkeypatch,
        {
            PRIMARY_URL: {**_delta_lines("content", "半句"), "fail_after": 1},
            FALLBACK_URL: _sse(["不该出现"]),
        },
    )

    async def scenario():
        deltas = []
        async for kind, payload in proxy.llm_proxy.chat_stream(
            "business", [{"role": "user", "content": "hi"}]
        ):
            if kind == "delta":
                deltas.append(payload)
        return deltas

    try:
        asyncio.run(scenario())
        raise AssertionError("应当抛出 ModelUnavailable")
    except ModelUnavailable as exc:
        assert "流式调用中断" in exc.detail
        assert len(calls) == 1


def test_stream_empty_output_falls_back(monkeypatch):
    """主模型流式全程只有 reasoning、正文为空时切换到备用档位。"""
    _configure(monkeypatch)
    calls = _install(
        monkeypatch,
        {
            PRIMARY_URL: _delta_lines("reasoning_content", "想"),
            FALLBACK_URL: _sse(["正文"]),
        },
    )

    async def scenario():
        deltas = []
        async for kind, payload in proxy.llm_proxy.chat_stream(
            "business", [{"role": "user", "content": "hi"}]
        ):
            if kind == "delta":
                deltas.append(payload)
        return deltas

    assert asyncio.run(scenario()) == ["正文"]
    assert len(calls) == 2


def test_stream_failure_detail_carries_upstream_error_code(monkeypatch):
    """两档流式都失败时，异常明细带上网关错误码，便于区分额度耗尽与网络故障。"""
    _configure(monkeypatch)
    _install(
        monkeypatch,
        {
            PRIMARY_URL: _quota_exhausted(),
            FALLBACK_URL: {"status": 429, "payload": {"error": {"code": "rate_limit_exceeded"}}},
        },
    )

    async def scenario():
        async for _ in proxy.llm_proxy.chat_stream("business", [{"role": "user", "content": "hi"}]):
            pass

    try:
        asyncio.run(scenario())
        raise AssertionError("应当抛出 ModelUnavailable")
    except ModelUnavailable as exc:
        assert "primary:spark-x2.6 HTTP 429 code=insufficient_quota" in exc.detail
        assert "fallback:u2-flash HTTP 429 code=rate_limit_exceeded" in exc.detail
