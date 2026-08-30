import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { createRemote } from "./remote";

describe("createAsyncQueue", () => {
    it("処理失敗時にバッチが消失せず再試行されること", async () => {
        const consume = vi
            .fn()
            .mockRejectedValueOnce(new Error("first fail"))
            .mockResolvedValueOnce(undefined);

        const queue = createAsyncQueue<number>(
            async (items) => {
                await consume(items);
            },
            () => undefined,
            { batchSize: 10, delayMilliseconds: 0 },
        );

        queue.push(1);

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(consume).toHaveBeenCalledTimes(2);
        expect(consume.mock.calls[0]?.[0]).toEqual([1]);
        expect(consume.mock.calls[1]?.[0]).toEqual([1]);
    });
});

describe("createRemote", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("保存失敗時に fetch-error イベントを発火すること", async () => {
        const errors: Array<{ message: string; operation: string }> = [];
        vi.stubGlobal("GM", {
            xmlHttpRequest: vi.fn(() => Promise.reject(new Error("network"))),
        });

        const remote = createRemote(() => undefined, 0);
        remote.events.addEventListener("fetch-error", (event) => {
            errors.push({
                message: event.detail.message,
                operation: event.detail.operation,
            });
        });

        remote.set(
            {
                type: "route",
                "user-id": "user-1",
                "route-id": "draft-1",
                "route-name": "draft",
                coordinates: "lat,lng",
                description: "",
                note: "",
                data: "{}",
            },
            "https://example.com",
        );

        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(errors).toHaveLength(1);
        expect(errors[0]?.operation).toBe("set");
        expect(errors[0]?.message).toContain("保存に失敗しました");
    });
});
