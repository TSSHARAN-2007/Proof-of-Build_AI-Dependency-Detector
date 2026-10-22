# Proof of Build — AI Dependency Detector

A responsive black-and-gold prototype for checking how well a developer can explain a public GitHub project. This folder is a standalone repository that can be pushed to GitHub and deployed to Vercel.

## Run locally

Requirements: Node.js 18 or newer. There are no third-party package dependencies.

```bash
npm run dev
```

On Windows, double-click `start-local.bat`; or run `npm run dev` from this folder. Open the local URL printed in the terminal (normally `http://localhost:4173`; the server tries nearby ports if that one is busy). To enable LLM question generation and answer verification locally, copy `.env.example` to `.env`, add a provider API key, and choose a provider/model. The local server reads `.env`; never commit the real key. Use **Analyze a sample project** or paste a public repository URL. The app reads GitHub metadata, the recursive file tree, and up to seven small README, manifest, test, and source files.

GitHub repository reads go through the server API. GitHub’s unauthenticated quota is shared by visitors and can run out; to avoid this, set `GITHUB_TOKEN` in the server environment. Create a fine-grained token with read-only access to public repositories, add it to local `.env` or Vercel Project Settings → Environment Variables, then restart the local server or redeploy. The token stays on the server and is never sent to the browser. Without a token, wait for GitHub’s limit to reset; deploying the same app alone does not increase the shared unauthenticated quota.

## Learning and collaboration features

- Questions include a matching source excerpt and a link to the file on GitHub. The report separates session estimates into conceptual clarity, data flow, debugging, testing, code changes, and system design; each skill shows how many questions informed it and how many were LLM-verified.
- The 10-question assessment can alternate responsibility between two teammates on one device. The report shows each teammate’s assigned-question average; this is a collaboration aid, not a people ranking.
- Assessment questions and feedback are in English. Without a configured LLM provider, the app immediately uses English repository-grounded questions and clearly labels local answer estimates; it does not report the missing key as a question-generation failure.
- Compare the default branch with another available branch to see commit count and changed files.
- Complete an optional JavaScript behavior-change exercise. It runs in a temporary sandboxed iframe and a terminable Web Worker with network access blocked; it does not edit or execute repository files.
- Share a privacy-safe text summary. Answers are excluded. Progress history is saved only when the user opts in, and it stays in that browser’s local storage.
- A service worker caches the app shell and previously fetched public repository API responses for repeat and offline access. LLM answer requests are not cached.

After changing the API or `.env`, stop the old local server and launch `start-local.bat` again so it loads the current API route and settings. When a provider key is configured but screening fails, the assessment continues with repository-based fallback questions and offers **Retry LLM screening**. Confirm `AI_PROVIDER`, `AI_MODEL`, and the matching key are set in the server environment. The browser status reports which provider/model is active.

Answer grading uses Gemini Flash-Lite by default, separate from the configured model used to create repository questions. It sends only the two most relevant source excerpts, limits Gemini grading to low-latency reasoning, and returns shorter feedback. The local estimate and **Continue** button appear immediately while LLM verification runs in the background. The final report updates when checks finish. Answer grading times out after 20 seconds; 4-question and 10-question generation have 30- and 50-second limits. If grading fails, **Retry LLM verification** resends the saved answer. Set `AI_VERIFY_MODEL` to choose a different grading model. Redeploy the project after changing the API or Vercel configuration.

If the configured provider reports a quota limit, the current assessment stops making repeated verification calls and completes with clearly labeled local estimates. Wait for the provider quota to reset or configure another provider with an available API key.

## Build and preview

```bash
npm run build
npm run preview
```

The production static site is generated in `dist/`. The `/api/verify` serverless endpoint stays in the project-root `api/` directory for Vercel.

## Push this folder to GitHub

Create an empty repository on GitHub named `ai-dependency-detector`, then run these commands from this folder:

```bash
git init -b main
git add .
git commit -m "Build AI dependency detector prototype"
git remote add origin https://github.com/YOUR-USERNAME/ai-dependency-detector.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username. If you create a different repository name, update the remote URL accordingly.

## Deploy to Vercel

Import the GitHub repository in Vercel. `vercel.json` configures the build command as `npm run build` and the static output directory as `dist`. In the Vercel project settings, add `AI_PROVIDER`, `AI_MODEL`, and the matching provider secret (`GEMINI_API_KEY` or `OPENAI_API_KEY`) to enable server-side LLM verification. For an OpenAI-compatible service, set `AI_PROVIDER=openai-compatible`, `OPENAI_API_KEY`, and `OPENAI_BASE_URL`. Redeploy after adding or changing environment variables. Without a key, answers use a clearly labeled local cue estimate instead of claiming LLM verification.

## What is and is not real in this prototype

- **Live:** Public repository metadata, default branch, file tree, and selected file contents are read from GitHub through the server API. The demo button analyzes the public FastAPI repository.
- **Live:** Choose a 4-question written quick assessment or a 10-question multiple-choice deep dive. With an LLM key configured, the model creates distinct, repository-grounded questions; the deep dive includes four options per question. If LLM question generation is unavailable, the app provides repository-based fallback questions (multiple choice for the deep dive). Refreshing starts a fresh assessment for the same repository in that tab.
- **LLM verification:** With a server-side provider key configured, each answer and selected public source excerpts are sent to Gemini, OpenAI, or an OpenAI-compatible endpoint. The model evaluates correctness against those excerpts and returns feedback, a suggested explanation, and improvement tips. The API key never goes to the browser.
- **Optional voice input:** Each assessment answer field has a microphone icon. Supported browsers can transcribe speech into the editable answer; microphone access is requested only when the icon is clicked. The browser’s speech service may process audio. Typing remains available.
- **Click feedback:** Interactive buttons, links, and answer options play a short synthesized pop on click. No audio files or external sound services are required.
- **Answer review:** After each response, the assessment pauses for the user to continue. Previous/next arrows review answered questions, the submitted answer, its explanation, and an LLM reference answer when available. The final report also includes answer review and score cards that explain their calculations and repository evidence.
- **Fallback:** If no provider key is configured or the provider is unavailable, the app uses a local keyword estimate and labels it unverified. It is not a correctness check.
- **Observable metadata only:** Structure coverage counts signals such as language, README, dependency manifest, and tests; it is not a code-quality or authorship score.
- **Privacy:** Only public repositories are supported. When verification is configured, answer text and selected public source excerpts are sent to the chosen provider for processing. Answers remain in the page session; optional progress history stores only dates and aggregate scores on the current device. Review the provider’s data handling terms before use.
- **Limits:** GitHub API rate limits apply without a server token. Branch comparison is a summary of GitHub’s compare endpoint, not a full semantic diff review. The code-change task is an isolated JavaScript exercise, not a patch to the analyzed project. Browser caches contain only public repository API responses and app assets. Automatic AI-authorship detection is intentionally not provided. LLM judgments can be mistaken and are learning feedback, not hiring decisions.

## Project files

```text
public/
  index.html             Interface
  challenge-sandbox.html Isolated worker host for the code exercise
  styles.css             Responsive black-and-gold design
  src/
    assessment.js        Adaptive prompts and transparent local rubric
    voice-input.js       Optional browser speech recognition in every answer field
    github.js             Public GitHub intake, source excerpts, and question generation
    main.js              Interface state and report flow
  sw.js                  Low-bandwidth app-shell and public-repo cache
api/
  verify.js              Server-side Gemini/OpenAI answer verification
  github.js              Server-side GitHub proxy with optional private token
scripts/
  build.mjs              Creates the static Vercel output in dist/
  dev-server.mjs         Zero-dependency local development server
package.json             Project scripts and Node version
vercel.json              Vercel build/output configuration
```
