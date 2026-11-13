import re
import secrets

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"

_PREFIX_HINTS = [
    ("运维", "opsaudit"),
    ("办公", "office"),
    ("客服", "support"),
    ("数据", "data"),
    ("ops", "opsaudit"),
    ("office", "office"),
    ("support", "support"),
]


def rand_suffix(length=6):
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def new_id(prefix):
    return f"{prefix}-{rand_suffix()}"


def instance_prefix(name):
    lowered = (name or "").lower()
    for hint, slug in _PREFIX_HINTS:
        if hint in lowered:
            return slug
    ascii_part = re.sub(r"[^a-z0-9]+", "", lowered)
    return ascii_part[:12] or "agent"


def new_instance_id(name):
    return f"inst-{instance_prefix(name)}-{rand_suffix(4)}"