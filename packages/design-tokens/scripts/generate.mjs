import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokenPath = resolve(packageRoot, 'tokens.json');
const cssPath = resolve(packageRoot, 'src/generated/tokens.css');
const typeScriptPath = resolve(packageRoot, 'src/generated/tokens.ts');
const tokens = JSON.parse(await readFile(tokenPath, 'utf8'));

function kebabCase(value) {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function flatten(value, path = []) {
  const entries = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, kebabCase(key)];
    if (typeof child === 'object' && child !== null) entries.push(...flatten(child, childPath));
    else entries.push([childPath.join('-'), String(child)]);
  }
  return entries;
}

const cssLines = flatten(tokens).map(([name, value]) => `  --hanaply-${name}: ${value};`);
const css = `/* Generated from tokens.json. Do not edit directly. */\n:root {\n${cssLines.join('\n')}\n}\n\n@media (prefers-reduced-motion: reduce) {\n  :root {\n    --hanaply-motion-duration-micro: 1ms;\n    --hanaply-motion-duration-interface: 1ms;\n    --hanaply-motion-duration-story: 1ms;\n  }\n}\n`;
const typeScript = `/* Generated from tokens.json. Do not edit directly. */\nexport const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n`;

if (process.argv.includes('--check')) {
  const [existingCss, existingTypeScript] = await Promise.all([
    readFile(cssPath, 'utf8'),
    readFile(typeScriptPath, 'utf8'),
  ]);
  if (existingCss !== css || existingTypeScript !== typeScript) {
    console.error(
      'Design token outputs are stale. Run pnpm --filter @hanaply/design-tokens generate.',
    );
    process.exitCode = 1;
  } else {
    console.log('Design token outputs match the canonical token source.');
  }
} else {
  await mkdir(dirname(cssPath), { recursive: true });
  await Promise.all([
    writeFile(cssPath, css, 'utf8'),
    writeFile(typeScriptPath, typeScript, 'utf8'),
  ]);
  console.log('Generated Hanaply design token outputs.');
}
