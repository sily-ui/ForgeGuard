from .config import settings
from .errors import QuotaExhausted
from .security import utcnow

MODE_LIVE = "live"
MODE_REPLAY = "replay"


def _global_key():
    return "global:" + utcnow().strftime("%Y-%m-%d")


def get_mode():
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        row = db.get(dbmod.PlatformState, "mode")
    return row.value if row else MODE_LIVE


def set_mode(mode, reason=None, snapshot_id=None):
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        row = db.get(dbmod.PlatformState, "mode")
        if row is None:
            row = dbmod.PlatformState(key="mode", value=mode)
            db.add(row)
        row.value = mode
        meta = db.get(dbmod.PlatformState, "mode_meta")
        payload = {"reason": reason, "snapshot_id": snapshot_id, "at": utcnow().isoformat()}
        if meta is None:
            db.add(dbmod.PlatformState(key="mode_meta", value=payload))
        else:
            meta.value = payload


def get_mode_meta():
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        row = db.get(dbmod.PlatformState, "mode_meta")
    return row.value if row else {}


def _used(db, key):
    from ..models import db as dbmod

    row = db.get(dbmod.QuotaCounter, key)
    return row.used if row else 0


def _consume(db, key, amount, limit):
    from ..models import db as dbmod

    row = db.get(dbmod.QuotaCounter, key)
    if row is None:
        row = dbmod.QuotaCounter(key=key, used=0, max_calls=limit)
        db.add(row)
    if row.used + amount > row.max_calls:
        return False
    row.used += amount
    return True


def status(session_id=None):
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        session_used = _used(db, f"session:{session_id}") if session_id else 0
        session_max = settings.quota_session_max
        if session_id:
            row = db.get(dbmod.QuotaCounter, f"session:{session_id}")
            if row:
                session_max = row.max_calls
        global_used = _used(db, _global_key())
        global_row = db.get(dbmod.QuotaCounter, _global_key())
        global_max = global_row.max_calls if global_row else settings.quota_global_daily
    return {
        "session_used_calls": session_used,
        "session_max_calls": session_max,
        "global_used_calls": global_used,
        "global_max_calls": global_max,
        "mode": get_mode(),
    }


def check_and_consume(session_id, amount=1):
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        global_ok = _consume(db, _global_key(), amount, settings.quota_global_daily)
        session_ok = True
        if session_id:
            session_ok = _consume(
                db, f"session:{session_id}", amount, settings.quota_session_max
            )
    if not global_ok or not session_ok:
        if settings.snapshot_mode == "auto" and not global_ok:
            set_mode(MODE_REPLAY, reason="全局模型配额耗尽，自动切换快照回放")
        scope = "全局" if not global_ok else "会话"
        raise QuotaExhausted(f"{scope}模型调用额度用尽")


def adjust(global_max=None, session_max=None):
    from ..models import db as dbmod

    with dbmod.session_scope() as db:
        if global_max is not None:
            row = db.get(dbmod.QuotaCounter, _global_key())
            if row is None:
                row = dbmod.QuotaCounter(key=_global_key(), used=0, max_calls=global_max)
                db.add(row)
            row.max_calls = global_max
        if session_max is not None:
            settings.quota_session_max = session_max
            rows = db.query(dbmod.QuotaCounter).filter(
                dbmod.QuotaCounter.key.like("session:%")
            )
            for row in rows:
                row.max_calls = session_max
    return status()