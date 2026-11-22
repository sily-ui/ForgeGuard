import asyncio

from .config import settings


class Runtime:
    """进程内运行时状态：质询等待、后台任务、录制标记、降级留痕。"""

    def __init__(self):
        self.challenges = {}
        self.challenge_sessions = {}
        self.challenge_memory = {}
        self.tasks = {}
        self.session_locks = {}
        self.redteam_flags = {}
        self.recording = {}
        self.degradations = {}
        self.state_backend = "memory"
        self.redis_reachable = False
        self._redis = None

    def init_redis(self):
        try:
            import redis

            client = redis.Redis.from_url(
                settings.redis_url, socket_connect_timeout=1, socket_timeout=1
            )
            client.ping()
            self._redis = client
            self.redis_reachable = True
        except Exception:
            self._redis = None
            self.redis_reachable = False
        # 运行态（质询/任务/事件）仍在进程内存，如实报告，避免多副本部署误判。
        self.state_backend = "memory"

    def note_degradation(self, session_id, reason):
        items = self.degradations.setdefault(session_id, [])
        if reason not in items:
            items.append(reason)
        if session_id:
            from ..models import db as dbmod

            with dbmod.session_scope() as db:
                row = db.get(dbmod.Session, session_id)
                if row is not None:
                    existing = list(row.degradations or [])
                    if reason not in existing:
                        existing.append(reason)
                        row.degradations = existing

    def pop_degradations(self, session_id):
        return self.degradations.pop(session_id, [])

    def remember_challenge(self, session_id, kind, approved):
        self.challenge_memory.setdefault(session_id, {})[kind] = approved

    def recalled_challenge(self, session_id, kind):
        return self.challenge_memory.get(session_id, {}).get(kind)

    def register_challenge(self, call_id, session_id=None):
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.challenges[call_id] = future
        if session_id:
            self.challenge_sessions[call_id] = session_id
        return future

    def resolve_challenge(self, call_id, approved, session_id=None):
        if session_id is not None and self.challenge_sessions.get(call_id) != session_id:
            return False
        future = self.challenges.pop(call_id, None)
        self.challenge_sessions.pop(call_id, None)
        if future is None or future.done():
            return False
        future.get_loop().call_soon_threadsafe(future.set_result, approved)
        return True

    def cancel_challenge(self, call_id):
        future = self.challenges.pop(call_id, None)
        self.challenge_sessions.pop(call_id, None)
        if future and not future.done():
            future.cancel()

    def cancel_session_challenges(self, session_id):
        for call_id in [
            cid for cid, sid in self.challenge_sessions.items() if sid == session_id
        ]:
            self.cancel_challenge(call_id)

    def session_lock(self, session_id):
        lock = self.session_locks.get(session_id)
        if lock is None:
            lock = self.session_locks[session_id] = asyncio.Lock()
        return lock

    def cancel_task(self, session_id):
        task = self.tasks.pop(session_id, None)
        if task is not None and not task.done():
            task.get_loop().call_soon_threadsafe(task.cancel)


runtime = Runtime()