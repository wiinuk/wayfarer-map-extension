import { describe, it, expect, beforeEach } from "vitest";
import { createCollisionChecker } from "./collision-checker";

describe("createCollisionChecker", () => {
    let checker: ReturnType<typeof createCollisionChecker>;

    beforeEach(() => {
        checker = createCollisionChecker();
    });

    it("初期状態では衝突しないこと", () => {
        const box = {
            centerX: 100,
            centerY: 100,
            width: 50,
            height: 50,
            key: 1,
        };
        expect(checker.check(box)).toBe(false);
    });

    it("離れた位置にあるボックス同士は衝突しないこと", () => {
        checker.addBox({
            centerX: 0,
            centerY: 0,
            width: 50,
            height: 50,
            key: 1,
        });

        const newBox = {
            centerX: 100,
            centerY: 100,
            width: 50,
            height: 50,
            key: 2,
        };
        expect(checker.check(newBox)).toBe(false);
    });

    it("重なっているボックス同士は衝突と判定されること", () => {
        // 中心(50,50) 幅50 => 範囲は x:25~75, y:25~75
        checker.addBox({
            centerX: 50,
            centerY: 50,
            width: 50,
            height: 50,
            key: 1,
        });

        // 中心(70,70) 幅50 => 範囲は x:45~95, y:45~95 (重なっている)
        const newBox = {
            centerX: 70,
            centerY: 70,
            width: 50,
            height: 50,
            key: 2,
        };
        expect(checker.check(newBox)).toBe(true);
    });

    it("key が同じ場合は自分自身とみなし、衝突から除外すること", () => {
        const box = {
            centerX: 50,
            centerY: 50,
            width: 50,
            height: 50,
            key: "same-key",
        };
        checker.addBox(box);

        // 全く同じ座標だが、keyが同じなので false になるべき
        expect(checker.check(box)).toBe(false);
    });

    it("エッジ（端）がちょうど接している場合は衝突とみなさないこと", () => {
        // x: 0~50
        checker.addBox({
            centerX: 25,
            centerY: 25,
            width: 50,
            height: 50,
            key: 1,
        });

        // x: 50~100 (50の地点で接している)
        const newBox = {
            centerX: 75,
            centerY: 25,
            width: 50,
            height: 50,
            key: 2,
        };
        expect(checker.check(newBox)).toBe(false);
    });

    it("複数のボックスのうち、1つでも重なれば衝突と判定されること", () => {
        checker.addBox({
            centerX: 0,
            centerY: 0,
            width: 10,
            height: 10,
            key: 1,
        });
        checker.addBox({
            centerX: 100,
            centerY: 100,
            width: 10,
            height: 10,
            key: 2,
        });

        const newBox = {
            centerX: 105,
            centerY: 105,
            width: 10,
            height: 10,
            key: 3,
        };
        expect(checker.check(newBox)).toBe(true);
    });
});
