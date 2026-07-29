import { createServer } from 'node:http';

let skipReasonPromise;

/**
 * Return a node:test-compatible skip reason when the current environment
 * explicitly forbids loopback listeners. Other listen failures remain test
 * failures so infrastructure and product regressions are not hidden.
 */
export function loopbackListenSkipReason() {
  skipReasonPromise ??= new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', (error) => {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        resolve(
          `loopback integration requires listen permission (${error.code}: ${error.message})`,
        );
        return;
      }
      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(false);
      });
    });
  });

  return skipReasonPromise;
}
