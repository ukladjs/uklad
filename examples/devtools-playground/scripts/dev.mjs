import { spawn } from 'node:child_process';

const apiPort = process.env.PLAYGROUND_API_PORT ?? '8788';
const vitePort = process.env.PLAYGROUND_VITE_PORT ?? '3000';
let stopping = false;
let apiExited = false;
let vite;

const api = spawn(process.execPath, ['scripts/playground-api-server.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYGROUND_API_PORT: apiPort },
});

api.once('exit', (code) => {
  apiExited = true;
  if (stopping) return;
  console.error(
    `[devtools-playground-api] stopped before Vite started (exit ${code ?? 'signal'}).`,
  );
  stop('SIGTERM', code ?? 1);
});

await waitForApi(apiPort);
vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', vitePort], {
  stdio: 'inherit',
  env: { ...process.env, PLAYGROUND_API_PORT: apiPort },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stop(signal));
}

vite.once('exit', (code) => stop('SIGTERM', code ?? 0));

process.once('exit', () => {
  api.kill('SIGTERM');
  vite?.kill('SIGTERM');
});

async function waitForApi(port) {
  const healthUrl = `http://127.0.0.1:${port}/api/playground/health`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (apiExited) break;
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // The API process has not bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  stop('SIGTERM', 1);
  throw new Error(`Playground API did not become ready at ${healthUrl}.`);
}

function stop(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  api.kill(signal);
  vite?.kill(signal);
  process.exitCode = exitCode;
}
