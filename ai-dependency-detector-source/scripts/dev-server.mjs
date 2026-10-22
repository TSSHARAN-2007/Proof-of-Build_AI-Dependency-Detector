import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import verifyHandler from '../api/verify.js';
import githubHandler from '../api/github.js';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
try {
  const envFile = readFileSync(resolve(projectRoot, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* Local LLM verification is optional until a .env file is configured. */ }
const root = resolve(projectRoot, process.argv[2] || 'public');
const requestedPort = Number(process.env.PORT || 4173);
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname === '/api/verify') {
    if (!['GET', 'POST'].includes(req.method || '')) {
      res.writeHead(405, { Allow: 'GET, POST' }).end('Method not allowed');
      return;
    }
    if (req.method === 'GET') {
      verifyHandler(req, res);
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 80_000) {
        res.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Request is too large.' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      try {
        req.body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Request body must be valid JSON.' }));
        return;
      }
      await verifyHandler(req, res);
    });
    return;
  }

  if (pathname === '/api/github') {
    githubHandler(req, res);
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  const file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  const target = existsSync(file) && statSync(file).isDirectory() ? resolve(file, 'index.html') : file;
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': statSync(target).size,
    'Content-Type': mime[extname(target)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(target).pipe(res);
});

function listen(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < requestedPort + 10) {
      listen(port + 1);
      return;
    }
    console.error(`Could not start the local server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Proof of Build is running at http://localhost:${port}`);
  });
}

listen(requestedPort);
