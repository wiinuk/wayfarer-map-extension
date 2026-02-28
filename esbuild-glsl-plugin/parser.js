// esbuild-glsl-plugin/parser.js
import { computeLineStarts, computeLineAndCharacterOfPosition } from './line-map.js';

export function parseShader(source) {
  const uniforms = [];
  const attributes = [];
  const lineStarts = computeLineStarts(source);

  const uniformRegex = /uniform\s+\w+\s+([\w\d_]+)\s*;/g;
  const attributeRegex = /(attribute|in)\s+\w+\s+([\w\d_]+)\s*;/g;

  let match;
  while ((match = uniformRegex.exec(source)) !== null) {
    const name = match[1];
    const startOffset = match.index + match[0].lastIndexOf(name);
    const endOffset = startOffset + name.length;
    uniforms.push({
      name,
      start: computeLineAndCharacterOfPosition(lineStarts, startOffset),
      end: computeLineAndCharacterOfPosition(lineStarts, endOffset),
    });
  }
  while ((match = attributeRegex.exec(source)) !== null) {
    const name = match[2];
    if (name) {
      const startOffset = match.index + match[0].lastIndexOf(name);
      const endOffset = startOffset + name.length;
      attributes.push({
        name,
        start: computeLineAndCharacterOfPosition(lineStarts, startOffset),
        end: computeLineAndCharacterOfPosition(lineStarts, endOffset),
      });
    }
  }

  return {
    uniforms,
    attributes,
  };
}
