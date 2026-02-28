import { raise, type Id, type Tagged } from "../standard-extensions";

export type VertexAttributeArrayTypes =
    | "float"
    | "vec2"
    | "vec3"
    | "vec4"
    | "mat2"
    | "mat3"
    | "mat4";

function compile(gl: WebGLRenderingContext, src: string, type: GLenum) {
    const s = gl.createShader(type) ?? raise`internal error`;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        return raise`${gl.getShaderInfoLog(s)}`;
    return s;
}

type ShaderTypes = string;
type NameTypeMap = { readonly [name: string]: ShaderTypes };
interface ShaderModuleKind {
    readonly attributes: NameTypeMap;
    readonly uniforms: NameTypeMap;
    readonly source: string;
}
interface ShaderModulesKind {
    readonly v: ShaderModuleKind;
    readonly f: ShaderModuleKind;
}
type CurrentProgramKind = TypedWebGLProgram<ShaderModulesKind> | undefined;
export function createProg<
    P extends CurrentProgramKind,
    V extends ShaderModuleKind,
    F extends ShaderModuleKind,
>(gl: TypedWebGLRenderingContext<P>, vertex: V, fragment: F) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, vertex.source, gl.VERTEX_SHADER));
    gl.attachShader(p, compile(gl, fragment.source, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        return raise`${gl.getProgramInfoLog(p)}`;
    return p as unknown as TypedWebGLProgram<{ v: V; f: F }>;
}

type TypedWebGLProgram<S extends ShaderModulesKind> = Tagged<WebGLProgram, S>;
export type TypedLocation<
    TName extends string,
    TType extends ShaderTypes,
> = Tagged<number, [TName, TType]>;

const privateCurrentProgramSymbol = Symbol("privateCurrentProgram");
export interface TypedWebGLRenderingContext<
    P extends CurrentProgramKind,
> extends Omit<
    WebGLRenderingContext,
    | "getAttribLocation"
    | "getUniformLocation"
    | "enableVertexAttribArray"
    | "useProgram"
    | "uniform2f"
    | "uniform1f"
> {
    [privateCurrentProgramSymbol]: Id<P>;
    getAttribLocation<
        S extends ShaderModulesKind,
        TName extends keyof S["v"]["attributes"] & string,
    >(
        program: TypedWebGLProgram<S>,
        name: TName,
    ): TypedLocation<TName, S["v"]["attributes"][TName]>;

    getUniformLocation<
        S extends ShaderModulesKind,
        TName extends keyof S["v"]["uniforms"] & string,
    >(
        program: TypedWebGLProgram<S>,
        name: TName,
    ): TypedLocation<TName, S["v"]["uniforms"][TName]>;

    enableVertexAttribArray(
        location: TypedLocation<string, VertexAttributeArrayTypes>,
    ): void;
    useProgram<S extends TypedWebGLProgram<ShaderModulesKind>>(
        program: S,
    ): asserts this is TypedWebGLRenderingContext<S>;

    uniform2f(
        location: TypedLocation<string, "vec2">,
        x: GLfloat,
        y: GLfloat,
    ): void;
    uniform1f(location: TypedLocation<string, "float">, x: GLfloat): void;
}
export function createDynamicBuffer(
    gl: WebGLRenderingContext,
    data: AllowSharedBufferSource,
) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return b;
}

type Locations<M extends NameTypeMap> = {
    readonly [k in keyof M]: TypedLocation<k extends string ? k : string, M[k]>;
};

export function createLocations<
    M extends ShaderModulesKind,
    P extends CurrentProgramKind,
>(
    gl: TypedWebGLRenderingContext<P>,
    program: TypedWebGLProgram<M>,
    module: M["v"],
) {
    const attributes = Object.create(null);
    for (const k of Object.keys(module.attributes)) {
        attributes[k] = gl.getAttribLocation(program, k);
    }
    const uniforms = Object.create(null);
    for (const k of Object.keys(module.attributes)) {
        uniforms[k] = gl.getUniformLocation(program, k);
    }
    return {
        attributes: attributes as Locations<M["v"]["attributes"]>,
        uniforms: uniforms as Locations<M["v"]["uniforms"]>,
    };
}
