#version 300 es
precision mediump float;

in vec2 vPixelPos;
in float vRadius;
in float vStrokeWidth;
in vec4 vFillColor;
in vec4 vStrokeColor;

out vec4 fragColor;

void main() {
    float d = length(vPixelPos);
    float fw = fwidth(d);

    float outerEdge = vRadius + vStrokeWidth;

    float outerAlpha = 1.0f - smoothstep(outerEdge - fw, outerEdge, d);
    float fillAlpha = 1.0f - smoothstep(vRadius - fw, vRadius, d);
    float strokeAlpha = outerAlpha - fillAlpha;

    if(outerAlpha <= 0.0f)
        discard;

    vec4 fill = vFillColor;
    vec4 stroke = vStrokeColor;

    vec4 col = fill * fillAlpha + stroke * strokeAlpha;
    float a = col.a;

    fragColor = vec4(col.rgb * a, a);
}