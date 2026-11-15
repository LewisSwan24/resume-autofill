// Test pages for the fill browser's device tests: plain http on 4180 (outer.html, links.html, upload.html, and job.html,
// the application page the "ways in" and tracker tests open by VIEW, share and shortcut) and 4181
// (inner.html, a different origin for the cross-origin iframe), and https on 4443 with a self-signed certificate (the
// SSL error test; the app must refuse it). The emulator reaches them through `adb reverse`. Serves only the files
// listed here.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PORTS = { outer: 4180, inner: 4181, tls: 4443 } as const;

const PAGES: Record<number, Record<string, string>> = {
  [PORTS.outer]: { '/outer.html': 'outer.html', '/links.html': 'links.html', '/upload.html': 'upload.html', '/job.html': 'job.html' },
  [PORTS.inner]: { '/inner.html': 'inner.html' },
  [PORTS.tls]: { '/': 'outer.html' },
};

function handler(port: number): http.RequestListener {
  return (req, res) => {
    const file = PAGES[port]?.[(req.url ?? '/').split('?')[0]!];
    if (req.method !== 'GET' || !file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(readFileSync(path.join(HERE, file)));
  };
}

export interface TestServers {
  close(): Promise<void>;
}

function listen(server: http.Server | https.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

/** The self-signed localhost certificate for the SSL test, made with openssl on first use and never committed. */
function testCertificate(): { key: Buffer; cert: Buffer } {
  const dir = path.join(HERE, 'certs');
  const key = path.join(dir, 'localhost.key');
  const cert = path.join(dir, 'localhost.crt');
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

export async function startServers(): Promise<TestServers> {
  const servers: (http.Server | https.Server)[] = [
    http.createServer(handler(PORTS.outer)),
    http.createServer(handler(PORTS.inner)),
    https.createServer(
      testCertificate(),
      handler(PORTS.tls),
    ),
  ];
  await Promise.all([listen(servers[0]!, PORTS.outer), listen(servers[1]!, PORTS.inner), listen(servers[2]!, PORTS.tls)]);
  return {
    close: () => Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))).then(() => undefined),
  };
}
