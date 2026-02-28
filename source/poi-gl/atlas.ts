export class Atlas {
    readonly tex: WebGLTexture;
    private readonly can: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly cache: Map<
        string,
        { readonly v: number; readonly u: number }
    >;
    private y: number;
    private x: number;
    constructor(private gl: WebGLRenderingContext) {
        this.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1024,
            1024,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            null,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.can = document.createElement("canvas");
        this.can.width = this.can.height = 64;
        this.ctx = this.can.getContext("2d")!;
        this.cache = new Map();
        this.x = 0;
        this.y = 0;
    }
    get(c: string) {
        const info = this.cache.get(c);
        if (info != null) return info;

        this.ctx.clearRect(0, 0, 64, 64);
        this.ctx.font = "bold 44px sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.strokeStyle = "black";
        this.ctx.lineWidth = 6;
        this.ctx.strokeText(c, 32, 32);
        this.ctx.fillStyle = "white";
        this.ctx.fillText(c, 32, 32);
        if (this.x + 64 > 1024) {
            this.x = 0;
            this.y += 64;
        }
        const { gl } = this;
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            this.x,
            this.y,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this.can,
        );
        const res = { u: this.x / 1024, v: this.y / 1024 };
        this.cache.set(c, res);
        this.x += 64;
        return res;
    }
}
