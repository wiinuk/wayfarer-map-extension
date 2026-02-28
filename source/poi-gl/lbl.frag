precision mediump float;
varying vec2 v_uv;
varying vec3 v_col;
uniform sampler2D u_tex;
void main() {
    vec4 t = texture2D(u_tex, v_uv);
    if(t.a < 0.1)
        discard;
    gl_FragColor = vec4(mix(vec3(0), v_col, t.r), t.a);
}