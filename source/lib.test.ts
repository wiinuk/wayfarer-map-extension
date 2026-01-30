import { describe, it, expect } from 'vitest';
import { sayHello } from './lib';

describe('sayHello', () => {
  it('should return a greeting', () => {
    expect(sayHello('Test')).toBe('Hello, Test!');
  });
});
