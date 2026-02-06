// spell-checker: ignore Lngs Quadkey

import type { Tagged } from "./standard-extensions";
import { S2, type LatLng as S2LatLng } from "./s2";
import type { Increment } from "./nat";

/** `S2Cell.prototype.toString` で得られる ID */
export type CellId<TLevel extends number> = Tagged<string, TLevel>;
export type Cell17Id = CellId<17>;
export type Cell14Id = CellId<14>;

export interface Cell<TLevel extends number> {
    readonly face: number;
    readonly ij: readonly [number, number];
    readonly level: number;
    getLatLng(): S2LatLng;
    getCornerLatLngs(): [S2LatLng, S2LatLng, S2LatLng, S2LatLng];
    getNeighbors(): [Cell<TLevel>, Cell<TLevel>, Cell<TLevel>, Cell<TLevel>];
    toString(): CellId<TLevel>;
    toHilbertQuadkey(): QuadKey<TLevel>;
}

export type QuadKey<TLevel extends number> = Tagged<
    `${number}/${number}`,
    TLevel
>;
export type S2BigId<TLevel extends number> = Tagged<bigint, TLevel>;

export function createCellFromCoordinates<TLevel extends number>(
    latLng: S2LatLng,
    level: TLevel,
) {
    return S2.S2Cell.FromLatLng(latLng, level) as Cell<TLevel>;
}
export function createCellFromKey<TLevel extends number>(key: QuadKey<TLevel>) {
    return S2.S2Cell.FromHilbertQuadKey(key) as Cell<TLevel>;
}

export function getCellId<TLevel extends number>(
    latLng: S2LatLng,
    level: TLevel,
) {
    return createCellFromCoordinates(latLng, level).toString();
}

const indexes = Object.freeze(["0", "1", "2", "3"] as const);
export function getChildCells<TLevel extends number>(parentCell: Cell<TLevel>) {
    const currentLevel = parentCell.level;
    if (S2.MAX_LEVEL <= currentLevel) {
        throw new Error("Cannot get children for a cell at MAX_LEVEL (30).");
    }

    const parentKey = parentCell.toHilbertQuadkey();

    const result = [] as unknown as [
        Cell<Increment<TLevel>>,
        Cell<Increment<TLevel>>,
        Cell<Increment<TLevel>>,
        Cell<Increment<TLevel>>,
    ];
    for (const suffix of indexes) {
        const childKey = parentKey + suffix;
        result.push(createCellFromKey(childKey as QuadKey<Increment<TLevel>>));
    }
    return result;
}

/** e.g: `"0059fb1"` */
export type S2Token<TLevel extends number> = Tagged<string, TLevel>;
export function tokenToCell<TLevel extends number>(
    token: S2Token<TLevel>,
): Cell<TLevel> {
    const hex = token.padEnd(16, "0");
    const id = BigInt(`0x${hex}`) as S2BigId<TLevel>;
    const key = bigIdToKey(id);
    return S2.S2Cell.FromHilbertQuadKey(key) as Cell<TLevel>;
}

const buffer64 = new BigUint64Array(1);
const view32 = new Uint32Array(buffer64.buffer);
function trailingZeros64(id: bigint) {
    buffer64[0] = id;
    const low = view32[0]!;
    const high = view32[1]!;
    if (low !== 0) {
        return 31 - Math.clz32(low & -low);
    }
    if (high !== 0) {
        return 32 + (31 - Math.clz32(high & -high));
    }
    return 64;
}

const quadsBuffer: (string | number)[] = [];
export function bigIdToKey<TLevel extends number>(
    id: S2BigId<TLevel>,
): QuadKey<TLevel> {
    buffer64[0] = id;
    const low = view32[0]!;
    const high = view32[1]!;

    // Face: 最上位 3ビット (63, 62, 61)
    const face = high >>> 29;
    const level = getLevelOfBigId(id);

    quadsBuffer.length = 0;
    quadsBuffer.push(face, "/");

    // レベル 1 から順に Quad (2bitずつ) を抽出
    for (let k = 1; k <= level; k++) {
        const p = 61 - 2 * k;
        let quad: number;

        if (p >= 32) {
            quad = (high >>> (p - 32)) & 3;
        } else if (p === 31) {
            // high の 0ビット目と low の 31ビット目
            quad = ((high & 1) << 1) | (low >>> 31);
        } else {
            quad = (low >>> p) & 3;
        }

        quadsBuffer.push(quad);
    }

    return quadsBuffer.join("") as QuadKey<TLevel>;
}

function getLevelOfBigId(id: bigint) {
    const s = trailingZeros64(id);
    if (s > 60 || (s & 1) !== 0) {
        throw new Error("Invalid S2CellID");
    }
    return (60 - s) >> 1;
}
