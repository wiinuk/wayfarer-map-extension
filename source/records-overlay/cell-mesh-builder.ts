import { latLngToWorldPoint, type Point } from "../geometry";
import type { LatLng } from "../s2";
import { raise } from "../standard-extensions";
import { asUntypedGeometry, newGeometry } from "../typed-pixi-shader";
import type { CanvasRenderer } from "./canvas-renderer";
import { normalizeColor } from "./colors";
import type { Cell17Options } from "./options";

export type CellMeshBuilder = ReturnType<typeof newCellMeshBuilder>;
const cornerCount = 4;
export function newCellMeshBuilder(
    renderer: CanvasRenderer,
    cell14Center: Point,
) {
    const { x: cellX, y: cellY } = cell14Center;
    const { PIXI, shader, _point_result_cache } = renderer;
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const fillColors: number[] = [];
    const strokeColors: number[] = [];
    const lineWidths: number[] = [];
    function add(
        cornerPath: readonly LatLng[],
        options: Cell17Options,
        strength: number,
    ) {
        if (cornerPath.length !== cornerCount) return raise`internal error`;

        const fillColor = normalizeColor(options.fillColor);
        const strokeColor = normalizeColor(options.strokeColor);
        const lineWidth = options.strokeWeight;

        const vOffset = lineWidths.length;
        for (let i = 0; i < cornerCount; i++) {
            const { lat, lng } = cornerPath[i]!;
            const { x, y } = latLngToWorldPoint(lat, lng, _point_result_cache);
            vertices.push(x - cellX, y - cellY);
            fillColors.push(
                fillColor[0],
                fillColor[1],
                fillColor[2],
                fillColor[3] * strength,
            );
            strokeColors.push(
                strokeColor[0],
                strokeColor[1],
                strokeColor[2],
                strokeColor[3] * strength,
            );
            lineWidths.push(lineWidth);
        }
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        indices.push(
            vOffset + 0,
            vOffset + 1,
            vOffset + 2,
            vOffset + 0,
            vOffset + 2,
            vOffset + 3,
        );
    }
    function bake() {
        const geometry = newGeometry<
            typeof import("./cell.vert"),
            typeof import("./cell.frag")
        >(PIXI);
        geometry.addAttribute("aPosition", {
            buffer: new Float32Array(vertices),
            format: "float32x2",
        });
        geometry.addAttribute("aUV", {
            buffer: new Float32Array(uvs),
            format: "float32x2",
        });
        geometry.addIndex(indices);

        geometry.addAttribute("aFillColor", {
            buffer: new Float32Array(fillColors),
            format: "float32x4",
        });
        geometry.addAttribute("aStrokeColor", {
            buffer: new Float32Array(strokeColors),
            format: "float32x4",
        });
        geometry.addAttribute("aLineWidth", {
            buffer: new Float32Array(lineWidths),
            format: "float32",
        });

        const mesh = new PIXI.Mesh({
            geometry: asUntypedGeometry(geometry),
            shader,
        });
        mesh.position.set(cellX, cellY);
        return mesh;
    }
    return {
        add,
        bake,
    };
}
