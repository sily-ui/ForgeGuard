from .config import settings
from .errors import QuotaExhausted
from .security import GUEST_CALL_LIMIT, current_auth, rate_limiter, utcnow

MODE_LIVE = "live"
MODE_REPLAY = "replay"


def _global_key():
    return "global:" + utcnow().strftime("%Y-%m-%d")


def _guest_keys(ctx):
    day = utcnow().strftime("%Y-%m-%d")
    return f"guest:ws:{ctx.workspace}:{day}", f"guest:ip:{ctx.ip}:{day}"


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

    ctx = current_auth()
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
        data = {
            "session_used_calls": session_used,
            "session_max_calls": session_max,
            "global_used_calls": global_used,
            "global_max_calls": global_max,
            "mode": get_mode(),
        }
        if ctx is not None and ctx.role == "guest":
            ws_key, ip_key = _guest_keys(ctx)
            data["guest_used_calls"] = _used(db, ws_key)
            data["guest_max_calls"] = settings.quota_guest_daily
            data["guest_ip_used_calls"] = _used(db, ip_key)
            data["guest_ip_max_calls"] = settings.quota_guest_ip_daily
    return data


def check_and_consume(session_id, amount=1):
    from ..models import db as dbmod

    ctx = current_auth()
    guest = ctx is not None and ctx.role == "guest"
    if guest:
        rate_limiter.check(f"call:ip:{ctx.ip}", GUEST_CALL_LIMIT)
        rate_limiter.check(f"call:ws:{ctx.workspace}", GUEST_CALL_LIMIT)

    global_ok = True
    session_ok = True
    guest_ws_ok = True
    guest_ip_ok = True
    try:
        with dbmod.session_scope() as db:
            global_ok = _consume(db, _global_key(), amount, settings.quota_global_daily)
            if session_id:
                session_ok = _consume(
                    db, f"session:{session_id}", amount, settings.quota_session_max
                )
            if guest:
                ws_key, ip_key = _guest_keys(ctx)
                guest_ws_ok = _consume(db, ws_key, amount, settings.quota_guest_daily)
                guest_ip_ok = _consume(db, ip_key, amount, settings.quota_guest_ip_daily)
            if not (global_ok and session_ok and guest_ws_ok and guest_ip_ok):
                if not guest_ws_ok:
                    scope = f"游客今日工作区额度（{settings.quota_guest_daily} 次/天）"
                elif not guest_ip_ok:
                    scope = f"当前网络今日游客额度（{settings.quota_guest_ip_daily} 次/天）"
                elif not global_ok:
                    scope = "全局"
                else:
                    scope = "会话"
                # 在事务内抛出以回滚全部自增，避免部分扣减泄漏。
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