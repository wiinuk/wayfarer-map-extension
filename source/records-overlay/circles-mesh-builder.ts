//spell:words Wayspot
import { latLngToWorldPoint, type Point } from "../geometry";
import type { LatLng } from "../s2";
import { asUntypedGeometry, newGeometry } from "../typed-pixi-shader";
import type { CanvasRenderer } from "./canvas-renderer";
import { normalizeColor } from "./colors";
import type { WayspotOptions } from "./options";

export type CirclesMeshBuilder = ReturnType<typeof newCirclesMeshBuilder>;
const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
] as const;
export function newCirclesMeshBuilder(
    renderer: CanvasRenderer,
    cell14Center: Point,
) {
    const { PIXI, circleShader: shader, _point_result_cache } = renderer;
    const { x: cellX, y: cellY } = cell14Center;

    const quadPositions: number[] = [];
    const centers: number[] = [];
    const indices: number[] = [];
    const radiuses: number[] = [];
    const strokeWidths: number[] = [];
    const fillColors: number[] = [];
    const strokeColors: number[] = [];

    function add(
        center: LatLng,
        radius: number,
        options: WayspotOptions,
        strength: number,
    ) {
        const strokeWidth = options.borderWidth;
        const fillColor = normalizeColor(options.fillColor);
        const strokeColor = normalizeColor(options.borderColor);

        const vOffset = radiuses.length;

        const { lat, lng } = center;
        const { x, y } = latLngToWorldPoint(lat, lng, _point_result_cache);
        for (let i = 0; i < corners.length; i++) {
            const [qx, qy] = corners[i]!;
            quadPositions.push(qx, qy);
            centers.push(x - cellX, y - cellY);
            radiuses.push(radius);
            strokeWidths.push(strokeWidth);
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
        }
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
            typeof import("./circle.vert"),
            typeof import("./circle.frag")
        >(PIXI);
        geometry.addAttribute("aQuadPos", {
            buffer: new Float32Array(quadPositions),
            format: "float32x2",
        });
        geometry.addIndex(indices);

        geometry.addAttribute("aCenter", {
            buffer: new Float32Array(centers),
            format: "float32x2",
        });
        geometry.addAttribute("aRadius", {
            buffer: new Float32Array(radiuses),
            format: "float32",
        });

        geometry.addAttribute("aFillColor", {
            buffer: new Float32Array(fillColors),
            format: "float32x4",
        });
        geometry.addAttribute("aStrokeColor", {
            buffer: new Float32Array(strokeColors),
            format: "float32x4",
        });
        geometry.addAttribute("aStrokeWidth", {
            buffer: new Float32Array(strokeWidths),
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
