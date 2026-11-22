import time

_TTL_SECONDS = 24 * 3600


def _scoped(key, workspace):
    # 幂等键按工作区隔离，防止跨工作区枚举键读取他人响应。
    return f"{workspace or 'default'}:{key}"


def get_cached(key, endpoint, workspace="default"):
    if not key:
        return None
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        row = db.get(dbmod.IdempotencyKey, _scoped(key, workspace))
        if row is None:
            return None
        if row.endpoint != endpoint or time.time() - row.created_ts > _TTL_SECONDS:
            return None
        return row.response


def store(key, endpoint, response, workspace="default"):
    if not key:
        return
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        row = db.get(dbmod.IdempotencyKey, _scoped(key, workspace))
        if row is not None:
            # 首次结果不可被覆盖：同键换端点或重复提交都保留原记录。
            if time.time() - row.created_ts <= _TTL_SECONDS:
                return
            row.endpoint = endpoint
            row.response = response
            row.created_ts = time.time()
        else:
            db.add(
                dbmod.IdempotencyKey(
                    key=_scoped(key, workspace),
                    endpoint=endpoint,
                    response=response,
                    created_ts=time.time(),
                )
            )
        expired = (
            db.query(dbmod.IdempotencyKey)
            .filter(dbmod.IdempotencyKey.created_ts < time.time() - _TTL_SECONDS)
            .all()
        )
        for item in expired:
            db.delete(item)