"""统一模型代理：OpenAI 兼容接口封装，配额计数、超时与降级。

前端与业务侧不接触模型密钥；密钥仅来自后端环境变量，不入日志。
模型档位按「主模型 → 备用模型」依次尝试，主模型额度耗尽或上游故障时自动切换备用档位，
两档都失败才抛 ModelUnavailable 交由调用方降级为离线仿真。
"""

import asyncio
import contextvars
import json
import logging
import re
from contextlib import contextmanager

import httpx

from ...core import quota
from ...core.config import settings
from ...core.errors import ModelUnavailable
from . import simulated

logger = logging.getLogger(__name__)

# 推理型模型（如 spark-x2.6、u2-flash）单轮可达数十秒，短超时会导致整轮降级为离线仿真。
_DEFAULT_TIMEOUTS = {"business": 30.0, "guardian": 30.0, "redteam": 30.0}


def _provider_chain(role):
    """模型档位链：主模型优先，其后追加备用模型。

    主模型额度耗尽、被限流或上游故障时依次向后切换，调用方与前端无需感知；
    未配置备用模型时链路只有主模型一档。
    """
    chain = [
        {
            "label": "primary",
            "base_url": settings.model_base_url,
            "api_key": settings.model_api_key,
            "model": settings.guardian_model_name if role == "guardian" else settings.model_name,
        }
    ]
    if settings.fallback_configured:
        chain.append(
            {
                "label": "fallback",
                "base_url": settings.fallback_model_base_url,
                "api_key": settings.fallback_model_api_key,
                "model": settings.fallback_model_name,
            }
        )
    return chain


def _request_body(provider, messages, max_tokens, temperature, response_format, stream=False):
    body = {
        "model": provider["model"],
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if response_format:
        body["response_format"] = response_format
    if stream:
        body["stream"] = True
        # 备用网关只在显式声明时回传 usage，缺失会让配额与报告 token 统计失真
        body["stream_options"] = {"include_usage": True}
    return body


def _failure_reason(exc):
    """上游失败摘要：只取状态码与错误码，不保留响应原文（网关可能回显请求凭据）。"""
    resp = getattr(exc, "response", None)
    if resp is None:
        return type(exc).__name__
    code = ""
    try:
        error = (resp.json() or {}).get("error") or {}
        code = str(error.get("code") or error.get("type") or "")
    except (ValueError, RuntimeError):
        pass
    return f"HTTP {resp.status_code}" + (f" code={code}" if code else "")


# 快速仿真链路：一键演示等场景可强制整条调用链走离线仿真，秒级完成、答辩可控。
_force_simulated: contextvars.ContextVar = contextvars.ContextVar("fg_force_simulated", default=None)


def current_simulated_reason() -> str | None:
    """当前是否处于强制仿真链路，返回原因文案（无则 None）。"""
    return _force_simulated.get()


@contextmanager
def force_simulated(reason: str):
    """强制随后的模型调用走离线仿真（不消耗配额、不触达真实接口）。"""
    token = _force_simulated.set(reason)
    try:
        yield
    finally:
        _force_simulated.reset(token)


def strip_code_fence(text):
    """模型即便被要求纯 JSON 仍可能包裹 ```json 围栏，解析前剥离。"""
    t = str(text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        t = re.sub(r"\s*```\s*$", "", t).strip()
    return t


class LLMProxy:
    async def chat(
        self,
        role,
        messages,
        session_id=None,
        response_format=None,
        max_tokens=900,
        temperature=0.2,
        timeout=None,
        billed=False,
    ):
        reason = _force_simulated.get()
        simulated_forced = reason is not None
        # 游客模型调用限流对仿真与真实调用同时生效，故置于档位判定之前
        quota.check_guest_call_rate()
        if not settings.model_configured or simulated_forced:
            # 仿真内容保持原样（JSON 结构不被前缀破坏）；降级留痕由调用方
            # （业务 Agent 的 simulated_fallback / 守护与红队各自的兜底）负责。
            content = simulated.chat(role, messages)
            return {
                "content": content,
                "usage": {
                    "prompt_tokens": sum(len(str(m.get("content", ""))) for m in messages) // 4,
                    "completion_tokens": len(content) // 4,
                },
                "simulated": True,
            }
        # 仅真实模型调用消耗配额；仿真不计费。整条档位链共用一次扣减，切换不重复计费。
        # billed=True：流式尝试已扣过一次配额，回退到一次性调用时不再重复扣减。
        if not billed:
            quota.consume_model_quota(session_id)
        effective_timeout = timeout or _DEFAULT_TIMEOUTS.get(role, 10.0)
        failures = []
        for provider in _provider_chain(role):
            body = _request_body(provider, messages, max_tokens, temperature, response_format)
            try:
                # trust_env=False：忽略系统代理设置，直连档位配置的真实地址，
                # 避免系统 NO_PROXY 中的 IPv6 字面量导致 URL 解析失败
                async with httpx.AsyncClient(timeout=effective_timeout, trust_env=False) as client:
                    resp = await client.post(
                        f"{provider['base_url']}/chat/completions",
                        json=body,
                        headers={"Authorization": f"Bearer {provider['api_key']}"},
                    )
                    resp.raise_for_status()
                    payload = resp.json()
                content = payload["choices"][0]["message"]["content"]
                usage = payload.get("usage", {})
            except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
                failures.append(f"{provider['label']}:{provider['model']} {_failure_reason(exc)}")
                logger.warning("模型档位调用失败 role=%s %s", role, failures[-1])
                continue
            if not str(content or "").strip():
                # 推理型模型把 max_tokens 全部花在 reasoning_content 上时 content 为空，
                # 与调用失败同等对待，交给下一档位重试。
                failures.append(f"{provider['label']}:{provider['model']} 返回空内容")
                logger.warning("模型档位返回空内容 role=%s %s", role, failures[-1])
                continue
            return {
                "content": content,
                "usage": {
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                },
                "simulated": False,
                "provider": provider["label"],
                "model": provider["model"],
            }
        raise ModelUnavailable("所有模型档位均不可用：" + "；".join(failures))

    async def chat_stream(
        self,
        role,
        messages,
        session_id=None,
        response_format=None,
        max_tokens=900,
        temperature=0.2,
        timeout=None,
    ):
        """流式调用：逐块产出 ("delta", str) 文本增量，最后产出 ("end", dict) 汇总帧。

        上游不支持流式或中途断流时抛 ModelUnavailable，由调用方决定回退策略。
        """
        reason = _force_simulated.get()
        simulated_forced = reason is not None
        # 游客模型调用限流对仿真与真实调用同时生效，故置于档位判定之前
        quota.check_guest_call_rate()
        if not settings.model_configured or simulated_forced:
            content = simulated.chat(role, messages)
            # 仿真内容按小段吐出，保留流式观感
            step = max(8, len(content) // 24)
            for i in range(0, len(content), step):
                yield ("delta", content[i : i + step])
                await asyncio.sleep(0.02)
            yield (
                "end",
                {
                    "content": content,
                    "usage": {
                        "prompt_tokens": sum(len(str(m.get("content", ""))) for m in messages) // 4,
                        "completion_tokens": len(content) // 4,
                    },
                    "simulated": True,
                },
            )
            return
        # 仅真实模型调用消耗配额；仿真不计费。整条档位链共用一次扣减，切换不重复计费。
        quota.consume_model_quota(session_id)
        effective_timeout = timeout or _DEFAULT_TIMEOUTS.get(role, 10.0)
        failures = []
        for provider in _provider_chain(role):
            body = _request_body(
                provider, messages, max_tokens, temperature, response_format, stream=True
            )
            parts = []
            usage = {}
            try:
                async with httpx.AsyncClient(timeout=effective_timeout, trust_env=False) as client:
                    async with client.stream(
                        "POST",
                        f"{provider['base_url']}/chat/completions",
                        json=body,
                        headers={"Authorization": f"Bearer {provider['api_key']}"},
                    ) as resp:
                        if resp.status_code >= 400:
                            # 只在失败分支读取错误体以拿到错误码，不拖慢正常流式的首字延迟
                            await resp.aread()
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            if not line or not line.startswith("data:"):
                                continue
                            raw = line[5:].strip()
                            if raw == "[DONE]":
                                break
                            try:
                                chunk = json.loads(raw)
                            except ValueError:
                                continue
                            if chunk.get("usage"):
                                usage = chunk["usage"]
                            choices = chunk.get("choices") or []
                            if not choices:
                                continue
                            delta = (choices[0].get("delta") or {}).get("content")
                            if not delta:
                                # 上游忽略 stream 参数时会返回完整 message
                                delta = (choices[0].get("message") or {}).get("content")
                            if delta:
                                parts.append(delta)
                                yield ("delta", delta)
            except (httpx.HTTPError, ValueError) as exc:
                reason = _failure_reason(exc)
                if parts:
                    # 已向下游吐出增量，切档会重复输出，只能整体交由调用方降级。
                    raise ModelUnavailable(f"模型流式调用中断：{reason}") from exc
                failures.append(f"{provider['label']}:{provider['model']} {reason}")
                logger.warning("模型档位流式调用失败 role=%s %s", role, failures[-1])
                continue
            content = "".join(parts)
            if not content:
                failures.append(f"{provider['label']}:{provider['model']} 流式返回为空")
                logger.warning("模型档位流式返回为空 role=%s %s", role, failures[-1])
                continue
            yield (
                "end",
                {
                    "content": content,
                    "usage": {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", len(content) // 4),
                    },
                    "simulated": False,
                    "provider": provider["label"],
                    "model": provider["model"],
                },
            )
            return
        raise ModelUnavailable("所有模型档位均不可用：" + "；".join(failures))


llm_proxy = LLMProxy()