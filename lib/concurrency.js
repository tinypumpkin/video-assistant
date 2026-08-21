var BILI_CONCURRENCY = (() => {
  /**
   * 带并发上限的 map，返回 allSettled 形状的结果。
   * 刻意保序（结果要按 id 对回分段）、单个失败不中断全局（一个限流不该丢整轮）。
   */
  async function mapWithConcurrency(items, limit, worker, onProgress) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const results = new Array(total);
    if (total === 0) return results;

    const size = Math.max(1, Math.min(Math.floor(Number(limit) || 1), total));
    let nextIndex = 0;
    let done = 0;

    const runOne = async () => {
      while (true) {
        // 取号必须是同步的，不能 await 之后再取，否则多个 worker 会拿到同一个下标。
        const index = nextIndex;
        if (index >= total) return;
        nextIndex += 1;

        try {
          results[index] = { status: "fulfilled", value: await worker(list[index], index) };
        } catch (error) {
          results[index] = { status: "rejected", reason: error };
        }

        done += 1;
        if (typeof onProgress === "function") {
          try {
            onProgress(done, total);
          } catch (error) {
            // 进度回调出错不该影响任务本身。
          }
        }
      }
    };

    await Promise.all(Array.from({ length: size }, runOne));
    return results;
  }

  /** 串行队列，保护「读—改—写」临界区：并发写时后写的会拿旧快照覆盖先写的。 */
  function createSerialQueue() {
    let tail = Promise.resolve();

    return function enqueue(task) {
      // 前一个任务失败不能让整条队列卡死，所以这里吞掉它的错误；
      // 错误本身由各自的调用方通过返回的 promise 收到。
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
  }

  /**
   * 在途去重表：同 key 并发只发一个真实请求，后来者共享同一个 Promise。
   * 典型场景：连点几张截图手记，每张都触发 enrichMemoInBackground 拉同
   * 一个视频的字幕——没有这张表就是 N 个并行外部 API 请求；有它则只有
   * 第一个发请求，其余等结果。请求完成（无论成败）条目即清除，下一次
   * 谬误调用会重新发起。失败不缓存：一个 provider 抖一下不该让后续都拿旧错。
   */
  function createDedupMap() {
    const inFlight = new Map();

    return function runDeduped(key, task) {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const result = task()
        .then(
          (value) => {
            inFlight.delete(key);
            return value;
          },
          (error) => {
            inFlight.delete(key);
            throw error;
          },
        );
      inFlight.set(key, result);
      return result;
    };
  }

  return { mapWithConcurrency, createSerialQueue, createDedupMap };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = BILI_CONCURRENCY;
}
