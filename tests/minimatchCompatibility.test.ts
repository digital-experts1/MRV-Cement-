import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const parserRequire = createRequire(require.resolve('@typescript-eslint/typescript-estree/package.json'));
const reactRequire = createRequire(require.resolve('eslint-plugin-react/package.json'));

describe('scoped minimatch security override', () => {
  it('resolves the TypeScript parser to a patched modern release', () => {
    const version = parserRequire('minimatch/package.json').version as string;
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major > 11 || (major === 11 && (minor > 0 || patch >= 1))).toBe(true);
  });
  it.each([
    ['eslint.config.mjs', '*.mjs', true],
    ['.config.ts', '*.ts', true],
    ['src/index.ts', '*.ts', false],
    ['src/index.ts', 'src/*.ts', true],
    ['src/index.js', 'src/*.ts', false],
  ])('preserves parser allowDefaultProject matching: %s / %s', (file, pattern, expected) => {
    // Same public API and options used in typescript-estree/useProgramFromProjectService.
    expect(parserRequire('minimatch').minimatch(file, pattern, { dot: true })).toBe(expected);
  });
  it('preserves the callable CommonJS API required by legacy React lint rules', () => {
    const legacy = reactRequire('minimatch');
    expect(typeof legacy).toBe('function');
    expect(legacy('renderItem', 'render*')).toBe(true);
    expect(legacy.makeRe('render*')).toBeInstanceOf(RegExp);
  });
});
