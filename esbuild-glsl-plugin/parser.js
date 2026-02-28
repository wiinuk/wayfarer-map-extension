// esbuild-glsl-plugin/parser.js
export function parseShader(source) {
  const uniforms = new Set();
  const attributes = new Set();

  const uniformRegex = /uniform\s+\w+\s+([\w\d_]+)\s*;/g;
  const attributeRegex = /(attribute|in)\s+\w+\s+([\w\d_]+)\s*;/g;

  let match;
  while ((match = uniformRegex.exec(source)) !== null) {
    uniforms.add(match[1]);
  }
  while ((match = attributeRegex.exec(source)) !== null) {
    // The second capture group is the name for attributeRegex
    if (match[2]) {
      attributes.add(match[2]);
    } else {
      attributes.add(match[1]);
    }
  }

  return {
    uniforms: [...uniforms],
    attributes: [...attributes],
  };
}
