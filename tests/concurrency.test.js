const test = require("node:test");
const assert = require("node:assert/strict");

const { mapWithConcurrency, createSerialQueue, createDedupMap } = require("../lib/concurrency.js");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// 并发池
// ============================================================

test("结果按输入顺序返回，与完成顺序无关", async () => {
  // 故意让先入队的慢、后入队的快，制造完成顺序与输入顺序相反的情况
  const results = await mapWithConcurrency([30, 20, 10, 0], 4, async (ms, i) => {
    await delay(ms);
    return i;
  });
  assert.deepEqual(
    results.map((result) => result.value),
    [0, 1, 2, 3],
  );
});

test("并发数不会超过上限", async () => {
  let active = 0;
  let peak = 0;

  await mapWithConcurrency(Array.from({ length: 20 }), 3, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(5);
    active -= 1;
  });

  assert.equal(peak, 3, `实际峰值并发 ${peak}，超过了上限`);
});

test("每一项都只被处理一次", async () => {
  const seen = [];
  await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 4, async (item) => {
    await delay(1);
    seen.push(item);
  });
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("单个失败不影响其余任务，返回 settled 形状", async () => {
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
    if (item === 2) throw new Error("第二个失败了");
    return item * 10;
  });

  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[0].value, 10);
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.message, "第二个失败了");
  assert.equal(results[3].value, 40);
});

test("进度回调按完成数递增，最终等于总数", async () => {
  const progress = [];
  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => delay(1), (done, total) => {
    progress.push([done, total]);
  });

  assert.equal(progress.length, 5);
  assert.deepEqual(
    progress.map(([done]) => done),
    [1, 2, 3, 4, 5],
  );
  assert.ok(progress.every(([, total]) => total === 5));
});

test("进度回调自己抛错不会影响任务", async () => {
  const results = await mapWithConcurrency([1, 2], 1, async (item) => item, () => {
    throw new Error("回调炸了");
  });
  assert.equal(results[0].value, 1);
  assert.equal(results[1].value, 2);
});

test("空输入直接返回空数组，不调用 worker", async () => {
  let called = false;
  const results = await mapWithConcurrency([], 4, async () => {
    called = true;
  });
  assert.deepEqual(results, []);
  assert.equal(called, false);
});

test("并发数非法时回落到 1，且不会超过任务数", async () => {
  for (const limit of [0, -5, NaN, undefined, "abc"]) {
    const results = await mapWithConcurrency([1, 2], limit, async (item) => item);
    assert.deepEqual(
      results.map((result) => result.value),
      [1, 2],
      `limit=${limit} 时结果不对`,
    );
  }

  let peak = 0;
  let active = 0;
  await mapWithConcurrency([1, 2], 100, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(1);
    active -= 1;
  });
  assert.equal(peak, 2, "并发数不该超过任务数");
});

// ============================================================
// 串行队列
// ============================================================

test("排队的任务严格逐个执行，不会重叠", async () => {
  const enqueue = createSerialQueue();
  const order = [];
  let active = 0;
  let overlapped = false;

  const task = (id, ms) => async () => {
    active += 1;
    if (active > 1) overlapped = true;
    await delay(ms);
    order.push(id);
    active -= 1;
    return id;
  };

  // 先入队的故意最慢，若队列失效，快的会先跑完
  await Promise.all([
    enqueue(task("a", 20)),
    enqueue(task("b", 10)),
    enqueue(task("c", 0)),
  ]);

  assert.equal(overlapped, false, "出现了重叠执行，临界区没有被保护住");
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("读—改—写并发时不会丢更新", async () => {
  const enqueue = createSerialQueue();
  let store = {};

  // 模拟缓存的读—改—写：读出快照、改一个键、整份写回
  const update = (key) =>
    enqueue(async () => {
      const snapshot = store;
      await delay(5); // 读和写之间的空窗，正是覆盖发生的地方
      store = { ...snapshot, [key]: true };
    });

  await Promise.all([update("a"), update("b"), update("c")]);
  assert.deepEqual(Object.keys(store).sort(), ["a", "b", "c"]);
});

test("队列中某个任务失败后，后续任务照常执行", async () => {
  const enqueue = createSerialQueue();
  const done = [];

  const failing = enqueue(async () => {
    throw new Error("中间这个失败了");
  });
  await assert.rejects(failing, /中间这个失败了/);

  await enqueue(async () => {
    done.push("之后的任务");
  });
  assert.deepEqual(done, ["之后的任务"]);
});

test("调用方能拿到各自任务的返回值与错误", async () => {
  const enqueue = createSerialQueue();
  assert.equal(await enqueue(async () => "结果"), "结果");
  await assert.rejects(enqueue(async () => {
    throw new Error("我的错误");
  }), /我的错误/);
});

// ============================================================
// 在途去重表（截图手记并发补齐的防线）
// ============================================================

test("同 key 并发只发一个请求，后来者共享结果", async () => {
  const run = createDedupMap();
  let calls = 0;
  const task = () => {
    calls += 1;
    return delay(20).then(() => "字幕");
  };

  const all = await Promise.all([run("yt:v1", task), run("yt:v1", task), run("yt:v1", task)]);
  assert.equal(calls, 1, "三个并发只有一个真实请求");
  assert.deepEqual(all, ["字幕", "字幕", "字幕"], "共享同一个结果");
});

test("条目完成后清除，下一次重新发起", async () => {
  const run = createDedupMap();
  let calls = 0;
  const task = () => {
    calls += 1;
    return Promise.resolve("ok");
  };

  await run("k", task);
  await run("k", task);
  assert.equal(calls, 2, "完成后条目清除，第二次是全新请求");
});

test("失败不缓存：后来者拿到的是拒绝，且能立刻重试", async () => {
  const run = createDedupMap();
  let calls = 0;
  const task = () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("provider 抖了")) : Promise.resolve("重试成功");
  };

  // first 与 second 并发：second 共享 first 的在途请求，一起被拒绝。
  const first = run("k", task).catch((error) => error.message);
  const second = run("k", task).catch(() => "rejected");
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, "provider 抖了");
  assert.equal(b, "rejected", "共享者拿到的是同一个拒绝");
  assert.equal(calls, 1, "并发期间仍然只有一个真实请求");
  // 失败后条目清除：第三次调用重新发起 → 成功。
  const third = await run("k", task);
  assert.equal(third, "重试成功");
  assert.equal(calls, 2);
});

test("不同 key 互不干扰", async () => {
  const run = createDedupMap();
  let calls = 0;
  const task = () => {
    calls += 1;
    return delay(10).then(() => "v");
  };

  await Promise.all([run("a", task), run("b", task)]);
  assert.equal(calls, 2, "不同视频各发各的");
});
