import type PIXI from "pixi.js";
import type { Id } from "./standard-extensions";
type PixiModule = typeof import("pixi.js");

type ShaderTypeName =
    | keyof Float32ShaderTypeToVertexFormat
    | keyof ShaderTypeToUniformTypeMap;

type ShaderType = ShaderTypeName | `${ShaderTypeName}[${number}]`;

type VariableDefinitions = Record<string, ShaderType>;
interface ShaderModuleKind {
    readonly attributes: VariableDefinitions;
    readonly uniforms: VariableDefinitions;
    readonly source: string;
}

const privateTypedGeometrySymbol = Symbol("privateTypedGeometry");
export interface TypedGeometry<V extends ShaderModuleKind, F> extends Omit<
    PIXI.Geometry,
    "addAttribute"
> {
    readonly [privateTypedGeometrySymbol]: Id<[V, F]>;
    addAttribute<TName extends keyof V["attributes"]>(
        name: TName,
        attributeOption: TypedAttributeOption<V["attributes"][TName]>,
    ): void;
}
export function createTypedGeometry<V extends ShaderModuleKind, F>(
    PIXI: PixiModule,
) {
    return new PIXI.Geometry() as unknown as TypedGeometry<V, F>;
}
export function toUntypedGeometry<V extends ShaderModuleKind, K>(
    geometry: TypedGeometry<V, K>,
) {
    return geometry as unknown as PIXI.Geometry;
}

type Float32ArrayShaderTypes = "float" | "vec2" | "vec3" | "vec4";
interface Float32ShaderTypeToVertexFormat {
    float: "float32";
    vec2: "float32x2";
    vec3: "float32x3";
    vec4: "float32x4";
}

type shaderTypeToTypedArray<t extends ShaderType> =
    t extends Float32ArrayShaderTypes ? Float32Array : never;

type shaderTypeToVertexFormat<t extends ShaderType> =
    t extends keyof Float32ShaderTypeToVertexFormat
        ? Float32ShaderTypeToVertexFormat[t]
        : never;

interface TypedAttribute<T extends ShaderType> extends Omit<
    PIXI.Attribute,
    "buffer" | "format"
> {
    buffer: Buffer | shaderTypeToTypedArray<T> | number[];
    format: shaderTypeToVertexFormat<T>;
}
type TypedAttributeOption<T extends ShaderType> =
    | TypedAttribute<T>
    | Buffer
    | shaderTypeToTypedArray<T>
    | number[];

export interface ShaderTypeToUniformTypeMap {
    // スカラー型
    float: "f32";
    int: "i32";
    bool: "f32"; // WebGL/WebGPU互換のため内部的にf32として扱われることが多い

    // ベクトル型
    vec2: "vec2<f32>";
    vec3: "vec3<f32>";
    vec4: "vec4<f32>";

    ivec2: "vec2<i32>";
    ivec3: "vec3<i32>";
    ivec4: "vec4<i32>";

    // 行列型 (列x行)
    mat2: "mat2x2<f32>";
    mat3: "mat3x3<f32>";
    mat4: "mat4x4<f32>";
}

interface SimpleUniformData<V, T extends PIXI.UNIFORM_TYPES>
    extends PIXI.UniformData {
    value: V;
    type: T;
}
interface ArrayUniformData<
    V,
    T extends PIXI.UNIFORM_TYPES,
    S extends number,
> extends SimpleUniformData<V, T> {
    value: V;
    type: T;
    size: S;
}

type ToUniformData<
    V,
    T extends ShaderType,
> = T extends keyof ShaderTypeToUniformTypeMap
    ? SimpleUniformData<V, ShaderTypeToUniformTypeMap[T]>
    : T extends `${infer e extends keyof ShaderTypeToUniformTypeMap}[${infer l extends number}]`
      ? ArrayUniformData<V, ShaderTypeToUniformTypeMap[e], l>
      : never;

type TypedUniformData<T extends ShaderType> = ToUniformData<
    ToPixiUniformType<T>,
    T
>;

interface ShaderTypeToPixiUniformType {
    float: number;
    int: number;
    bool: boolean;

    vec2:
        | [x: number, y: number]
        | Float32Array
        | PIXI.Point
        | PIXI.ObservablePoint;
    vec3: [r: number, g: number, b: number] | Float32Array;
    vec4: [r: number, g: number, b: number, a: number] | Float32Array;

    ivec2: Int32Array | number[];
    ivec3: Int32Array | number[];
    ivec4: Int32Array | number[];

    mat2: Float32Array;
    mat3: PIXI.Matrix | Float32Array;
    mat4: Float32Array;

    sampler2D: PIXI.Texture | PIXI.TextureSource;
}

type ToPixiUniformType<T extends ShaderType> =
    T extends keyof ShaderTypeToPixiUniformType
        ? ShaderTypeToPixiUniformType[T]
        : T extends `${infer e extends ShaderTypeName}[${number}]`
          ? ToPixiUniformType<e>[]
          : never;

type ToPixiUniformTypes<D extends VariableDefinitions> = {
    -readonly [k in keyof D]: TypedUniformData<D[k]>;
};
type ToUniformStructure<
    V extends ShaderModuleKind,
    F extends ShaderModuleKind,
> = ToPixiUniformTypes<V["uniforms"] & F["uniforms"]>;

const privateTypedShaderSymbol = Symbol("privateTypedShaderSymbol");
export interface TypedShader<
    V extends ShaderModuleKind,
    F extends ShaderModuleKind,
>
    extends PIXI.Shader {
    [privateTypedShaderSymbol]: [V, F];
    resources: {
        typedUniforms: PIXI.UniformGroup<ToUniformStructure<V, F>>;
    };
}

export function createTypedShaderFrom<
    V extends ShaderModuleKind,
    F extends ShaderModuleKind,
>(
    pixi: PixiModule,
    vertexShaderModule: V,
    fragmentShaderModule: F,
    uniforms: PIXI.UniformGroup<ToUniformStructure<V, F>>,
) {
    return pixi.Shader.from({
        gl: {
            vertex: vertexShaderModule.source,
            fragment: fragmentShaderModule.source,
        },
        resources: {
            typedUniforms: uniforms,
        },
    }) as TypedShader<V, F>;
}
