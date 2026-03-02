#version 300 es
precision mediump float;

in vec2 vUV;
in vec4 vFillColor;
in vec4 vStrokeColor;
in float vLineWidth;

out vec4 fragColor;

void main() {
    vec4 fillColor = vFillColor;
    vec4 strokeColor = vStrokeColor;
    float lineWidth = vLineWidth;

    vec2 dEdge = min(vUV, 1.0f - vUV);
    float minEdgeDist = min(dEdge.x, dEdge.y);

    float dx = fwidth(vUV.x);
    float dy = fwidth(vUV.y);
    float pixelSize = max(dx, dy);

    float threshold = pixelSize * lineWidth;

    float edgeAlpha = smoothstep(threshold - pixelSize, threshold, minEdgeDist);
    vec4 color = mix(strokeColor, fillColor, edgeAlpha);

    fragColor = vec4(color.rgb * color.a, color.a);
}