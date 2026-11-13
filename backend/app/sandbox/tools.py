"""六类工具的内存仿真实现。

五条红线：不写磁盘、不创建子进程、不发外部请求、不连邮件服务、不读环境密钥。
"""

from .presets import CMD_OUTPUTS, SENSITIVE_CONFIG_KEYS


def _norm_path(path):
    path = str(path or "").strip().replace("\\", "/")
    if path and not path.startswith(("./", "/")):
        path = "./" + path
    return path


def mask_value(value):
    text = str(value)
    if len(text) <= 4:
        return "*" * len(text)
    return text[:2] + "*" * (len(text) - 4) + text[-2:]


def mask_fields(data, fields):
    if not fields:
        return data
    if isinstance(data, dict):
        return {
            key: (mask_value(value) if key in fields else mask_fields(value, fields))
            for key, value in data.items()
        }
    if isinstance(data, list):
        return [mask_fields(item, fields) for item in data]
    return data


def read_file(partition, params):
    path = _norm_path(params.get("path"))
    if not path:
        return {"ok": False, "error": "缺少 path 参数"}
    content = partition.files.get(path)
    if content is None:
        return {"ok": False, "error": "文件不存在", "path": path}
    return {"ok": True, "path": path, "content": content}


def write_file(partition, params):
    path = _norm_path(params.get("path"))
    content = str(params.get("content", ""))
    if not path:
        return {"ok": False, "error": "缺少 path 参数"}
    if path in partition.files and not params.get("_overwrite_allowed", False):
        return {"ok": False, "error": "目标文件已存在且未授权覆盖", "path": path}
    partition.files[path] = content
    return {"ok": True, "path": path, "bytes": len(content.encode("utf-8"))}


def send_email(partition, params):
    to = params.get("to") or params.get("recipients") or []
    if isinstance(to, str):
        to = [addr.strip() for addr in to.split(",") if addr.strip()]
    subject = str(params.get("subject", "（无主题）"))
    body = str(params.get("body", ""))
    log_id = partition.delivery_log_id()
    domains = sorted({addr.split("@")[-1] for addr in to if "@" in addr})
    partition.email_log.append(
        {
            "delivery_log_id": log_id,
            "to": to,
            "domains": domains,
            "subject": subject,
            "body": body,
            "at": partition.created_at,
            "delivered": False,
        }
    )
    return {
        "ok": True,
        "delivery_log_id": log_id,
        "recipients": to,
        "domains": domains,
        "subject": subject,
        "note": "模拟回执：仅写入沙盒投递日志，未真实投递",
    }


def query_api(partition, params):
    endpoint = str(params.get("endpoint", ""))
    data = partition.api_data.get(endpoint)
    if data is None:
        return {"ok": False, "error": "接口不存在", "endpoint": endpoint}
    fields = params.get("_mask_fields") or []
    return {"ok": True, "endpoint": endpoint, "data": mask_fields(data, fields)}


def run_cmd(partition, params):
    cmd = str(params.get("cmd") or params.get("command") or "").strip()
    name = cmd.split(" ")[0] if cmd else ""
    output = CMD_OUTPUTS.get(name)
    if output is None:
        return {"ok": False, "error": f"命令 {name or '(空)'} 不在仿真白名单内", "cmd": cmd}
    return {"ok": True, "cmd": cmd, "output": output}


def update_config(partition, params):
    key = str(params.get("key", ""))
    value = params.get("value")
    if key in SENSITIVE_CONFIG_KEYS:
        return {"ok": False, "error": "权限不足：敏感配置键禁止修改", "key": key}
    if key not in partition.config_items:
        return {"ok": False, "error": "配置键不存在", "key": key}
    old = partition.config_items[key]
    partition.config_items[key] = value
    return {"ok": True, "key": key, "old": old, "new": value}


TOOL_IMPLS = {
    "read_file": read_file,
    "write_file": write_file,
    "send_email": send_email,
    "query_api": query_api,
    "run_cmd": run_cmd,
    "update_config": update_config,
}