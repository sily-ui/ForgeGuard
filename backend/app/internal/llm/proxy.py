"""统一模型代理：OpenAI 兼容接口封装，配额计数、超时与降级。

前端与业务侧不接触模型密钥；密钥仅来自后端环境变量，不入日志。
"""

import asyncio
import json
import re

import httpx

from ...core import quota
from ...core.config import settings
from ...core.errors import ModelUnavailable
from . import simulated

# 推理型模型（如 spark-x2.6）单轮可达数十秒，短超时会导致整轮降级为离线仿真。
_DEFAULT_TIMEOUTS = {"business": 30.0, "guardian": 30.0, "redteam": 30.0}


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
    ):
        quota.check_and_consume(session_id)
        if not settings.model_configured:
            content = simulated.chat(role, messages)
            return {
                "content": content,
                "usage": {
                    "prompt_tokens": sum(len(str(m.get("content", ""))) for m in messages) // 4,
                    "completion_tokens": len(content) // 4,
                },
                "simulated": True,
            }
        model = (
            settings.guardian_model_name if role == "guardian" else settings.model_name
        )
        body = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if response_format:
            body["response_format"] = response_format
        effective_timeout = timeout or _DEFAULT_TIMEOUTS.get(role, 10.0)
        try:
            # trust_env=False：忽略系统代理设置，直连 MODEL_BASE_URL 配置的真实地址，
            # 避免系统 NO_PROXY 中的 IPv6 字面量导致 URL 解析失败
            async with httpx.AsyncClient(timeout=effective_timeout, trust_env=False) as client:
                resp = await client.post(
                    f"{settings.model_base_url}/chat/completions",
                    json=body,
                    headers={"Authorization": f"Bearer {settings.model_api_key}"},
                )
                resp.raise_for_status()
                payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ModelUnavailable(f"模型接口调用失败：{type(exc).__name__}") from exc
        try:
            content = payload["choices"][0]["message"]["content"]
            usage = payload.get("usage", {})
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelUnavailable("模型返回结构异常") from exc
        return {
            "content": content,
            "usage": {
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
            },
            "simulated": False,
        }

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
        quota.check_and_consume(session_id)
        if not settings.model_configured:
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
        model = (
            settings.guardian_model_name if role == "guardian" else settings.model_name
        )
        body = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        if response_format:
            body["response_format"] = response_format
        effective_timeout = timeout or _DEFAULT_TIMEOUTS.get(role, 10.0)
        parts = []
        usage = {}
        try:
            async with httpx.AsyncClient(timeout=effective_timeout, trust_env=False) as client:
                async with client.stream(
                    "POST",
                    f"{settings.model_base_url}/chat/completions",
                    json=body,
                    headers={"Authorization": f"Bearer {settings.model_api_key}"},
                ) as resp:
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
            raise ModelUnavailable(f"模型流式调用失败：{type(exc).__name__}") from exc
        content = "".join(parts)
        if not content:
            raise ModelUnavailable("模型流式返回为空")
        yield (
            "end",
            {
                "content": content,
                "usage": {
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", len(content) // 4),
                },
                "simulated": False,
            },
        )


llm_proxy = LLMProxy()