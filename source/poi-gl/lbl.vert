
// Shader: ラベル (袋文字)

attribute vec2 a_q, a_p, a_uv;
attribute float a_idx;
attribute vec3 a_col;
uniform vec2 u_res, u_off;
uniform float u_zoom;
varying vec2 v_uv;
varying vec3 v_col;
void main() {
    vec2 world = (a_p + u_off) * u_zoom;
    float s = clamp(u_zoom, 0.5, 2.0);
    vec2 screen = world + (a_q * 16.0 + vec2(a_idx * 12.0, 0)) * s;
    gl_Position = vec4(((screen / u_res) * 2.0 - 1.0) * vec2(1, -1), 0, 1);
    v_uv = a_uv + a_q * (64.0 / 1024.0);
    v_col = a_col;
}