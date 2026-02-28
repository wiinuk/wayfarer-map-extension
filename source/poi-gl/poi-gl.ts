import { Atlas } from "./atlas";
import {
    createDynamicBuffer,
    createLocations,
    createProg,
    type TypedLocation,
    type TypedWebGLRenderingContext,
    type VertexAttributeArrayTypes,
} from "./webgl-module-extensions";

import cellFrag from "./cell.frag";
import cellVert from "./cell.vert";
import lblFrag from "./lbl.frag";
import lblVert from "./lbl.vert";

const CELL_COUNT = 5000;
const POI_COUNT = 3000;

export type CellsGLRenderer = ReturnType<typeof createCellsGLRenderer>;
export function createCellsGLRenderer(
    gl: TypedWebGLRenderingContext<undefined>,
) {
    const cellProg = createProg(gl, cellVert, cellFrag);
    const lblProg = createProg(gl, lblVert, lblFrag);
    const atlas = new Atlas(gl);

    const cellPos = new Float32Array(CELL_COUNT * 12);
    const cellCol = new Float32Array(CELL_COUNT * 18);
    for (let i = 0; i < CELL_COUNT; i++) {
        const x = (Math.random() - 0.5) * 4000,
            y = (Math.random() - 0.5) * 4000;
        const s = 40 + Math.random() * 20;
        cellPos.set(
            [x, y, x + s, y, x, y + s, x + s, y, x + s, y + s, x, y + s],
            i * 12,
        );
        for (let v = 0; v < 6; v++)
            cellCol.set([0.2, 0.4, 0.8], i * 18 + v * 3);
    }

    const lblP = new Float32Array(POI_COUNT * 8 * 12);
    const lblU = new Float32Array(POI_COUNT * 8 * 12);
    const lblI = new Float32Array(POI_COUNT * 8 * 6);
    const lblQ = new Float32Array(POI_COUNT * 8 * 12);
    const lblC = new Float32Array(POI_COUNT * 8 * 18);
    const q = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
    const names = ["Tokyo", "S2-Cell", "Map-Tile", "渋谷駅", "新宿", "Park"];
    for (let i = 0; i < POI_COUNT; i++) {
        const x = (Math.random() - 0.5) * 4000,
            y = (Math.random() - 0.5) * 4000;
        const name = names[Math.floor(Math.random() * names.length)]!;
        const color = [
            Math.random(),
            0.5 + Math.random() * 0.5,
            0.8 + Math.random() * 0.2,
        ];
        for (let c = 0; c < 8; c++) {
            const char = name[c] || " ";
            const info = atlas.get(char);
            const b = (i * 8 + c) * 12,
                bi = (i * 8 + c) * 6,
                bc = (i * 8 + c) * 18;
            for (let v = 0; v < 6; v++) {
                lblP.set([x, y], b + v * 2);
                lblU.set([info.u, info.v], b + v * 2);
                lblQ.set([q[v * 2]!, q[v * 2 + 1]!], b + v * 2);
                lblI[bi + v] = c;
                lblC.set(color, bc + v * 3);
            }
        }
    }

    const buffers = {
        cPos: createDynamicBuffer(gl, cellPos),
        cCol: createDynamicBuffer(gl, cellCol),
        lP: createDynamicBuffer(gl, lblP),
        lU: createDynamicBuffer(gl, lblU),
        lI: createDynamicBuffer(gl, lblI),
        lQ: createDynamicBuffer(gl, lblQ),
        lC: createDynamicBuffer(gl, lblC),
    };
    return {
        gl,
        cellProg,
        lblProg,
        atlas,
        buffers,
    };
}

const state = {
    x: 0,
    y: 0,
    zoom: 1.0,
    w: window.innerWidth,
    h: window.innerHeight,
};

export function initGL({ gl }: CellsGLRenderer) {
    // アルファ 0.0 でクリアすることで背景を透過させる
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

export function draw(renderer: CellsGLRenderer) {
    const { cellProg, buffers, lblProg, atlas } = renderer;
    const gl: TypedWebGLRenderingContext<undefined> = renderer.gl;

    // アルファ 0.0 でクリアすることで背景を透過させる
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const ux = state.x + state.w / (2 * state.zoom);
    const uy = state.y + state.h / (2 * state.zoom);

    const { attributes: cL, uniforms: cellUniforms } = createLocations(
        gl,
        cellProg,
        cellVert,
    );

    // Cells
    gl.useProgram(cellProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.cPos);
    gl.enableVertexAttribArray(cL.a_pos);
    gl.vertexAttribPointer(cL.a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.cCol);
    gl.enableVertexAttribArray(cL.a_col);
    gl.vertexAttribPointer(cL.a_col, 3, gl.FLOAT, false, 0, 0);
    gl.uniform2f(cellUniforms.u_res, state.w, state.h);
    gl.uniform2f(cellUniforms.u_off, ux, uy);
    gl.uniform1f(cellUniforms.u_zoom, state.zoom);
    gl.drawArrays(gl.TRIANGLES, 0, CELL_COUNT * 6);

    // Labels
    gl.useProgram(lblProg);
    const setup = <
        TName extends string,
        TType extends VertexAttributeArrayTypes,
    >(
        idx: TypedLocation<TName, TType>,
        buf: WebGLBuffer,
        size: number,
    ) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(idx);
        gl.vertexAttribPointer(idx, size, gl.FLOAT, false, 0, 0);
    };
    const { attributes: locations, uniforms: lblUniforms } = createLocations(
        gl,
        lblProg,
        lblVert,
    );
    setup(locations.a_q, buffers.lQ, 2);
    setup(locations.a_p, buffers.lP, 2);
    setup(locations.a_uv, buffers.lU, 2);
    setup(locations.a_idx, buffers.lI, 1);
    setup(locations.a_col, buffers.lC, 3);

    gl.uniform2f(lblUniforms.u_res, state.w, state.h);
    gl.uniform2f(lblUniforms.u_off, ux, uy);
    gl.uniform1f(lblUniforms.u_zoom, state.zoom);
    gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
    gl.drawArrays(gl.TRIANGLES, 0, POI_COUNT * 8 * 6);
}
