// Shader: セル (半透明)

attribute vec2 a_pos;
attribute vec3 a_col;
uniform vec2 u_res;
uniform vec2 u_off;
uniform float u_zoom;
varying vec3 v_col;
void main() {
    vec2 p = (a_pos + u_off) * u_zoom;
    gl_Position = vec4(((p / u_res) * 2.0 - 1.0) * vec2(1, -1), 0, 1);
    v_col = a_col;
}