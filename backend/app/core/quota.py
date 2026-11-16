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
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    from ..models import db as dbmod

    # 先原子建行（并发下仅一个成功），再以条件 UPDATE 原子自增，消除读-改-写竞态。
    db.execute(
        sqlite_insert(dbmod.QuotaCounter)
        .values(key=key, used=0, max_calls=limit)
        .on_conflict_do_nothing()
    )
    updated = (
        db.query(dbmod.QuotaCounter)
        .filter(
            dbmod.QuotaCounter.key == key,
            dbmod.QuotaCounter.used + amount <= dbmod.QuotaCounter.max_calls,
        )
        .update(
            {dbmod.QuotaCounter.used: dbmod.QuotaCounter.used + amount},
            synchronize_session=False,
        )
    )
    return updated == 1


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

    global_ok = True
    session_ok = True
    try:
        with dbmod.session_scope() as db:
            global_ok = _consume(db, _global_key(), amount, settings.quota_global_daily)
            if session_id:
                session_ok = _consume(
                    db, f"session:{session_id}", amount, settings.quota_session_max
                )
            if not global_ok or not session_ok:
                scope = "全局" if not global_ok else "会话"
                # 在事务内抛出以回滚全局/会话两处自增，避免部分扣减泄漏。
                raise QuotaExhausted(f"{scope}模型调用额度用尽")
    except QuotaExhausted:
        # 模式切换独立提交，须在写事务回滚之后执行，避免 SQLite 写锁自死锁。
        if settings.snapshot_mode == "auto" and not global_ok:
            set_mode(MODE_REPLAY, reason="全局模型配额耗尽，自动切换快照回放")
        raise


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