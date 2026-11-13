import time

_TTL_SECONDS = 24 * 3600


def get_cached(key, endpoint):
    if not key:
        return None
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        row = db.get(dbmod.IdempotencyKey, key)
        if row is None:
            return None
        if row.endpoint != endpoint or time.time() - row.created_ts > _TTL_SECONDS:
            return None
        return row.response


def store(key, endpoint, response):
    if not key:
        return
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        row = db.get(dbmod.IdempotencyKey, key)
        if row is None:
            db.add(
                dbmod.IdempotencyKey(
                    key=key, endpoint=endpoint, response=response, created_ts=time.time()
                )
            )
        else:
            row.endpoint = endpoint
            row.response = response
            row.created_ts = time.time()