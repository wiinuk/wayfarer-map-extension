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
    float outerMask = 1.0f - smoothstep(outerEdge - fw, outerEdge, d);
    float fillMask = 1.0f - smoothstep(vRadius - fw, vRadius, d);

    if(outerMask <= 0.0f)
        discard;

    vec4 f = vec4(vFillColor.rgb * vFillColor.a, vFillColor.a);
    vec4 s = vec4(vStrokeColor.rgb * vStrokeColor.a, vStrokeColor.a);

    vec4 finalColor = mix(s, f, fillMask);
    fragColor = finalColor * outerMask;
}