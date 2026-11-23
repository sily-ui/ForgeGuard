"""存量数据迁移：SQLite → 共享库（PostgreSQL/MySQL），也可 SQLite → SQLite 演练。

用法（在 backend 目录下）：
    python scripts/migrate_sqlite_to_pg.py \
        --source data/beforebound.db \
        --target postgresql+psycopg://user:pass@host:5432/beforebound

默认 --source 取 SQLITE_PATH，--target 取 DATABASE_URL。迁移为「附加式」：
目标库已存在的同主键行跳过（ON CONFLICT DO NOTHING），可重复执行而不产生重复。
--truncate 会先清空目标表再导入（破坏性，须同时 --yes 确认）。源库只读，绝不改动。
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, inspect, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.models import db as dbmod  # noqa: E402


def _as_url(value):
    if "://" in value:
        return value
    return f"sqlite:///{value}"


def _insert_stmt(table, dialect):
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "mysql":
        from sqlalchemy.dialects.mysql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert(table)


def migrate(source_url, target_url, batch_size=500, truncate=False, create_schema=True, dry_run=False):
    """按表批量复制源库数据到目标库，返回 {表名: 读取行数}。源库只读。"""
    source_url = _as_url(source_url)
    target_url = _as_url(target_url)
    if source_url == target_url:
        raise ValueError("源与目标不能相同")
    src = create_engine(source_url)
    dst = create_engine(target_url)
    src_tables = set(inspect(src).get_table_names())
    if create_schema and not dry_run:
        dbmod.Base.metadata.create_all(dst)
    dialect = dst.dialect.name
    counts = {}
    for table in dbmod.Base.metadata.sorted_tables:
        if table.name not in src_tables:
            continue
        rows_read = 0
        with src.connect() as sconn:
            result = sconn.execute(select(table))
            while True:
                batch = result.fetchmany(batch_size)
                if not batch:
                    break
                rows_read += len(batch)
                if dry_run:
                    continue
                payload = [dict(row._mapping) for row in batch]
                with dst.begin() as dconn:
                    if truncate and rows_read == len(batch):
                        dconn.execute(table.delete())
                    stmt = _insert_stmt(table, dialect)
                    if dialect == "mysql":
                        stmt = stmt.prefix_with("IGNORE")
                    else:
                        stmt = stmt.on_conflict_do_nothing()
                    dconn.execute(stmt, payload)
        counts[table.name] = rows_read
    src.dispose()
    dst.dispose()
    return counts


def main():
    parser = argparse.ArgumentParser(description="BeforeBound 存量数据迁移（源库只读）")
    parser.add_argument("--source", default=settings.sqlite_path, help="源 SQLite 路径或 URL")
    parser.add_argument("--target", default=settings.database_url, help="目标库 URL（postgresql+psycopg://...）")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--truncate", action="store_true", help="先清空目标表（破坏性）")
    parser.add_argument("--yes", action="store_true", help="确认 --truncate 的破坏性操作")
    parser.add_argument("--dry-run", action="store_true", help="只统计源库行数，不写目标")
    args = parser.parse_args()

    if not args.target:
        parser.error("缺少 --target（或设置 DATABASE_URL 环境变量）")
    if args.truncate and not args.yes:
        parser.error("--truncate 为破坏性操作，须同时加 --yes 确认")

    counts = migrate(
        args.source,
        args.target,
        batch_size=args.batch_size,
        truncate=args.truncate,
        dry_run=args.dry_run,
    )
    mode = "演练" if args.dry_run else ("清空导入" if args.truncate else "附加导入")
    print(f"[{mode}] 源 {args.source} → 目标 {args.target}")
    for name, n in counts.items():
        print(f"  {name}: {n} 行")
    print(f"合计 {sum(counts.values())} 行，{len(counts)} 张表")


if __name__ == "__main__":
    main()