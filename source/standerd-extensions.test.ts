import { describe, it, expect, vi } from "vitest";
import { createCancelScope } from "./standard-extensions";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createCancelScope", () => {
    it("キャンセルされた戻り値は undefined になること", async () => {
        const runTask = createCancelScope();

        const firstTask = async (signal: AbortSignal) => {
            await delay(50);
            signal.throwIfAborted();
            return "firstTaskResult";
        };

        const secondTask = async () => {
            await delay(10);
            return "secondTaskResult";
        };
        const promise1 = runTask(firstTask);
        const promise2 = runTask(secondTask);
        const results = await Promise.all([promise1, promise2]);

        expect(results).toStrictEqual([undefined, "secondTaskResult"]);
    });

    it("単一のタスクが正常に完了すること", async () => {
        const runTask = createCancelScope();
        const task = vi.fn(async () => {
            await delay(10);
        });

        await expect(runTask(task)).resolves.toBeUndefined();
        expect(task).toHaveBeenCalledTimes(1);
    });

    it("新しいタスクが開始されたとき、前のタスクのキャンセルは resolve 扱いになること", async () => {
        const runTask = createCancelScope();

        let firstTaskFinished = false;
        let secondTaskFinished = false;

        const firstTask = async (signal: AbortSignal) => {
            await delay(50);
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            firstTaskFinished = true;
        };

        const secondTask = async () => {
            await delay(10);
            secondTaskFinished = true;
        };

        // 1つ目のタスクを開始（待機せずに次へ）
        const promise1 = runTask(firstTask);
        // 2つ目のタスクを開始（これにより1つ目がキャンセルされる）
        const promise2 = runTask(secondTask);

        // 両方の完了を待機
        await Promise.all([promise1, promise2]);

        // 検証
        expect(firstTaskFinished).toBe(false); // キャンセルされたので true にならない
        expect(secondTaskFinished).toBe(true); // 2つ目は完了する
        // promise1 が reject されず、resolve されていることが重要
        await expect(promise1).resolves.toBeUndefined();
    });

    it("タスク内で発生した通常のエラーは呼び出し元に throw されること", async () => {
        const runTask = createCancelScope();
        const errorMessage = "Custom Business Error";

        const faultyTask = async () => {
            throw new Error(errorMessage);
        };

        await expect(runTask(faultyTask)).rejects.toThrow(errorMessage);
    });

    it("AbortSignal が正しくタスクに渡されていること", async () => {
        const runTask = createCancelScope();

        await runTask(async (signal) => {
            expect(signal).toBeInstanceOf(AbortSignal);
            expect(signal.aborted).toBe(false);
        });
    });
});
