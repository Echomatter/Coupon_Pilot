import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const violations = [];
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const localWindowsPathPattern = new RegExp(`${'C:'}[\\\\/]Users[\\\\/][^\\s"'<>]+`, 'i');
const localUnixPathPattern = new RegExp(`${'/'}Users/[^\\s"'<>]+`, 'i');
const privateKeyPattern = new RegExp(`BEGIN [A-Z ]+ ${['PRIVATE', 'KEY'].join(' ')}`, 'i');
const githubTokenPattern = new RegExp(`${['gh', 'p_'].join('')}[A-Za-z0-9]{20,}`);
const openAiTokenPattern = new RegExp(`${['sk', '-'].join('')}[A-Za-z0-9]{20,}`);
const patterns = [
  ['email address', emailPattern],
  ['Windows user path', localWindowsPathPattern],
  ['Unix user path', localUnixPathPattern],
  ['private key', privateKeyPattern],
  ['GitHub token', githubTokenPattern],
  ['API token', openAiTokenPattern]
];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(filePath);
      continue;
    }
    if (!entry.isFile() || (await stat(filePath)).size > 2 * 1024 * 1024) continue;
    const source = await readFile(filePath, 'utf8');
    if (source.includes('\0')) continue;
    for (const [label, pattern] of patterns) if (pattern.test(source)) violations.push(`${label}: ${path.relative(root, filePath)}`);
  }
}

await visit(root);
assert.deepEqual(violations, [], `Potential personal or credential data found in public files:\n${violations.join('\n')}`);
console.log('Coupon Pilot privacy checks passed.');
