// esbuild-glsl-plugin/parser.js
import { computeLineStarts, computeLineAndCharacterOfPosition } from './line-map.js';

export function parseShader(source) {
  const uniforms = [];
  const attributes = [];
  const lineStarts = computeLineStarts(source);

  // This regex matches "uniform <type> <name1>, <name2>, ...;"
  // group 1: list of names
  const uniformRegex = /uniform\s+\w+\s+((?:[\w\d_]+)(?:\s*,\s*[\w\d_]+)*)\s*;/g;

  // This regex matches "attribute|in <type> <name1>, <name2>, ...;"
  // group 1: list of names
  const attributeRegex = /(?:attribute|in)\s+\w+\s+((?:[\w\d_]+)(?:\s*,\s*[\w\d_]+)*)\s*;/g;
  
  let match;
  while ((match = uniformRegex.exec(source)) !== null) {
    const namesListStr = match[1];
    const listStartOffset = match.index + match[0].indexOf(namesListStr);
    const nameRegex = /[\w\d_]+/g;
    let nameMatch;
    while ((nameMatch = nameRegex.exec(namesListStr)) !== null) {
        const name = nameMatch[0];
        const nameStartOffset = listStartOffset + nameMatch.index;
        const endOffset = nameStartOffset + name.length;
        uniforms.push({
            name,
            start: computeLineAndCharacterOfPosition(lineStarts, nameStartOffset),
            end: computeLineAndCharacterOfPosition(lineStarts, endOffset),
        });
    }
  }

  while ((match = attributeRegex.exec(source)) !== null) {
    const namesListStr = match[1];
    const listStartOffset = match.index + match[0].indexOf(namesListStr);
    const nameRegex = /[\w\d_]+/g;
    let nameMatch;
    while ((nameMatch = nameRegex.exec(namesListStr)) !== null) {
        const name = nameMatch[0];
        const nameStartOffset = listStartOffset + nameMatch.index;
        const endOffset = nameStartOffset + name.length;
        attributes.push({
            name,
            start: computeLineAndCharacterOfPosition(lineStarts, nameStartOffset),
            end: computeLineAndCharacterOfPosition(lineStarts, endOffset),
        });
    }
  }

  return {
    uniforms,
    attributes,
  };
}
