#version 300 es
precision mediump float;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

in vec2 aQuadPos;
in vec2 aCenter;
in float aRadius;
in float aStrokeWidth;
in vec4 aFillColor;
in vec4 aStrokeColor;

out vec2 vPixelPos;
out float vRadius;
out float vStrokeWidth;
out vec4 vFillColor;
out vec4 vStrokeColor;

void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    vec3 clip = mvp * vec3(aCenter, 1.0f);

    float ndcPxX = uProjectionMatrix[0][0];
    float ndcPxY = -uProjectionMatrix[1][1];

    float quadR = aRadius + aStrokeWidth;
    vec2 ndcOffset = vec2(aQuadPos.x * quadR * ndcPxX, aQuadPos.y * quadR * ndcPxY);

    gl_Position = vec4(clip.xy + ndcOffset, 0.0f, 1.0f);

    vPixelPos = aQuadPos * quadR;
    vRadius = aRadius;
    vStrokeWidth = aStrokeWidth;
    vFillColor = aFillColor;
    vStrokeColor = aStrokeColor;
}