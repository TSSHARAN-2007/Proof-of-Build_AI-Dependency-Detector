// Route GitHub reads through our server so an optional server-side token can
// raise the unauthenticated API quota without exposing credentials in the UI.
const API = 'https://api.github.com';
const MAX_FILE_BYTES = 90_000;
const MAX_TEXT_CHARS = 24_000;

const ignoredPath = /(^|\/)(node_modules|vendor|dist|build|\.git|\.venv|venv|coverage|\.next|target)(\/|$)/i;
const sourceExtension = /\.(py|pyi|js|jsx|ts|tsx|java|go|rs|rb|php|cs|cpp|cc|c|h|swift|kt|scala|vue|svelte)$/i;
const manifestName = /^(package\.json|pyproject\.toml|requirements[^/]*\.txt|poetry\.lock|Pipfile|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|Gemfile|composer\.json|Dockerfile|docker-compose\.ya?ml)$/i;

export function parseRepositoryUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid GitHub repository URL.');
  }

  if (url.hostname.toLowerCase() !== 'github.com') {
    throw new Error('Use a repository hosted on github.com.');
  }

  const [owner, rawName] = url.pathname.split('/').filter(Boolean);
  if (!owner || !rawName) {
    throw new Error('Use a URL like https://github.com/owner/repository.');
  }

  const repo = rawName.replace(/\.git$/i, '');
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export async function compareBranches(owner, repo, base, head) {
  const endpoint = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  return getJson(endpoint);
}

async function getJson(url) {
  const response = await fetch(`/api/github?url=${encodeURIComponent(url)}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    let message = '';
    try {
      message = (await response.clone().json()).message || '';
    } catch {
      // Keep the status-based message below.
    }

    if (response.status === 404) {
      throw new Error('Repository not found, private, or unavailable. This prototype supports public repositories.');
    }
    if ((response.status === 403 || response.status === 429) && /rate limit|abuse detection/i.test(message)) {
      throw new Error('GitHub API limit reached. Add a GitHub token as GITHUB_TOKEN in your server environment, then restart or redeploy. Without a token, wait for the public limit to reset.');
    }
    throw new Error(`GitHub could not read this repository (HTTP ${response.status}).`);
  }

  return response.json();
}

function isTestFile(path) {
  return /(^|\/)(test|tests|spec|specs)(\/|\.|$)/i.test(path);
}

function fileKind(path) {
  const name = path.split('/').at(-1);
  if (/^README(?:\.|$)/i.test(name)) return 'Project overview';
  if (isTestFile(path)) return 'Test';
  if (manifestName.test(name)) return 'Configuration';
  return 'Source file';
}

function chooseFiles(tree) {
  const available = tree.filter((file) =>
    file.type === 'blob' &&
    !ignoredPath.test(file.path) &&
    file.size <= MAX_FILE_BYTES &&
    /\.(md|mdx|txt|toml|json|ya?ml|lock|gradle|xml|py|pyi|js|jsx|ts|tsx|java|go|rs|rb|php|cs|cpp|cc|c|h|swift|kt|scala|vue|svelte)$/i.test(file.path) ||
    (file.type === 'blob' && !ignoredPath.test(file.path) && file.size <= MAX_FILE_BYTES && /(^|\/)(Dockerfile|Gemfile|Pipfile)$/i.test(file.path))
  );

  const selected = [];
  const add = (file) => {
    if (file && !selected.some((item) => item.path === file.path) && selected.length < 7) selected.push(file);
  };

  add(available.find((file) => /^README(?:\.|$)/i.test(file.path.split('/').at(-1))));
  add(available.find((file) => manifestName.test(file.path.split('/').at(-1))));
  add(available.find((file) => isTestFile(file.path)));

  const sourceFiles = available
    .filter((file) => sourceExtension.test(file.path) && !isTestFile(file.path))
    .sort((a, b) => {
      const rank = (file) =>
        (/(^|\/)(src|app|lib)\//i.test(file.path) ? 0 : 1) +
        (/(main|app|index|server|api|model|service)\.[^.]+$/i.test(file.path) ? 0 : 1);
      return rank(a) - rank(b) || a.path.length - b.path.length;
    });

  sourceFiles.slice(0, 4).forEach(add);
  return selected;
}

async function readFile(owner, repo, branch, file) {
  const path = file.path.split('/').map(encodeURIComponent).join('/');
  const endpoint = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const result = await getJson(endpoint);
  if (result.encoding !== 'base64' || !result.content) return '';

  const binary = atob(result.content.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes).slice(0, MAX_TEXT_CHARS);
}

function extractSymbols(files) {
  const patterns = [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^\n]*?\)\s*=>/g,
    /(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g,
    /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)\s*func\s+(?:\([^\n]*?\)\s*)?([A-Za-z_]\w*)\s*\(/g,
    /(?:^|\n)\s*public\s+(?:static\s+)?[\w<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\(/g,
  ];
  const symbols = [];

  for (const file of files) {
    if (!sourceExtension.test(file.path) || isTestFile(file.path)) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (let match; (match = pattern.exec(file.content)) && symbols.length < 24;) {
        if (!['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
          symbols.push({ name: match[1], path: file.path });
        }
      }
    }
  }

  return [...new Map(symbols.map((symbol) => [`${symbol.path}#${symbol.name}`, symbol])).values()];
}

function getStackTags(language, files) {
  const tags = language ? [language] : [];
  for (const file of files) {
    const name = file.path.split('/').at(-1);
    if (name === 'package.json') tags.push('Node.js');
    if (['requirements.txt', 'pyproject.toml', 'Pipfile'].includes(name)) tags.push('Python');
    if (name === 'Cargo.toml') tags.push('Rust');
    if (name === 'go.mod') tags.push('Go');
    if (name === 'Dockerfile') tags.push('Docker');
    if (/\.tsx?$/.test(file.path)) tags.push('TypeScript');
    if (/\.jsx?$/.test(file.path)) tags.push('JavaScript');
  }

  const evidence = files.map((file) => file.content || '').join('\n').toLowerCase();
  const libraries = [
    [/fastapi/, 'FastAPI'], [/flask/, 'Flask'], [/django/, 'Django'],
    [/scikit[-_]learn|sklearn/, 'scikit-learn'], [/react/, 'React'],
    [/next[\/@]/, 'Next.js'], [/express/, 'Express'], [/vue/, 'Vue'],
    [/streamlit/, 'Streamlit'], [/tensorflow/, 'TensorFlow'],
    [/torch|pytorch/, 'PyTorch'], [/supabase/, 'Supabase'], [/sqlalchemy/, 'SQLAlchemy'],
  ];
  for (const [pattern, label] of libraries) if (pattern.test(evidence)) tags.push(label);
  return [...new Set(tags)].slice(0, 5);
}

function makeSignals(repo, files, tree, symbols) {
  const hasTests = tree.some((file) => file.type === 'blob' && isTestFile(file.path));
  const hasReadme = files.some((file) => fileKind(file.path) === 'Project overview');
  const symbol = symbols[0];
  const codeCount = tree.filter((file) => file.type === 'blob' && sourceExtension.test(file.path) && !ignoredPath.test(file.path)).length;

  return [
    ['01', hasTests ? 'Tests are present' : 'No obvious test files found', hasTests ? 'The repository includes test paths. Pick one to explain what behavior it protects.' : 'A small test suite would make behavior easier to verify as the project changes.'],
    ['02', symbol ? 'Code entry points found' : 'Source files mapped', symbol ? `${symbol.name} appears in ${symbol.path}. Use it as an anchor for the questions below.` : `${repo.language || 'The primary language'} appears in ${codeCount} recognizable source files.`],
    ['03', hasReadme ? 'Project notes available' : 'Project notes are sparse', hasReadme ? 'The README can help compare the project’s stated purpose with its implementation.' : 'A concise README would make the intended behavior and setup clearer.'],
  ];
}

function makeQuestions(repo, files, symbols) {
  const firstSymbol = symbols[0];
  const secondSymbol = symbols[1];
  const firstAnchor = firstSymbol ? `${firstSymbol.name} in ${firstSymbol.path}` : files.find((file) => sourceExtension.test(file.path))?.path || 'the main source files';
  const secondAnchor = secondSymbol ? `${secondSymbol.name} in ${secondSymbol.path}` : files.find((file) => fileKind(file.path) === 'Configuration')?.path || 'the project structure';
  const language = repo.language || 'main language';
  const firstKeys = firstAnchor.split(/[\W_]+/);
  const secondKeys = secondAnchor.split(/[\W_]+/);

  const candidates = [
    { type: 'Explain · Code path', text: `In ${firstAnchor}, explain what the function or class is responsible for and how its input becomes an output.`, keys: [...firstKeys, ...language.split(/\W+/), 'input', 'output', 'return', 'call', 'process'], hint: 'Name a concrete input, the important step, and the result.' },
    { type: 'Predict · Dependencies', text: `Looking at ${secondAnchor}, what could change in the program if an important dependency or configuration value were missing? Explain where you would notice it.`, keys: [...secondKeys, 'import', 'depend', 'config', 'error', 'fail', 'load', 'test', 'install', 'version'], hint: 'Trace where this dependency or setting is first used.' },
    { type: 'Modify · Behavior', text: `Choose a function or class in ${firstAnchor}. How would you change its behavior for an additional valid input case, and what existing behavior should remain unchanged?`, keys: [...firstKeys, 'function', 'class', 'input', 'case', 'test', 'change', 'return', 'validate', 'edge'], hint: 'Describe one change and one test that would protect current behavior.' },
    { type: 'Debug · Evidence', text: `A user reports an unexpected result in ${repo.name}. Which file or symbol would you inspect first, and what would you log or test to narrow down the cause?`, keys: [...firstKeys, ...symbols.slice(0, 2).map((symbol) => symbol.name), 'test', 'log', 'trace', 'input', 'output', 'error', 'reproduce', 'assert'], hint: 'Start with one reproducible input and follow it through the selected code path.' },
    { type: 'Trace · Data flow', text: `Trace a value from an input or caller into ${firstAnchor}. Which steps transform it before the result is returned or displayed?`, keys: [...firstKeys, 'input', 'parameter', 'transform', 'return', 'output', 'call', 'value'], hint: 'Follow one named value across the functions that handle it.' },
    { type: 'Design · Edge case', text: `What edge case could cause surprising behavior in ${firstAnchor}, and how would you handle and test that case?`, keys: [...firstKeys, 'empty', 'null', 'invalid', 'boundary', 'edge', 'test', 'validate', 'error'], hint: 'Pick a concrete boundary input, expected behavior, and a test.' },
    { type: 'Explain · Architecture', text: `How does ${secondAnchor} fit into the project, and what other part of ${repo.name} appears to depend on it?`, keys: [...secondKeys, 'import', 'module', 'depend', 'call', 'config', 'entry', 'project'], hint: 'Explain the file’s role and name one connection to another component.' },
    { type: 'Test · Confidence', text: `What test would give you confidence that ${firstAnchor} still works after a change? Describe the setup, action, and expected result.`, keys: [...firstKeys, 'test', 'assert', 'expect', 'input', 'output', 'result', 'mock'], hint: 'State the test input and the exact outcome you expect.' },
    { type: 'Trade-off · Implementation', text: `What is one trade-off in the approach used by ${firstAnchor}? Describe an alternative and when it might be preferable.`, keys: [...firstKeys, 'trade', 'alternative', 'performance', 'simple', 'complex', 'memory', 'latency'], hint: 'Compare the current approach with one alternative in a specific situation.' },
    { type: 'Dependencies · Failure mode', text: `If a dependency used by ${secondAnchor} changes its behavior, what could break and how would you detect it early?`, keys: [...secondKeys, 'depend', 'version', 'breaking', 'test', 'error', 'upgrade', 'interface'], hint: 'Name a dependency boundary and a test or check that guards it.' },
    { type: 'Debug · Reproduction', text: `Describe the smallest reproducible example you would create for a bug in ${repo.name}, and how you would use it to locate the faulty code.`, keys: [...firstKeys, 'reproduce', 'minimal', 'input', 'test', 'trace', 'debug', 'assert'], hint: 'Reduce the failure to a small input and trace it through a named symbol.' },
    { type: 'Modify · Review', text: `Before changing ${firstAnchor}, what existing behavior might be affected, and how would you verify the change did not cause a regression?`, keys: [...firstKeys, 'behavior', 'regression', 'test', 'change', 'compatibility', 'existing'], hint: 'Name one dependent behavior and a regression test for it.' },
  ];

  // Shuffle once per repository analysis so every new assessment receives a fresh, unique set.
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
  }
  return candidates;
}

export async function analyzeRepository(owner, repoName) {
  const repo = await getJson(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`);
  if (repo.private) throw new Error('This prototype currently supports public repositories only.');
  if (!repo.default_branch) throw new Error('GitHub did not report a default branch for this repository.');

  const branches = await getJson(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/branches?per_page=100`)
    .then((items) => Array.isArray(items) ? items.map((item) => item.name).filter(Boolean) : [])
    .catch(() => [repo.default_branch]);

  const treeResult = await getJson(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);
  const tree = treeResult.tree || [];
  if (!tree.length) throw new Error('This repository appears to be empty.');

  const selected = chooseFiles(tree);
  const files = [];
  for (const file of selected) {
    try {
      const content = await readFile(owner, repoName, repo.default_branch, file);
      if (content) files.push({ ...file, content });
    } catch (error) {
      if (/rate limit/i.test(error.message || '')) throw error;
    }
  }

  if (!files.some((file) => sourceExtension.test(file.path))) {
    throw new Error('Could not read source files from this repository. Check that it contains supported code files.');
  }

  const symbols = extractSymbols(files);
  const hasTests = tree.some((file) => file.type === 'blob' && isTestFile(file.path));
  const hasReadme = files.some((file) => fileKind(file.path) === 'Project overview');
  const hasManifest = files.some((file) => fileKind(file.path) === 'Configuration');
  const structureBreakdown = [
    { label: 'Base project signal', earned: 35, possible: 35, reason: 'Starting points for a readable, non-empty public repository.' },
    { label: 'Primary language identified', earned: repo.language ? 15 : 0, possible: 15, reason: repo.language ? `GitHub identifies ${repo.language} as the primary language.` : 'GitHub did not report a primary language.' },
    { label: 'README available', earned: hasReadme ? 15 : 0, possible: 15, reason: hasReadme ? 'A README was found and read from the selected project files.' : 'No readable README was found among selected project files.' },
    { label: 'Dependency/configuration manifest', earned: hasManifest ? 15 : 0, possible: 15, reason: hasManifest ? 'A recognized dependency or configuration manifest was found and read.' : 'No recognized dependency or configuration manifest was found among selected files.' },
    { label: 'Test files present', earned: hasTests ? 20 : 0, possible: 20, reason: hasTests ? 'The repository tree includes paths that look like tests.' : 'No obvious test paths were found in the repository tree.' },
  ];
  const structureScore = Math.min(100, structureBreakdown.reduce((total, item) => total + item.earned, 0));

  return {
    owner,
    repo: repoName,
    name: repo.name,
    url: repo.html_url,
    language: repo.language,
    defaultBranch: repo.default_branch,
    branches,
    files: files.map((file) => ({ path: file.path, kind: fileKind(file.path) })),
    evidence: files.filter((file) => sourceExtension.test(file.path)).slice(0, 4).map((file) => ({ path: file.path, content: file.content.slice(0, 4500) })),
    signals: makeSignals(repo, files, tree, symbols),
    questions: makeQuestions(repo, files, symbols),
    tags: getStackTags(repo.language, files),
    structureScore,
    structureBreakdown,
    codeFileCount: tree.filter((file) => file.type === 'blob' && sourceExtension.test(file.path) && !ignoredPath.test(file.path)).length,
    treeWasTruncated: Boolean(treeResult.truncated),
  };
}
