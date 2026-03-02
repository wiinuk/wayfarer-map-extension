#version 300 es
precision mediump float;
in vec2 vUV;
out vec4 fragColor;

void main() {
    /*
    vec4 strokeColor = vec4(1.0, 1.0, 1.0, 1.0);
    vec4 fillColor = vec4(1.0, 0.5, 0.2, 0.5);
    float lineWidth = 5.0;

    vec2 dEdge = min(vUV, 1.0 - vUV);
    float minEdgeDist = min(dEdge.x, dEdge.y);

    float dx = fwidth(vUV.x);
    float dy = fwidth(vUV.y);
    float pixelSize = max(dx, dy);

    float threshold = pixelSize * lineWidth;
    
    float edgeAlpha = smoothstep(threshold - pixelSize, threshold, minEdgeDist);
    
    fragColor = mix(strokeColor, fillColor, edgeAlpha);
    */
    fragColor = vec4(0.5f, 1.0f, 0.5f, 1.0f);
}