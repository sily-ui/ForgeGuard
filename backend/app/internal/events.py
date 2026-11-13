"""进程内 asyncio 事件总线：SSE 推送、最近 200 条缓存、断点续传、快照录制。"""

import asyncio
import threading
from collections import deque

from ..core.state import runtime

HISTORY_LIMIT = 200

_main_loop = None
_main_thread_id = None


def bind_main_loop():
    """应用启动时记录主事件循环，供工作线程跨线程投递事件。"""
    global _main_loop, _main_thread_id
    try:
        _main_loop = asyncio.get_running_loop()
        _main_thread_id = threading.get_ident()
    except RuntimeError:
        _main_loop = None


def publish_threadsafe(session_id, event, data):
    """同步端点运行于工作线程，经主循环投递；无循环时静默跳过（事件仍会落库）。"""
    loop = _main_loop
    if loop is None or loop.is_closed():
        return
    if threading.get_ident() == _main_thread_id:
        loop.create_task(event_bus.publish(session_id, event, data))
    else:
        loop.call_soon_threadsafe(
            lambda: loop.create_task(event_bus.publish(session_id, event, data))
        )


class EventBus:
    def __init__(self):
        self._history = {}
        self._counters = {}
        self._subscribers = {}

    async def publish(self, session_id, event, data):
        seq = self._counters.get(session_id, 0) + 1
        self._counters[session_id] = seq
        record = {"id": seq, "event": event, "data": data}
        history = self._history.setdefault(session_id, deque(maxlen=HISTORY_LIMIT))
        history.append(record)
        if session_id in runtime.recording:
            runtime.recording[session_id].append(record)
        for queue in list(self._subscribers.get(session_id, set())):
            try:
                queue.put_nowait(record)
            except asyncio.QueueFull:
                pass
        return seq

    def history_since(self, session_id, last_event_id=0):
        history = self._history.get(session_id, deque())
        return [r for r in history if r["id"] > last_event_id]

    def full_history(self, session_id):
        return list(self._history.get(session_id, deque()))

    def subscribe(self, session_id):
        queue = asyncio.Queue(maxsize=500)
        self._subscribers.setdefault(session_id, set()).add(queue)
        return queue

    def unsubscribe(self, session_id, queue):
        subs = self._subscribers.get(session_id)
        if subs:
            subs.discard(queue)
            if not subs:
                self._subscribers.pop(session_id, None)

    def clear(self, session_id):
        self._history.pop(session_id, None)
        self._counters.pop(session_id, None)


event_bus = EventBus()