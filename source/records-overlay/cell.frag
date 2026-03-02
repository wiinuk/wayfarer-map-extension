#version 300 es
precision mediump float;

uniform vec4 uStrokeColor;
uniform vec4 uFillColor;
uniform float uLineWidth;

in vec2 vUV;
out vec4 fragColor;

void main() {
    vec2 dEdge = min(vUV, 1.0f - vUV);
    float minEdgeDist = min(dEdge.x, dEdge.y);

    float dx = fwidth(vUV.x);
    float dy = fwidth(vUV.y);
    float pixelSize = max(dx, dy);

    float threshold = pixelSize * uLineWidth;

    float edgeAlpha = smoothstep(threshold - pixelSize, threshold, minEdgeDist);

    fragColor = mix(uStrokeColor, uFillColor, edgeAlpha);
}