#version 300 es
precision mediump float;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

in vec2 aPosition;
in vec2 aUV;
in vec4 aFillColor;
in vec4 aStrokeColor;
in float aLineWidth;

out vec2 vUV;
out vec4 vFillColor;
out vec4 vStrokeColor;
out float vLineWidth;

void main() {
    vUV = aUV;
    vFillColor = aFillColor;
    vStrokeColor = aStrokeColor;
    vLineWidth = aLineWidth;

    vec3 worldPos = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0f);
    gl_Position = vec4(worldPos.xy, 0.0f, 1.0f);
}
