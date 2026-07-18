import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('CLI accepts and documents --max-runtimes', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    CLI_PATH,
    '--max-runtimes',
    '2',
    '--help',
  ]);

  assert.match(
    stdout,
    /--max-runtimes <number>\s+Maximum retained runtime entries \(default: 16\)/,
  );
  assert.equal(stderr, '');
});

test('CLI rejects a non-positive --max-runtimes value', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [CLI_PATH, '--max-runtimes', '0']),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /--max-runtimes requires a positive integer\./,
      );
      return true;
    },
  );
});
