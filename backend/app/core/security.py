import secrets
import time
from collections import defaultdict, deque
from contextvars import ContextVar
from datetime import datetime, timezone

from .config import settings
from .errors import ApiError

ROLE_LEVELS = {"guest": 0, "judge": 1, "demo": 2, "admin": 3}


def utcnow():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class AuthContext:
    def __init__(self, token, role, client_id, ip="", workspace=""):
        self.token = token
        self.role = role
        self.client_id = client_id
        self.ip = ip
        self.workspace = workspace

    def require(self, min_role):
        if ROLE_LEVELS.get(self.role, 0) < ROLE_LEVELS[min_role]:
            raise ApiError(40300, detail=f"该操作需要 {min_role} 角色")


# 请求级身份：模型代理在调用链深处消费配额，需要据此区分游客并定位工作区/IP。
# 异步端点与其中创建的后台任务共享同一 context，故无需逐层透传参数。
_current_auth: ContextVar = ContextVar("forgeguard_auth", default=None)


def bind_auth(ctx):
    _current_auth.set(ctx)


def current_auth():
    return _current_auth.get()


def issue_token(role, client_id, workspace_id=""):
    from ..models import db as dbmod

    token = secrets.token_urlsafe(32)
    expires_at = utcnow().timestamp() + settings.session_ttl
    with dbmod.session_scope() as db:
        db.add(
            dbmod.Token(
                token=token,
                role=role,
                client_id=client_id or "",
                workspace_id=workspace_id or "",
                expires_at=expires_at,
                revoked=False,
            )
        )
    return token, int(settings.session_ttl)


def resolve_token(token):
    from ..models import db as dbmod

    if not token:
        raise ApiError(40100, detail="缺少令牌")
    with dbmod.session_scope() as db:
        record = db.get(dbmod.Token, token)
    if record is None or record.revoked:
        raise ApiError(40100, detail="令牌无效")
    if record.expires_at < utcnow().timestamp():
        raise ApiError(40100, detail="令牌已过期")
    return AuthContext(
        record.token, record.role, record.client_id, workspace=record.workspace_id or ""
    )


def revoke_token(token):
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        record = db.get(dbmod.Token, token)
        if record:
            record.revoked = True


def revoke_all_tokens():
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        count = db.query(dbmod.Token).filter(dbmod.Token.revoked.is_(False)).count()
        db.query(dbmod.Token).update({dbmod.Token.revoked: True})
    return count


class RateLimiter:
    def __init__(self):
        self._hits = defaultdict(deque)
        self.hit_log = deque(maxlen=2000)

    def check(self, key, limit, window_seconds=60):
        now = time.monotonic()
        # 令牌键随游客签发持续增长，定期清空桶防止字典无界膨胀。
        if len(self._hits) > 10000:
            for stale in [k for k, v in self._hits.items() if not v or v[-1] <= now - window_seconds]:
                del self._hits[stale]
        bucket = self._hits[key]
        while bucket and bucket[0] <= now - window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = int(bucket[0] + window_seconds - now) + 1
            self.hit_log.append(
                {"key": key, "limit": limit, "at": iso(utcnow()), "retry_after": retry_after}
            )
            raise ApiError(
                42900,
                detail=f"请求过于频繁，请 {retry_after} 秒后重试",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)

    def remaining(self, key, limit, window_seconds=60):
        """只读 peek：返回 (剩余可用数, 窗口重置 Unix 秒)，不消费配额。"""
        now = time.monotonic()
        bucket = self._hits.get(key)
        if bucket:
            while bucket and bucket[0] <= now - window_seconds:
                bucket.popleft()
        used = len(bucket) if bucket else 0
        remaining = max(0, limit - used)
        if bucket:
            reset = int(time.time() + (bucket[0] + window_seconds - now))
        else:
            reset = int(time.time()) + window_seconds
        return remaining, reset


rate_limiter = RateLimiter()

GENERAL_LIMIT = 240
HEAVY_LIMIT = 12
AUTH_LIMIT = 12
# 游客匿名放行，阈值收紧：每 IP 每分钟请求数、每 IP/每工作区每分钟模型调用数。
GUEST_GENERAL_LIMIT = 60
GUEST_CALL_LIMIT = 6