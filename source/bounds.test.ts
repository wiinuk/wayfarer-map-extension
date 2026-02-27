import { describe, it, expect } from "vitest";
import { contains, intersects } from "./bounds";

describe("LatLngBounds Tests", () => {
    describe("contains", () => {
        // 1. 通常の矩形（東京周辺など）
        const normalBounds = {
            sw: { lat: 35.0, lng: 139.0 },
            ne: { lat: 36.0, lng: 140.0 },
        };

        // 2. 日付変更線をまたぐ矩形（170° to -170°）
        const wrappingBounds = {
            sw: { lat: -10.0, lng: 170.0 },
            ne: { lat: 10.0, lng: -170.0 },
        };

        it("通常の範囲内で点が含まれるか正しく判定できること", () => {
            expect(contains(normalBounds, { lat: 35.5, lng: 139.5 })).toBe(
                true,
            );
            expect(contains(normalBounds, { lat: 35.0, lng: 139.0 })).toBe(
                true,
            ); // 境界線上
            expect(contains(normalBounds, { lat: 37.0, lng: 139.5 })).toBe(
                false,
            ); // 緯度外
            expect(contains(normalBounds, { lat: 35.5, lng: 138.0 })).toBe(
                false,
            ); // 経度外
        });

        it("日付変更線をまたぐ範囲で点が含まれるか正しく判定できること", () => {
            expect(contains(wrappingBounds, { lat: 0, lng: 175.0 })).toBe(true);
            expect(contains(wrappingBounds, { lat: 0, lng: -175.0 })).toBe(
                true,
            );
            expect(contains(wrappingBounds, { lat: 0, lng: 0 })).toBe(false); // 地球の反対側
        });
    });

    describe("intersects", () => {
        it("通常の矩形同士の交差を判定できること", () => {
            const b1 = { sw: { lat: 0, lng: 0 }, ne: { lat: 10, lng: 10 } };
            const b2 = { sw: { lat: 5, lng: 5 }, ne: { lat: 15, lng: 15 } }; // 重なる
            const b3 = { sw: { lat: 11, lng: 11 }, ne: { lat: 20, lng: 20 } }; // 離れている

            expect(intersects(b1, b2)).toBe(true);
            expect(intersects(b1, b3)).toBe(false);
        });

        it("一方が日付変更線をまたいでいる場合の交差を判定できること", () => {
            // 170° 〜 -170° (日付変更線をまたぐ20度幅)
            const wrapping = {
                sw: { lat: -10, lng: 170 },
                ne: { lat: 10, lng: -170 },
            };

            // パターンA: 西側（東経）で重なる
            const overlapEast = {
                sw: { lat: -5, lng: 175 },
                ne: { lat: 5, lng: 180 },
            };
            // パターンB: 東側（西経）で重なる
            const overlapWest = {
                sw: { lat: -5, lng: -180 },
                ne: { lat: 5, lng: -175 },
            };
            // パターンC: 全く関係ない場所（日本付近）
            const noOverlap = {
                sw: { lat: 30, lng: 130 },
                ne: { lat: 40, lng: 140 },
            };

            expect(intersects(wrapping, overlapEast)).toBe(true);
            expect(intersects(wrapping, overlapWest)).toBe(true);
            expect(intersects(wrapping, noOverlap)).toBe(false);
        });

        it("【エッジケース】一方がもう一方を完全に内包している場合", () => {
            // 世界をほぼ半周する大きな範囲
            const largeWrapping = {
                sw: { lat: -20, lng: 160 },
                ne: { lat: 20, lng: -160 },
            };
            // 日付変更線付近にちょこんと存在する小さな範囲（角は largeWrapping に含まれない）
            const smallInside = {
                sw: { lat: -5, lng: 175 },
                ne: { lat: 5, lng: 176 },
            };

            // 前回のレビューで指摘した「角の包含判定」だけだと失敗する可能性があるケース
            expect(intersects(largeWrapping, smallInside)).toBe(true);
        });

        it("両方が日付変更線をまたいでいる場合", () => {
            const b1 = {
                sw: { lat: -10, lng: 170 },
                ne: { lat: 10, lng: -170 },
            };
            const b2 = {
                sw: { lat: -10, lng: 175 },
                ne: { lat: 10, lng: -165 },
            };

            expect(intersects(b1, b2)).toBe(true);
        });
    });
});
