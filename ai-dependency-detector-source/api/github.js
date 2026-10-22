const allowedPath = /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/git\/trees\/[A-Za-z0-9_.%+-]+|\/contents(?:\/[A-Za-z0-9_.%+-]+)*|\/branches|\/compare\/[A-Za-z0-9_.%+-]+\.\.\.[A-Za-z0-9_.%+-]+)?$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'Method not allowed.' }));
  }

  let requestUrl;
  try {
    requestUrl = new URL(req.url || '/', 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'Invalid GitHub API request.' }));
  }

  let githubUrl;
  try {
    githubUrl = new URL(requestUrl.searchParams.get('url') || '');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'Invalid GitHub API request.' }));
  }
  const path = githubUrl.pathname;
  if (githubUrl.origin !== 'https://api.github.com' || !allowedPath.test(path) || path.includes('..')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'Unsupported GitHub API route.' }));
  }

  const target = githubUrl;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Proof-of-Build',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    const response = await fetch(target, { headers, signal: AbortSignal.timeout(12000) });
    const body = await response.text();
    const responseHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
    };
    for (const header of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
      const value = response.headers.get(header);
      if (value) responseHeaders[header] = value;
    }
    res.writeHead(response.status, responseHeaders);
    return res.end(body);
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    res.writeHead(timeout ? 504 : 502, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: timeout ? 'GitHub took too long to respond. Try again.' : 'Could not reach GitHub. Check the server connection.' }));
  }
}
