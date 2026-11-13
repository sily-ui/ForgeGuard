import copy
import secrets
from datetime import datetime, timezone

from .presets import API_DATA, CONFIG_ITEMS, MASTER_FILES

MAX_PARTITION_SNAPSHOTS = 5


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Partition:
    """实例级内存分区：文件树、投递日志、接口数据副本、配置项。"""

    def __init__(self, key):
        self.key = key
        self.files = copy.deepcopy(MASTER_FILES)
        self.email_log = []
        self.api_data = copy.deepcopy(API_DATA)
        self.config_items = dict(CONFIG_ITEMS)
        self.snapshots = {}
        self.created_at = _now()

    def reset(self, hard=False):
        self.files = copy.deepcopy(MASTER_FILES)
        self.email_log = []
        self.api_data = copy.deepcopy(API_DATA)
        self.config_items = dict(CONFIG_ITEMS)
        if hard:
            self.snapshots = {}

    def take_snapshot(self, name):
        if len(self.snapshots) >= MAX_PARTITION_SNAPSHOTS:
            return False, f"分区快照数量已达上限 {MAX_PARTITION_SNAPSHOTS}，请先删除旧快照"
        self.snapshots[name] = {
            "files": copy.deepcopy(self.files),
            "email_log": copy.deepcopy(self.email_log),
            "config_items": dict(self.config_items),
            "created_at": _now(),
        }
        return True, None

    def restore_snapshot(self, name):
        snap = self.snapshots.get(name)
        if snap is None:
            return False, "快照不存在"
        self.files = copy.deepcopy(snap["files"])
        self.email_log = copy.deepcopy(snap["email_log"])
        self.config_items = dict(snap["config_items"])
        return True, None

    def delete_snapshot(self, name):
        return self.snapshots.pop(name, None) is not None

    def delivery_log_id(self):
        return "dlv-" + secrets.token_hex(4)


class SandboxManager:
    def __init__(self):
        self._partitions = {}

    def create(self, key):
        partition = Partition(key)
        self._partitions[key] = partition
        return partition

    def get(self, key):
        return self._partitions.get(key)

    def destroy(self, key):
        return self._partitions.pop(key, None) is not None

    def reset(self, key, hard=False):
        partition = self.get(key)
        if partition is None:
            return False
        partition.reset(hard=hard)
        return True

    def keys(self):
        return list(self._partitions.keys())


sandbox_manager = SandboxManager()