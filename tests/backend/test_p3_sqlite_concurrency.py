"""Phase 5 blindspot probe P3(2026-07-10 报告 §④)固化为永久回归。

问题:单进程 uvicorn + SQLite WAL(Makefile:51)对小团队(约 3–10 人)并发写够不够,
还是需要提前迁 Postgres?探针用线程池模拟并发 create_version + record_audit 写同一
WAL 库,测锁等待与吞吐——给"SQLite 继续够用"的假设(A6,blindspot 报告)一个实测依据,
而不是纯靠直觉。

WAL 模式下读不阻塞写、写也不阻塞读,但写与写仍然串行(单写者);Python sqlite3
默认 5s busy-wait timeout(`_conn()` 未覆盖,见 store.py:117),意味着排队等锁而非
立刻报错——这正是本探针要验证的:排队是否in实际团队规模下短到可忽略。
"""
import concurrent.futures
import time

from backend import store
from backend.canonical import to_canonical

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

# 保守估计的团队规模(ADR-4 D-P5-3:约 3–10 人)+ 安全余量,模拟突发并发而非稳态。
_WRITERS = 10
_WRITES_PER_WRITER = 20


def _payload(i: int) -> dict:
    """i 取跨全部写者的全局唯一整数(见调用处 writer_id*1000+i)——每次写入内容不同,
    这样本测试量的是纯写入延迟,不与 create_version 的内容寻址幂等路径混在一起
    (幂等路径下并发撞车是另一个问题,见 test_concurrent_create_version_same_content_is_idempotent_under_race)。"""
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": (i + 1) / 1_000_000}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def test_concurrent_writers_no_lock_errors_and_bounded_latency():
    """conftest.py 的 _isolated_store_db(autouse)已把 _DB_PATH 隔离到本测试的 tmp_path。"""
    store.ensure_project(PUUID, "P3 并发探针")

    def _writer(writer_id: int) -> list[float]:
        latencies = []
        for i in range(_WRITES_PER_WRITER):
            t0 = time.monotonic()
            doc, sc = to_canonical(_payload(writer_id * 1000 + i), PUUID)
            store.create_version(PUUID, doc, sc, message=f"w{writer_id}-{i}")
            latencies.append(time.monotonic() - t0)
        return latencies

    t_start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=_WRITERS) as pool:
        results = list(pool.map(_writer, range(_WRITERS)))    # map 传播子线程异常(锁错误会在此炸出)
    wall = time.monotonic() - t_start

    all_latencies = [lat for run in results for lat in run]
    total_writes = _WRITERS * _WRITES_PER_WRITER
    assert len(all_latencies) == total_writes

    versions = store.list_versions(PUUID)
    assert len(versions) == total_writes                       # 无写丢失(每次内容不同 → 每次新版本)

    p95 = sorted(all_latencies)[int(0.95 * len(all_latencies))]
    # 生成性宽松上界(护住"退化到秒级排队"这类真实回归,不是精确性能门):
    # 3–10 人团队的突发写入,单次延迟中位数应在毫秒级,总墙钟不应逼近 Python sqlite3
    # 默认 5s busy-timeout(逼近即说明已经在真实排队,该决策该重新评估迁 Postgres)。
    assert wall < 5.0, f"{total_writes} 次并发写总耗时 {wall:.2f}s —— 逼近/超过 5s busy-timeout"
    assert p95 < 1.0, f"单次写 p95={p95*1000:.0f}ms —— 已出现明显排队"

    print(f"\n[P3] {_WRITERS} writers × {_WRITES_PER_WRITER} writes = {total_writes} 次并发写 "
          f"@ 单 SQLite WAL 库:总耗时 {wall:.3f}s,吞吐 {total_writes/wall:.0f} writes/s,"
          f"单次延迟 p50={sorted(all_latencies)[len(all_latencies)//2]*1000:.1f}ms "
          f"p95={p95*1000:.1f}ms max={max(all_latencies)*1000:.1f}ms")


def test_concurrent_create_version_same_content_is_idempotent_under_race():
    """探针本身发现的缺陷回归:多线程同时对相同内容调用 create_version 时,
    check-then-insert 曾经在竞态下让后到者撞 UNIQUE 约束崩溃(store.py::create_version)。
    用 Barrier 把全部线程钉在同一时刻起跑,最大化撞车概率,断言:零异常、
    全部线程拿到同一个 version id、库里确实只有一条记录(幂等语义在并发下也成立)。
    """
    import threading

    store.ensure_project(PUUID, "P3 竞态回归")
    doc, sc = to_canonical(_payload(0), PUUID)

    n = 16
    barrier = threading.Barrier(n)
    results: list[dict] = [None] * n  # type: ignore[list-item]
    errors: list[BaseException] = []

    def _racer(idx: int) -> None:
        barrier.wait()                 # 全部线程卡在这里,barrier 一破全部同时冲向 create_version
        try:
            results[idx] = store.create_version(PUUID, doc, sc)
        except BaseException as e:      # noqa: BLE001 —— 探针要捕获任何异常,不只是 IntegrityError
            errors.append(e)

    threads = [threading.Thread(target=_racer, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"并发 create_version 抛出异常:{errors}"
    ids = {r["id"] for r in results}
    assert ids == {results[0]["id"]}                          # 全部线程收敛到同一个版本 id
    assert sum(1 for r in results if r["created"]) == 1        # 恰好一个"真创建",其余是幂等命中
    assert len(store.list_versions(PUUID)) == 1                # 库里确实只有一条,无重复行
