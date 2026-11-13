import asyncio

from .config import settings


class Runtime:
    """进程内运行时状态：质询等待、后台任务、录制标记、降级留痕。"""

    def __init__(self):
        self.challenges = {}
        self.challenge_memory = {}
        self.tasks = {}
        self.redteam_flags = {}
        self.recording = {}
        self.degradations = {}
        self.state_backend = "memory"
        self._redis = None

    def init_redis(self):
        try:
            import redis

            client = redis.Redis.from_url(
                settings.redis_url, socket_connect_timeout=1, socket_timeout=1
            )
            client.ping()
            self._redis = client
            self.state_backend = "redis"
        except Exception:
            self._redis = None
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

    def register_challenge(self, call_id):
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.challenges[call_id] = future
        return future

    def resolve_challenge(self, call_id, approved):
        future = self.challenges.pop(call_id, None)
        if future is None or future.done():
            return False
        future.get_loop().call_soon_threadsafe(future.set_result, approved)
        return True

    def cancel_challenge(self, call_id):
        future = self.challenges.pop(call_id, None)
        if future and not future.done():
            future.cancel()


runtime = Runtime()