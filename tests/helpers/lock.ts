// 同じマシンで流れているテスト（ほかのセッションの `pnpm test` も含む）の間で、順番を守るためのロック（README の「テスト」）。
// 共有のローカル DB で、矢書全体の状態（全員の上限など）を一時的に変えるテストを、1 つずつ流すために使う。
// ロックはディレクトリ（mkdir はどちらか 1 つだけが成功する）で、中に持ち主のプロセスの番号を書く。
// 持ち主のプロセスがもういない、または決まった時間を過ぎたロックは、残ったものとみなして取り直す（落ちても残らない）
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

const ROOT = join(tmpdir(), "yabumi-test-locks");
// これより長く持ったままのロックは、残ったものとみなす（1 つのテストのファイルの時間より十分に長く）
const STALE_MS = 5 * 60_000;

type Owner = { pid: number; at: number };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM はほかの利用者のプロセスで、生きている
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(dir: string): Owner | null {
  try {
    return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")) as Owner;
  } catch {
    return null;
  }
}

function tryTake(dir: string): boolean {
  try {
    mkdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const owner = readOwner(dir);
    // 持ち主を書く前の一瞬（owner.json がまだない）は、取られているとみなす。ただし古ければ取り直す
    const stale = owner ? !alive(owner.pid) || Date.now() - owner.at > STALE_MS : false;
    if (!stale) return false;
    rmSync(dir, { recursive: true, force: true });
    try {
      mkdirSync(dir);
    } catch {
      return false;
    }
  }
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() } satisfies Owner));
  return true;
}

// ロックを取るまで待つ。返した関数で外す
export async function acquireLock(name: string, { timeoutMs = 4 * 60_000, pollMs = 200 } = {}): Promise<() => void> {
  mkdirSync(ROOT, { recursive: true });
  const dir = join(ROOT, name);
  const deadline = Date.now() + timeoutMs;
  // ディレクトリだけ残って中身がない（書く前に落ちた）ときのために、初めて見た時刻を覚えて、古ければ消す
  let emptySince: number | null = null;
  while (!tryTake(dir)) {
    if (!readOwner(dir)) {
      emptySince ??= Date.now();
      if (Date.now() - emptySince > 10_000) rmSync(dir, { recursive: true, force: true });
    } else emptySince = null;
    if (Date.now() > deadline) throw new Error(`テストのロック ${name} を ${timeoutMs / 1000} 秒待っても取れませんでした（${dir}）`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (readOwner(dir)?.pid === process.pid) rmSync(dir, { recursive: true, force: true });
  };
  // プロセスが終わるときにも外す（落ちたときは、上の「持ち主がもういない」で外れる）
  process.once("exit", release);
  return release;
}

// n 個の席のどれかを取るまで待つ（同じマシンで同時に流れる数を n までにする）。返した関数で外す
export async function acquireSlot(prefix: string, n: number, { timeoutMs = 10 * 60_000, pollMs = 100 } = {}): Promise<() => void> {
  mkdirSync(ROOT, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  // 席ごとに、持ち主のいない空のディレクトリ（書く前に落ちた）を初めて見た時刻
  const emptySince = new Map<string, number>();
  for (;;) {
    // 毎回ちがう席から試す（同じ席に集まらないように）
    const start = Math.floor(Math.random() * n);
    for (let k = 0; k < n; k++) {
      const dir = join(ROOT, `${prefix}-${(start + k) % n}`);
      if (tryTake(dir)) {
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          if (readOwner(dir)?.pid === process.pid) rmSync(dir, { recursive: true, force: true });
        };
        process.once("exit", release);
        return release;
      }
      if (!readOwner(dir)) {
        const since = emptySince.get(dir) ?? Date.now();
        emptySince.set(dir, since);
        if (Date.now() - since > 10_000) rmSync(dir, { recursive: true, force: true });
      } else emptySince.delete(dir);
    }
    if (Date.now() > deadline) throw new Error(`テストの席（${prefix}、${n} 個）が ${timeoutMs / 1000} 秒たっても空きませんでした（${ROOT}）`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// テストのファイルの先頭（ほかの beforeAll より前）で呼ぶ。そのファイルを流す間、同じ名前のロックを持つ（ファイルの最初から最後まで）。
// 同じ名前のロックを使うファイルは、ほかのセッションの分も含めて 1 つずつ流れる
export function holdLockDuringFile(name: string) {
  let release: () => void = () => {};
  // ロックを待つ時間（ほかのセッションの同じファイルが終わるまで）の分、フックの時間の上限を延ばす
  beforeAll(async () => {
    release = await acquireLock(name);
  }, 5 * 60_000);
  afterAll(() => release());
}
