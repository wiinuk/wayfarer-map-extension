// spell-checker: ignore Quadkey
import { describe, it, expect } from "vitest";
import {
    bigIdToKey,
    createCellFromKey,
    getChildCells,
    type QuadKey,
    type S2BigId,
} from "./typed-s2cell";
import * as fc from "fast-check";

function keyToIdBigInt(key: string): S2BigId<number> {
    const [faceStr, quads] = key.split("/");
    if (faceStr === undefined) throw new Error("Invalid key format");

    // 1. Face (最上位 3ビット: 61-63bit)
    let id = BigInt(faceStr) << 61n;

    // 2. Quads (レベル1から順に 2ビットずつ配置)
    const level = quads ? quads.length : 0;
    for (let i = 0; i < level; i++) {
        const char = quads![i];
        const quadValue = BigInt(char!);

        // レベル k のビット位置 P は 61 - 2*k
        // i は 0 始まりなので、k = i + 1
        const shift = BigInt(61 - 2 * (i + 1));
        id |= quadValue << shift;
    }

    // 3. Sentinel Bit (最後に現れる '1')
    // レベル L のとき、ビット位置は 60 - 2*L
    const sentinelShift = BigInt(60 - 2 * level);
    id |= 1n << sentinelShift;

    return id as S2BigId<number>;
}
function generateTestIDs() {
    const testCases: { id: bigint; description: string }[] = [];

    // 1. 各 Face の Level 0 (Sentinel bit は 60ビット目)
    for (let face = 0; face <= 5; face++) {
        testCases.push({
            id: (BigInt(face) << 61n) | (1n << 60n),
            description: `Face ${face} Level 0`,
        });
    }

    // 2. 境界跨ぎが発生する Level 15 のテスト
    // Level 15 の Sentinel bit は 61 - 2*15 - 1 = 30ビット目
    // Quad 15 が境界 (bit 31-32) に位置する
    const baseFace = 1n << 61n;
    const level15Sentinel = 1n << 30n;

    // 全ての Quad パターン (0,1,2,3) を Level 15 の位置に埋め込む
    for (let q = 0n; q <= 3n; q++) {
        // bit 31-32 に q を配置
        const id = baseFace | (q << 31n) | level15Sentinel;
        testCases.push({
            id,
            description: `Level 15 with boundary quad: ${q}`,
        });
    }

    // 3. 最大レベル (Level 30)
    // Sentinel bit は 0ビット目 (LSB)
    testCases.push({
        id: (3n << 61n) | 1n,
        description: "Face 3 Level 30 (Max Level)",
    });

    // 4. 特定のパターン (例: Face 0, All quads are '3')
    let allThrees = 0n << 61n;
    for (let i = 1; i <= 30; i++) {
        allThrees |= 3n << BigInt(61 - 2 * i);
    }
    allThrees |= 1n; // Sentinel for level 30
    testCases.push({
        id: allThrees,
        description: "Face 0 Level 30 All Quads '3'",
    });

    return testCases.map(({ id, description }) => ({
        id: id as S2BigId<number>,
        description,
    }));
}

describe("S2CellID Boundary Tests", () => {
    it("tests", () => {
        for (const { id, description } of generateTestIDs()) {
            const key = bigIdToKey(id);
            expect(keyToIdBigInt(key), description).toBe(id);
        }
    });
    it("境界付近 (Level 14 と 15) の変換テスト", () => {
        // Level 14 は high (32-33bit) に収まる最後
        const key14 = "3/12301230123012";
        const id14 = keyToIdBigInt(key14);
        expect(bigIdToKey(id14)).toBe(key14);

        // Level 15 は low (30-31bit) に入る最初
        // ここで 32bit 境界を跨いでいないことを確認
        const key15 = "3/123012301230123";
        const id15 = keyToIdBigInt(key15);
        expect(bigIdToKey(id15)).toBe(key15);
    });

    it("Face 全種類 (0-5) のテスト", () => {
        for (let f = 0; f <= 5; f++) {
            const key = `${f}/123`;
            const id = keyToIdBigInt(key);
            // Faceが3bit(奇数)でも、bit60が空いているため
            // high >>> 29 で正しく face だけが抽出されるはず
            expect(bigIdToKey(id)).toBe(key);
        }
    });

    it("最大レベル (Level 30) のテスト", () => {
        const fullQuads = "3".repeat(30);
        const key30 = `1/${fullQuads}`;
        const id30 = keyToIdBigInt(key30);
        // 最後の Quad は low の bit 1, 0 に位置する
        expect(bigIdToKey(id30)).toBe(key30);
    });

    it("最小レベル (Level 0) のテスト", () => {
        const key0 = "5/";
        const id0 = keyToIdBigInt(key0);
        expect(bigIdToKey(id0)).toBe(key0);
    });

    it("32bit境界付近のビット化けがないか検証", () => {
        // bit 32 (highの最下位) と bit 31 (lowの最上位)
        // 10 (2) と 01 (1) を交互に入れて境界での干渉をチェック
        const key = "0/2222222222222211111111111111"; // 14個の2 と 14個の1
        const id = keyToIdBigInt(key);
        expect(bigIdToKey(id)).toBe(key);
    });
});

describe("S2CellID Property-based Testing", () => {
    it("任意の Face と Level で idToKey と keyToId が互換性を持つこと", () => {
        fc.assert(
            fc.property(
                // Face: 0 ~ 5
                fc.integer({ min: 0, max: 5 }),
                // Level: 0 ~ 30
                fc.integer({ min: 0, max: 30 }),
                // 各 Quad の値 (0~3) の配列
                fc.array(fc.integer({ min: 0, max: 3 }), {
                    minLength: 0,
                    maxLength: 30,
                }),
                (face, level, quads) => {
                    // level に合わせて quads 配列を調整
                    const targetQuads = quads.slice(0, level).join("");
                    const key = `${face}/${targetQuads}`;

                    // 相互変換の検証
                    const id = keyToIdBigInt(key);
                    const recoveredKey = bigIdToKey(id);

                    expect(recoveredKey).toBe(key);
                },
            ),
            { numRuns: 1000 }, // 1000通りのランダムパターンでテスト
        );
    });

    function bigUintN(n: number): fc.Arbitrary<bigint> {
        return fc.bigInt({ min: 0n, max: (1n << BigInt(n)) - 1n });
    }
    it("無作為な 64bit bigint からの変換が常に一貫していること", () => {
        fc.assert(
            fc.property(
                // 有効な S2CellID の範囲（FaceビットとSentinelビットの制約内）を生成
                bigUintN(64),
                (randomId) => {
                    try {
                        // trailingZeros64 の仕様に合うもの（末尾に1があり、それ以降が偶数個の0）
                        // だけをテスト対象とする（それ以外は関数が Error を投げるため）
                        const key = bigIdToKey(randomId as S2BigId<number>);
                        const backToId = keyToIdBigInt(key);

                        expect(backToId).toBe(randomId);
                    } catch (e) {
                        // Invalid S2CellID のエラーは許容（ランダムな値なので）
                        if (
                            e instanceof Error &&
                            e.message === "Invalid S2CellID"
                        ) {
                            return true;
                        }
                        throw e;
                    }
                },
            ),
        );
    });
});

describe("getChildCells", () => {
    // 1. 基本的な正常系のテスト
    it("should return 4 child cells with level incremented by 1", () => {
        // Face 1, Level 5 のセルを仮定
        const face = 1;
        const level = 5;
        const parentKey = `${face}/01230` as QuadKey<number>;
        const parentCell = createCellFromKey(parentKey);

        const children = getChildCells(parentCell);

        // 子セルは必ず4つ
        expect(children).toHaveLength(4);

        children.forEach((child, index) => {
            // レベルが +1 されているか
            expect(child.level).toBe(level + 1);

            // キーが親のキー + インデックス ("0", "1", "2", "3") になっているか
            const expectedKey = `${parentKey}${index}`;
            expect(child.toHilbertQuadkey()).toBe(expectedKey);
        });
    });

    // 2. Face 直下 (Level 0) からの展開テスト
    it("should correctly generate children from a level 0 cell", () => {
        const parentCell = createCellFromKey("3/" as QuadKey<0>); // Face 3, Level 0
        const children = getChildCells(parentCell);

        expect(children[0].toHilbertQuadkey()).toBe("3/0");
        expect(children[3].toHilbertQuadkey()).toBe("3/3");
    });

    // 3. エラー系：MAX_LEVEL での呼び出し
    it("should throw an error when called on a cell at MAX_LEVEL (30)", () => {
        // Level 30 のキーを作成 (Face 1 + "0"を30個)
        const maxLevelKey = "1/" + "0".repeat(30);
        const parentCell = createCellFromKey(maxLevelKey as QuadKey<30>);

        expect(() => {
            getChildCells(parentCell);
        }).toThrow("Cannot get children for a cell at MAX_LEVEL (30).");
    });

    // 4. 型の整合性（ランタイムチェック）
    it("should return unique cells for each quad index", () => {
        const parentCell = createCellFromKey("0/12" as QuadKey<number>);
        const children = getChildCells(parentCell);

        const keySet = new Set(children.map((c) => c.toHilbertQuadkey()));
        expect(keySet.size).toBe(4);
    });
});
