import { adaptQuestion, gradeReflection } from './assessment.js';
import { analyzeRepository, compareBranches, createSampleAnalysis, parseRepositoryUrl } from './github.js';
import { createVoiceInput } from './voice-input.js';
import { enableClickPops } from './sound-effects.js';

enableClickPops();

const $ = (selector) => document.querySelector(selector);
const elements = {
  form: $('#repoForm'),
  url: $('#repoUrl'),
  status: $('#status'),
  statusMessage: $('#status span'),
  results: $('#results'),
  projectTitle: $('#projectTitle'),
  tags: $('#tags'),
  tree: $('#tree'),
  insights: $('#insights'),
  structureMetric: $('#structureMetric'),
  structureBar: $('#structureBar'),
  answerMetric: $('#understandingMetric'),
  answerBar: $('#understandingBar'),
  gapMetric: $('#gapMetric'),
  gapBar: $('#gapBar'),
  questionCount: $('#qCount'),
  questionType: $('#qType'),
  questionText: $('#question'),
  answer: $('#answer'),
  answerWrap: $('.answer-wrap'),
  mcqOptions: $('#mcqOptions'),
  assessmentLength: $('#assessmentLength'),
  llmStatus: $('#llmStatus'),
  retryQuestionBtn: $('#retryQuestionBtn'),
  submitAnswer: $('#submitAnswer'),
  continueAnswer: $('#continueAnswer'),
  feedback: $('#feedback'),
  retryVerification: $('#retryVerification'),
  report: $('#report'),
  reportRows: $('#reportRows'),
  wrongAnswers: $('#wrongAnswers'),
  reviewCard: $('#reviewCard'),
  reviewCount: $('#reviewCount'),
  reviewPrev: $('#reviewPrev'),
  reviewNext: $('#reviewNext'),
  liveAnswerReview: $('#liveAnswerReview'),
  liveReviewPrev: $('#liveReviewPrev'),
  liveReviewNext: $('#liveReviewNext'),
  liveReviewCount: $('#liveReviewCount'),
  liveReviewCard: $('#liveReviewCard'),
  metricDialog: $('#metricDialog'),
  metricDialogTitle: $('#metricDialogTitle'),
  metricDialogContent: $('#metricDialogContent'),
  toast: $('#toast'),
  teamMode: $('#teamMode'),
  teamNames: $('#teamNames'),
  teammateOne: $('#teammateOne'),
  teammateTwo: $('#teammateTwo'),
  saveProgress: $('#saveProgress'),
  respondentLabel: $('#respondentLabel'),
  questionEvidence: $('#questionEvidence'),
  evidenceMeta: $('#evidenceMeta'),
  evidenceExcerpt: $('#evidenceExcerpt'),
  evidenceLink: $('#evidenceLink'),
  compareBranch: $('#compareBranch'),
  compareRevisions: $('#compareRevisions'),
  revisionResult: $('#revisionResult'),
  skillRows: $('#skillRows'),
  progressHistory: $('#progressHistory'),
  progressRows: $('#progressRows'),
  shareReport: $('#shareReport'),
  challengeCode: $('#challengeCode'),
  runChallenge: $('#runChallenge'),
  challengeStatus: $('#challengeStatus'),
  challengeResults: $('#challengeResults'),
};

let project = null;
let questionIndex = 0;
let reflectionResults = [];
let toastTimer;
let reviewIndex = 0;
let liveReviewIndex = 0;
let allowQuestionRetry = false;
let selectedChoiceIndex = null;
let llmQuotaMessage = '';
let currentSessionId = '';
const voiceInput = createVoiceInput({ button: $('#voiceBtn'), status: $('#voiceStatus'), textarea: elements.answer });

let llmConfigured = false;
let llmStatusReady = fetch('/api/verify')
  .then(async (response) => {
    const status = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(status.error || `HTTP ${response.status}`);
    return status;
  })
  .then((status) => {
    llmConfigured = Boolean(status.configured);
    elements.llmStatus.textContent = status.configured
      ? `LLM answer checks · ${status.provider} · ${status.verifyModel || status.model} · questions · ${status.model}`
      : 'English repository questions and local estimates are ready · add a server provider key to enable LLM screening.';
    elements.llmStatus.classList.toggle('configured', status.configured);
    return status;
  })
  .catch(() => {
    elements.llmStatus.textContent = 'Assessment API route is unavailable. Restart with start-local.bat, or redeploy the latest project on Vercel.';
    return null;
  });

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function findQuestionEvidence(question) {
  const files = project?.evidence || [];
  if (!files.length) return null;
  const prompt = String(question.text || '').toLowerCase();
  const ranked = files.map((file) => {
    const path = file.path.toLowerCase();
    const pathTerms = path.split(/[\W_]+/).filter((term) => term.length > 2);
    return { file, score: pathTerms.filter((term) => prompt.includes(term)).length };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.file || files[0];
}

function skillForQuestion(type = '') {
  const value = type.toLowerCase();
  if (value.includes('debug')) return 'Debugging';
  if (value.includes('test')) return 'Testing';
  if (value.includes('modify')) return 'Code changes';
  if (value.includes('trace')) return 'Data flow';
  if (value.includes('depend') || value.includes('architecture')) return 'System design';
  return 'Conceptual clarity';
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3400);
}

async function postJson(endpoint, payload) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the assessment API. Restart the updated local server or check the deployed API route.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error || (response.status === 404
      ? 'The assessment API route was not found. Restart with start-local.bat or deploy the latest project version.'
      : `The assessment API returned HTTP ${response.status}.`);
    throw new Error(detail);
  }
  return data;
}

function setProgress(activeStep) {
  for (let step = 1; step <= 3; step += 1) {
    $(`#st${step}`).classList.toggle('active', step === activeStep);
    $(`#st${step}`).classList.toggle('done', step < activeStep);
  }
}

function setAssessmentLength(count) {
  elements.assessmentLength.value = String(count);
  document.querySelectorAll('.choice-option').forEach((option) => {
    const selected = option.dataset.count === String(count);
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-pressed', String(selected));
    option.disabled = Boolean(project);
  });
  try { sessionStorage.setItem('proof-of-build-length', String(count)); } catch { /* The choice still applies to this page. */ }
}

function renderProject(analysis) {
  project = analysis;
  elements.projectTitle.textContent = analysis.name;
  elements.tags.innerHTML = analysis.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('') +
    (analysis.url ? `<a class="tag" href="${escapeHtml(analysis.url)}" target="_blank" rel="noopener noreferrer">View repository ↗</a>` : '<span class="tag">Built-in offline demo</span>');
  elements.tree.innerHTML = analysis.files.map((file) =>
    `<div><span class="filename">${escapeHtml(file.path)}</span><span class="count">${escapeHtml(file.kind)}</span></div>`).join('');
  elements.insights.innerHTML = analysis.signals.map(([number, title, detail]) =>
    `<div class="insight"><strong><i>${escapeHtml(number)}</i>${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`).join('');
  const branches = [...new Set(analysis.branches || [analysis.defaultBranch])];
  elements.compareBranch.innerHTML = branches.map((branch) => `<option value="${escapeHtml(branch)}" ${branch === analysis.defaultBranch ? 'disabled' : ''}>${escapeHtml(branch)}${branch === analysis.defaultBranch ? ' · default' : ''}</option>`).join('');
  elements.compareRevisions.disabled = branches.filter((branch) => branch !== analysis.defaultBranch).length === 0;
  elements.revisionResult.textContent = branches.length > 1
    ? `Assessment evidence comes from ${analysis.defaultBranch}. Select another available branch to compare commits and changed files.`
    : `Only the default branch (${analysis.defaultBranch}) is available for this repository.`;

  elements.structureMetric.textContent = `${analysis.structureScore}%`;
  elements.structureBar.style.width = `${analysis.structureScore}%`;
  elements.answerMetric.textContent = '—';
  elements.answerBar.style.width = '0%';
  elements.gapMetric.textContent = '—';
  elements.gapBar.style.width = '0%';
  elements.results.classList.add('show');
  elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setProgress(2);
  beginAssessment();

  if (analysis.treeWasTruncated) showToast(`Mapped ${analysis.codeFileCount} source files. GitHub returned a partial tree for this large repository.`);
}

async function beginAssessment() {
  const activeProject = project;
  questionIndex = 0;
  reflectionResults = [];
  currentSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const count = Number(elements.assessmentLength.value);
  elements.report.classList.remove('show');
  elements.feedback.classList.remove('show');
  elements.retryVerification.hidden = true;
  elements.liveAnswerReview.hidden = true;
  elements.continueAnswer.hidden = true;
  elements.submitAnswer.hidden = false;
  elements.submitAnswer.disabled = true;
  elements.retryQuestionBtn.hidden = true;
  allowQuestionRetry = false;
  elements.questionType.textContent = 'Repository comprehension assessment';
  elements.questionText.textContent = `Preparing ${count} distinct questions from the repository code…`;
  const llmStatus = await llmStatusReady;
  if (project !== activeProject) return;
  if (!llmConfigured) {
    project.questions = project.questions.slice(0, count);
    if (count === 10) project.questions = makeFallbackChoices(project.questions);
    elements.llmStatus.textContent = llmStatus
      ? 'LLM not configured · Using English repository-based questions and local estimates.'
      : 'Assessment API unavailable · Using English repository-based questions and local estimates.';
    elements.llmStatus.classList.remove('configured');
    renderQuestion();
    return;
  }
  try {
    const data = await postJson('/api/verify', { action: 'questions', repository: project.name, count, evidence: project.evidence });
    if (project !== activeProject) return;
    if (!data.generated || !Array.isArray(data.questions)) throw new Error('The LLM returned an empty question set.');
    project.questions = data.questions;
    elements.llmStatus.textContent = `LLM questions · ${data.provider} · ${data.model} · fast answer checks · ${data.verifyModel || data.model}`;
    elements.llmStatus.classList.add('configured');
  } catch (error) {
    if (project !== activeProject) return;
    project.questions = project.questions.slice(0, count);
    if (count === 10) project.questions = makeFallbackChoices(project.questions);
    allowQuestionRetry = true;
    elements.retryQuestionBtn.hidden = false;
    showToast(`${error.message} Loaded the repository-based fallback questions.`);
    elements.llmStatus.textContent = `LLM screening unavailable · Using English repository-based fallback questions. ${error.message}`;
    elements.llmStatus.classList.remove('configured');
  }
  renderQuestion();
}

function renderQuestion() {
  const question = project.questions[questionIndex];
  const multipleChoice = Number(elements.assessmentLength.value) === 10;
  selectedChoiceIndex = null;
  elements.submitAnswer.disabled = false;
  elements.submitAnswer.hidden = false;
  elements.continueAnswer.hidden = true;
  elements.questionCount.textContent = `QUESTION ${String(questionIndex + 1).padStart(2, '0')} / ${String(project.questions.length).padStart(2, '0')}`;
  elements.questionType.textContent = question.type;
  elements.questionText.textContent = multipleChoice ? question.text : adaptQuestion(question, reflectionResults.at(-1)?.result);
  const targetEvidence = findQuestionEvidence(question);
  if (targetEvidence) {
    const lines = targetEvidence.content.split('\n');
    elements.evidenceMeta.textContent = `${targetEvidence.path} · selected excerpt`;
    elements.evidenceExcerpt.textContent = lines.slice(0, 34).map((line, index) => `${String(index + 1).padStart(3, ' ')}  ${line}`).join('\n');
    if (project.url) {
      elements.evidenceLink.href = `${project.url}/blob/${encodeURIComponent(project.defaultBranch)}/${targetEvidence.path.split('/').map(encodeURIComponent).join('/')}`;
      elements.evidenceLink.hidden = false;
    } else {
      elements.evidenceLink.hidden = true;
    }
    elements.questionEvidence.hidden = false;
    elements.questionEvidence.open = false;
  } else {
    elements.questionEvidence.hidden = true;
  }
  const pairMode = elements.teamMode.value === 'pair';
  const teammate = questionIndex % 2 === 0 ? elements.teammateOne.value.trim() || 'Teammate 1' : elements.teammateTwo.value.trim() || 'Teammate 2';
  elements.respondentLabel.textContent = pairMode ? `PAIR HANDOFF · ${teammate} ANSWERS THIS QUESTION` : 'TAKE YOUR TIME · THERE ARE NO TRICK QUESTIONS';
  elements.answer.value = '';
  elements.answerWrap.hidden = multipleChoice;
  elements.mcqOptions.hidden = !multipleChoice;
  elements.mcqOptions.innerHTML = multipleChoice ? question.choices.map((choice, index) =>
    `<label class="mcq-option"><input type="radio" name="assessmentChoice" value="${index}"><span class="mcq-letter">${String.fromCharCode(65 + index)}</span><span>${escapeHtml(choice)}</span></label>`).join('') : '';
  elements.mcqOptions.querySelectorAll('input[name="assessmentChoice"]').forEach((input) => {
    input.addEventListener('change', () => {
      selectedChoiceIndex = Number(input.value);
      elements.mcqOptions.querySelectorAll('.mcq-option').forEach((option) => option.classList.toggle('is-selected', option.querySelector('input').checked));
    });
  });
  elements.feedback.classList.remove('show');
  elements.retryVerification.hidden = true;
  elements.retryQuestionBtn.hidden = questionIndex !== 0 || !allowQuestionRetry;
  elements.submitAnswer.textContent = questionIndex === project.questions.length - 1 ? 'Finish assessment ↗' : 'Submit reflection ↗';
}

async function submitReflection() {
  const question = project.questions[questionIndex];
  const multipleChoice = Number(elements.assessmentLength.value) === 10;
  const answer = multipleChoice
    ? (selectedChoiceIndex === null ? '' : `${String.fromCharCode(65 + selectedChoiceIndex)}. ${question.choices[selectedChoiceIndex]}`)
    : elements.answer.value.trim();
  if (multipleChoice ? selectedChoiceIndex === null : answer.split(/\s+/).filter(Boolean).length < 5) {
    showToast(multipleChoice ? 'Choose one answer to continue.' : 'Add a little more detail to your reflection.');
    if (multipleChoice) elements.mcqOptions.querySelector('input')?.focus();
    else elements.answer.focus();
    return;
  }

  elements.submitAnswer.disabled = true;
  elements.submitAnswer.hidden = true;
  allowQuestionRetry = false;
  elements.retryQuestionBtn.hidden = true;
  voiceInput.stop();

  const assessedProject = project;
  const answeredQuestionIndex = questionIndex;
  const evaluationQuestion = multipleChoice
    ? `${elements.questionText.textContent}\nOptions:\n${question.choices.map((choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`).join('\n')}`
    : elements.questionText.textContent;
  const local = multipleChoice
    ? {
      points: selectedChoiceIndex === question.correctIndex ? 25 : 0,
      explanation: selectedChoiceIndex === question.correctIndex
        ? `Local quick check: your choice matches the fallback answer. ${question.hint}`
        : `Local quick check only: this choice does not match the fallback answer. ${question.hint}`,
      hint: question.hint,
    }
    : gradeReflection(answer, question);
  const result = {
    score: local.points * 4,
    points: local.points,
    correct: multipleChoice ? selectedChoiceIndex === question.correctIndex : null,
    verified: false,
    pending: llmConfigured,
    verdict: llmConfigured ? 'LLM verification in progress' : 'Local estimate · not LLM verified',
    explanation: llmConfigured ? `${local.explanation} Your answer is saved; you can continue while verification runs.` : `${local.explanation} Configure a provider key on the server to enable LLM verification.`,
    correction: '',
    tips: [local.hint],
    hint: local.hint,
  };
  const entry = { question: elements.questionText.textContent, prompt: evaluationQuestion, answer, result, skill: skillForQuestion(question.type), respondent: elements.teamMode.value === 'pair' ? (questionIndex % 2 === 0 ? elements.teammateOne.value.trim() || 'Teammate 1' : elements.teammateTwo.value.trim() || 'Teammate 2') : 'You', evidencePath: findQuestionEvidence(question)?.path || '' };
  const resultIndex = reflectionResults.length;
  reflectionResults.push(entry);
  renderFeedback(result);
  elements.retryVerification.hidden = true;
  liveReviewIndex = reflectionResults.length - 1;
  renderLiveAnswerReview();
  elements.liveAnswerReview.hidden = false;
  elements.continueAnswer.textContent = questionIndex === project.questions.length - 1 ? 'View results ↗' : 'Continue to next question →';
  elements.continueAnswer.hidden = false;
  elements.continueAnswer.disabled = false;
  if (llmConfigured) {
    void verifySubmittedAnswer({ entry, resultIndex, project: assessedProject, answerIndex: answeredQuestionIndex, question, multipleChoice });
  }
}

function renderFeedback(result) {
  const scoreLabel = result.verified ? `${result.score}/100` : `${Math.round(result.score)}/100 · ${result.pending ? 'preliminary' : 'local'}`;
  elements.feedback.innerHTML = `<strong>${escapeHtml(result.verdict)} · ${scoreLabel}</strong><span>${escapeHtml(result.explanation)}</span>${result.correction ? `<div class="feedback-hint"><b>One solid explanation:</b> ${escapeHtml(result.correction)}</div>` : ''}${result.tips?.length ? `<div class="feedback-hint"><b>Improving tip:</b> ${escapeHtml(result.tips[0])}</div>` : ''}`;
  elements.feedback.classList.add('show');
}

async function verifySubmittedAnswer({ entry, resultIndex, project: assessedProject, answerIndex, question, multipleChoice }) {
  if (!llmConfigured) return;
  if (llmQuotaMessage) {
    entry.result = {
      ...entry.result,
      pending: false,
      verdict: 'Local estimate · LLM quota unavailable',
      explanation: `${entry.result.explanation} ${llmQuotaMessage}`,
    };
    if (questionIndex === answerIndex) renderFeedback(entry.result);
    if (!elements.liveAnswerReview.hidden && liveReviewIndex === resultIndex) renderLiveAnswerReview();
    if (elements.report.classList.contains('show')) renderReport(false);
    return;
  }
  try {
    const data = await postJson('/api/verify', {
      repository: assessedProject.name,
      question: entry.prompt,
      answer: entry.answer,
      multipleChoice,
      evidence: assessedProject.evidence,
    });
    if (project !== assessedProject || reflectionResults[resultIndex] !== entry) return;
    entry.result = {
      score: data.score,
      points: data.score / 4,
      correct: data.correct,
      verified: true,
      pending: false,
      verdict: data.verdict,
      explanation: data.feedback,
      correction: data.correction,
      tips: data.tips,
      hint: question.hint,
    };
    elements.llmStatus.textContent = `LLM answer checks active · ${data.provider} · ${data.model}`;
    elements.llmStatus.classList.add('configured');
  } catch (error) {
    if (project !== assessedProject || reflectionResults[resultIndex] !== entry) return;
    if (/daily|quota|resource_exhausted/i.test(error.message)) {
      llmQuotaMessage = 'The configured LLM provider has reached its current API quota. Remaining answers will use local estimates until the quota resets or another provider is configured.';
      elements.llmStatus.textContent = llmQuotaMessage;
      elements.llmStatus.classList.remove('configured');
    }
    entry.result = {
      ...entry.result,
      pending: false,
      verdict: llmQuotaMessage ? 'Local estimate · LLM quota unavailable' : 'Local estimate · not LLM verified',
      explanation: `${entry.result.explanation} LLM verification could not complete: ${error.message}`,
    };
  }

  if (questionIndex === answerIndex) {
    renderFeedback(entry.result);
    elements.retryVerification.hidden = entry.result.verified;
  }
  if (!elements.liveAnswerReview.hidden && liveReviewIndex === resultIndex) renderLiveAnswerReview();
  if (elements.report.classList.contains('show')) renderReport(false);
}

async function retryLastVerification() {
  if (!project || !reflectionResults.length) return;
  if (llmQuotaMessage) {
    showToast('The LLM quota is exhausted. Wait for it to reset or configure another provider.');
    return;
  }
  const index = elements.liveAnswerReview.hidden ? reflectionResults.length - 1 : liveReviewIndex;
  const entry = reflectionResults[index];
  const assessmentProject = project;
  elements.retryVerification.disabled = true;
  elements.continueAnswer.disabled = true;
  elements.feedback.innerHTML = '<strong>Retrying LLM verification…</strong><span>Your answer is preserved while the provider checks it against the repository.</span>';
  elements.feedback.classList.add('show');
  try {
    const data = await postJson('/api/verify', {
      repository: project.name,
      question: entry.prompt || entry.question,
      answer: entry.answer,
      multipleChoice: Number(elements.assessmentLength.value) === 10,
      evidence: project.evidence,
    });
    if (project !== assessmentProject) return;
    entry.result = {
      score: data.score,
      points: data.score / 4,
      correct: data.correct,
      verified: true,
      verdict: data.verdict,
      explanation: data.feedback,
      correction: data.correction,
      tips: data.tips,
      hint: project.questions[index]?.hint || '',
    };
    const result = entry.result;
    elements.feedback.innerHTML = `<strong>${escapeHtml(result.verdict)} · ${result.score}/100</strong><span>${escapeHtml(result.explanation)}</span>${result.correction ? `<div class="feedback-hint"><b>One solid explanation:</b> ${escapeHtml(result.correction)}</div>` : ''}<div class="feedback-hint"><b>Improving tip:</b> ${escapeHtml(result.tips[0] || result.hint)}</div>`;
    elements.retryVerification.hidden = true;
    liveReviewIndex = index;
    renderLiveAnswerReview();
    elements.llmStatus.textContent = `LLM verification active · ${data.provider} · ${data.model}`;
    elements.llmStatus.classList.add('configured');
    if (elements.report.classList.contains('show')) renderReport(false);
  } catch (error) {
    if (project !== assessmentProject) return;
    entry.result = { ...entry.result, explanation: `${entry.result.explanation} Retry failed: ${error.message}` };
    elements.feedback.innerHTML = `<strong>LLM verification is still unavailable</strong><span>${escapeHtml(error.message)} Your answer remains saved in this assessment. You can retry again or continue with the clearly labeled local estimate.</span>`;
    renderLiveAnswerReview();
    if (elements.report.classList.contains('show')) renderReport(false);
  } finally {
    elements.retryVerification.disabled = false;
    elements.continueAnswer.disabled = false;
    elements.retryVerification.hidden = reflectionResults[index]?.result.verified === true;
  }
}

function renderLiveAnswerReview() {
  if (!reflectionResults.length) return;
  liveReviewIndex = Math.max(0, Math.min(liveReviewIndex, reflectionResults.length - 1));
  const entry = reflectionResults[liveReviewIndex];
  const result = entry.result;
  elements.retryVerification.hidden = result.verified || result.pending || Boolean(llmQuotaMessage);
  elements.liveReviewCount.textContent = `${liveReviewIndex + 1} / ${reflectionResults.length}`;
  elements.liveReviewPrev.disabled = liveReviewIndex === 0;
  elements.liveReviewNext.disabled = liveReviewIndex === reflectionResults.length - 1;
  elements.liveReviewCard.innerHTML = `<article class="review-entry"><div class="review-verdict"><span>${escapeHtml(result.verdict)}</span><b>${result.verified ? `${result.score}/100` : `${Math.round(result.score)}/100 · ${result.pending ? 'preliminary' : 'unverified'}`}</b></div><h5>${escapeHtml(entry.question)}</h5>${entry.evidencePath ? `<div class="review-block"><b>Repository evidence</b><p>${escapeHtml(entry.evidencePath)}</p></div>` : ''}<div class="review-block"><b>Your answer</b><p>${escapeHtml(entry.answer)}</p></div><div class="review-block"><b>Explanation</b><p>${escapeHtml(result.explanation)}</p></div><div class="review-block reference"><b>Reference answer</b><p>${escapeHtml(result.correction || (result.pending ? 'Waiting for the LLM reference answer…' : 'An LLM reference answer is unavailable for this response.'))}</p></div></article>`;
}

function continueAssessment() {
  if (questionIndex < project.questions.length - 1) {
    questionIndex += 1;
    renderQuestion();
  } else {
    renderReport();
  }
}

function makeFallbackChoices(questions) {
  return questions.map((question) => {
    const anchor = question.text.match(/\b(?:in|for|about|used by)\s+([^?.]+)/i)?.[1]?.trim().slice(0, 100) || 'the referenced code';
    const kind = question.type.toLowerCase();
    let correct;
    let distractors;
    if (kind.includes('debug')) {
      correct = `Reproduce a small failing case, then trace it through ${anchor} and inspect the relevant inputs and outputs.`;
      distractors = ['Rewrite the whole repository before isolating the failure.', 'Assume the last changed file is responsible without reproducing the issue.', 'Ignore the input and change an unrelated dependency.'];
    } else if (kind.includes('modify')) {
      correct = `Handle the additional case in ${anchor} and add a test that confirms existing behavior still works.`;
      distractors = ['Replace the existing behavior without checking callers.', 'Change an unrelated file and skip regression checks.', 'Accept every input so no validation is needed.'];
    } else if (kind.includes('predict') || kind.includes('depend')) {
      correct = `Trace where the dependency or setting from ${anchor} is loaded and used, then check its failure behavior.`;
      distractors = ['Assume missing dependencies are silently replaced by defaults.', 'Look only at the page styling because configuration cannot affect runtime.', 'Remove the dependency without checking its imports or callers.'];
    } else if (kind.includes('test')) {
      correct = `Test a representative input through ${anchor} and assert the expected result and an important edge case.`;
      distractors = ['Check only that the application starts, without asserting behavior.', 'Use a test unrelated to the code path.', 'Skip tests because the code compiled once.'];
    } else if (kind.includes('edge')) {
      correct = `Choose a concrete boundary or invalid input for ${anchor}, define the expected behavior, and test it.`;
      distractors = ['Assume all inputs are valid and avoid validation.', 'Change behavior without deciding what the boundary case should do.', 'Test only the most typical input.'];
    } else if (kind.includes('architecture')) {
      correct = `Describe the role of ${anchor} and support its connection to another project part with an import or call.`;
      distractors = ['Assume its role from the filename alone.', 'Describe an unrelated module without tracing a connection.', 'Treat every file as independent even when code imports it.'];
    } else if (kind.includes('trade')) {
      correct = `Compare the approach in ${anchor} with a specific alternative and explain when the trade-off matters.`;
      distractors = ['Claim one approach is always best without a use case.', 'List a different library without explaining the impact.', 'Discuss code style without considering behavior or constraints.'];
    } else {
      correct = `Trace a concrete input through ${anchor}, explain the visible processing step, and connect it to the result.`;
      distractors = ['Repeat the project description without explaining this code.', 'Guess behavior that is not shown in the repository excerpts.', 'Describe an unrelated file instead of following the code path.'];
    }
    const choices = [correct, ...distractors];
    const correctIndex = Math.floor(Math.random() * choices.length);
    [choices[0], choices[correctIndex]] = [choices[correctIndex], choices[0]];
    return { ...question, choices, correctIndex };
  });
}

function renderReport(shouldScroll = true) {
  const answerCueScore = Math.round(reflectionResults.reduce((total, entry) => total + entry.result.score, 0) / reflectionResults.length);
  const signalDifference = Math.abs(project.structureScore - answerCueScore);
  elements.answerMetric.textContent = `${answerCueScore}%`;
  elements.answerBar.style.width = `${answerCueScore}%`;
  elements.gapMetric.textContent = `${signalDifference}%`;
  elements.gapBar.style.width = `${signalDifference}%`;

  const weakest = [...bySkill.entries()].sort((a, b) => a[1].reduce((x, y) => x + y, 0) / a[1].length - b[1].reduce((x, y) => x + y, 0) / b[1].length)[0]?.[0] || 'Conceptual clarity';
  const practiceBySkill = {
    'Debugging': 'Reproduce one bug with a minimal input, then trace its failing path.',
    'Testing': 'Write one assertion for a boundary case in the selected code.',
    'Code changes': 'Make one small behavior change and add a regression check.',
    'Data flow': 'Trace one value from its input to the returned or displayed result.',
    'System design': 'Map one module import to the behavior it enables.',
    'Conceptual clarity': 'Explain one selected function from input through output.',
  };
  const nextFocus = `${weakest}: ${practiceBySkill[weakest] || practiceBySkill['Conceptual clarity']}`;
  const rows = [
    ['LLM verified answers', `${reflectionResults.filter((entry) => entry.result.verified).length} / ${reflectionResults.length}`],
    ['LLM checks pending', `${reflectionResults.filter((entry) => entry.result.pending).length}`],
    ['Understanding estimate', `${answerCueScore}%`],
    ['Questions completed', `${reflectionResults.length} / ${project.questions.length}`],
    ['Next focus', nextFocus],
    ['Files considered', `${project.files.length} representative files`],
  ];
  elements.reportRows.innerHTML = rows.map(([label, value]) =>
    `<div class="report-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');
  const bySkill = new Map();
  reflectionResults.forEach((entry) => {
    const values = bySkill.get(entry.skill) || [];
    values.push(entry.result.score);
    bySkill.set(entry.skill, values);
  });
  elements.skillRows.innerHTML = [...bySkill.entries()].map(([skill, scores]) => {
    const score = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
    return `<div class="skill-row"><div><b>${escapeHtml(skill)}</b><span>${scores.length} question${scores.length === 1 ? '' : 's'} · ${reflectionResults.filter((entry) => entry.skill === skill && entry.result.verified).length} LLM verified</span></div><div class="skill-track"><i style="width:${score}%"></i></div><strong>${score}%</strong></div>`;
  }).join('') + `<p class="report-note">Each skill signal averages the question scores assigned to that category. Categories with few questions have lower confidence; local estimates are not verified.</p>`;
  if (elements.teamMode.value === 'pair') {
    const teammateScores = new Map();
    reflectionResults.forEach((entry) => {
      const values = teammateScores.get(entry.respondent) || [];
      values.push(entry.result.score);
      teammateScores.set(entry.respondent, values);
    });
    elements.reportRows.insertAdjacentHTML('beforeend', [...teammateScores.entries()].map(([name, scores]) => `<div class="report-row"><span>${escapeHtml(name)} · assigned questions</span><b>${Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)}% · ${scores.length}</b></div>`).join(''));
  }
  renderProgressHistory(answerCueScore, [...bySkill.entries()].map(([skill, scores]) => [skill, Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)]));
  const misses = reflectionResults.filter((entry) => !entry.result.pending && (entry.result.correct === false || (!entry.result.verified && entry.result.score < 40)));
  const tips = [...new Set(reflectionResults.flatMap((entry) => entry.result.tips || []))].slice(0, 5);
  elements.wrongAnswers.innerHTML = `<h4>Questions to revisit <span>${misses.length}</span></h4>${misses.length ? misses.map((entry) => `<article class="wrong-answer"><b>${escapeHtml(entry.question)}</b><p><span>${entry.result.verified ? 'LLM result:' : 'Local estimate:'}</span> ${entry.result.verified ? 'Marked incorrect' : 'Unverified; consider reviewing'}</p><p><span>Your answer:</span> ${escapeHtml(entry.answer)}</p>${entry.result.correction ? `<p><span>Reference answer:</span> ${escapeHtml(entry.result.correction)}</p>` : ''}<p class="miss-feedback">${escapeHtml(entry.result.explanation)}</p></article>`).join('') : '<p class="all-correct">No answers were marked incorrect. Unverified local estimates cannot confirm correctness; review all answers above and use the tips below to deepen your explanations.</p>'}<h4>Improving tips</h4><ul>${tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul>`;
  reviewIndex = 0;
  renderAnswerReview();
  elements.report.classList.add('show');
  setProgress(3);
  if (shouldScroll) elements.report.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderProgressHistory(overall, skillScores) {
  if (!elements.saveProgress.checked || !project) {
    elements.progressHistory.hidden = true;
    return;
  }
  const key = `proof-of-build-progress:${project.owner}/${project.repo}`;
  try {
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    const record = { id: currentSessionId, date: new Date().toLocaleDateString(), score: overall, skills: Object.fromEntries(skillScores) };
    const previous = history.findIndex((item) => item.id === currentSessionId);
    if (previous >= 0) history[previous] = record;
    else history.push(record);
    localStorage.setItem(key, JSON.stringify(history.slice(-8)));
    const recent = history.slice(-5).reverse();
    elements.progressRows.innerHTML = recent.map((item) => `<div class="progress-item"><span>${escapeHtml(item.date)}</span><div class="skill-track"><i style="width:${Math.max(0, Math.min(100, Number(item.score) || 0))}%"></i></div><b>${Number(item.score) || 0}%</b></div>`).join('');
    elements.progressHistory.hidden = false;
  } catch {
    elements.progressHistory.hidden = true;
    showToast('This browser could not save local progress. Your assessment still works without saving.');
  }
}

function renderAnswerReview() {
  if (!reflectionResults.length) return;
  const entry = reflectionResults[reviewIndex];
  const result = entry.result;
  elements.reviewCount.textContent = `${reviewIndex + 1} / ${reflectionResults.length}`;
  elements.reviewPrev.disabled = reviewIndex === 0;
  elements.reviewNext.disabled = reviewIndex === reflectionResults.length - 1;
  elements.reviewCard.innerHTML = `<article class="review-entry"><div class="review-verdict"><span>${escapeHtml(result.verdict)}</span><b>${result.verified ? `${result.score}/100` : `${Math.round(result.score)}/100 · ${result.pending ? 'preliminary' : 'unverified'}`}</b></div><h5>${escapeHtml(entry.question)}</h5>${entry.evidencePath ? `<div class="review-block"><b>Repository evidence</b><p>${escapeHtml(entry.evidencePath)}</p></div>` : ''}<div class="review-block"><b>Your answer</b><p>${escapeHtml(entry.answer)}</p></div><div class="review-block"><b>Explanation</b><p>${escapeHtml(result.explanation)}</p></div><div class="review-block reference"><b>Reference answer</b><p>${escapeHtml(result.correction || (result.pending ? 'Waiting for the LLM reference answer…' : 'An LLM reference answer is unavailable for this response.'))}</p></div>${(result.tips || []).length ? `<div class="review-block"><b>Tips</b><ul>${result.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul></div>` : ''}</article>`;
}

function metricDetails(kind) {
  if (!project) return null;
  if (kind === 'structure') {
    const earned = project.structureBreakdown.reduce((total, item) => total + item.earned, 0);
    return {
      title: 'How structure coverage is calculated',
      body: `<p><b>${earned}%</b> = points found across repository signals (maximum 100). It measures visible project structure, not code quality.</p><ul>${project.structureBreakdown.map((item) => `<li><b>${escapeHtml(item.label)} · ${item.earned}/${item.possible}</b><br>${escapeHtml(item.reason)}</li>`).join('')}</ul>`,
    };
  }
  if (kind === 'understanding') {
    const score = reflectionResults.length ? Math.round(reflectionResults.reduce((total, entry) => total + entry.result.score, 0) / reflectionResults.length) : 0;
    return {
      title: 'How understanding estimate is calculated',
      body: `<p>The estimate is the average answer score: <b>${score}%</b> from ${reflectionResults.length} responses. LLM-verified responses are judged against selected code excerpts. A local fallback is a rough keyword cue score and is marked unverified.</p><ul>${reflectionResults.map((entry, index) => `<li><b>Question ${index + 1}: ${Math.round(entry.result.score)}%</b> · ${entry.result.verified ? 'LLM verified' : 'unverified local estimate'}</li>`).join('') || '<li>No answers have been scored yet.</li>'}</ul>`,
    };
  }
  const understanding = reflectionResults.length ? Math.round(reflectionResults.reduce((total, entry) => total + entry.result.score, 0) / reflectionResults.length) : 0;
  const difference = Math.abs(project.structureScore - understanding);
  return {
    title: 'How signal difference is calculated',
    body: reflectionResults.length
      ? `<p><b>${difference} percentage points</b> = |structure coverage ${project.structureScore}% − understanding estimate ${understanding}%|.</p><p>This only compares repository metadata signals with assessment answers. It is not a measure of AI use or proof that someone does not understand their code. Click the other score cards to inspect each side of this comparison.</p>`
      : `<p>This score is calculated after the assessment is complete. It will show the absolute difference between structure coverage (${project.structureScore}%) and the average answer score.</p><p>It compares repository metadata with assessment responses; it is not a measure of AI use.</p>`,
  };
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let repository;
  try {
    repository = parseRepositoryUrl(elements.url.value.trim());
  } catch (error) {
    showToast(error.message);
    return;
  }

  elements.status.classList.add('show');
  elements.statusMessage.textContent = `Reading ${repository.owner}/${repository.repo} from GitHub…`;
  const submitButton = elements.form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const analysis = await analyzeRepository(repository.owner, repository.repo);
    try {
      sessionStorage.setItem('proof-of-build-repository', elements.url.value.trim());
      sessionStorage.setItem('proof-of-build-length', elements.assessmentLength.value);
    } catch { /* Assessment still works when browser storage is unavailable. */ }
    elements.status.classList.remove('show');
    renderProject(analysis);
    if (!analysis.treeWasTruncated) showToast(`Mapped ${analysis.codeFileCount} source files from ${analysis.name}.`);
  } catch (error) {
    elements.status.classList.remove('show');
    showToast(error instanceof TypeError
      ? 'Could not reach GitHub from this browser. Check your internet connection.'
      : (error.message || 'Repository analysis failed. Try again.'));
  } finally {
    submitButton.disabled = false;
  }
});

$('#demoBtn').addEventListener('click', () => {
  elements.url.value = '';
  const analysis = createSampleAnalysis();
  elements.status.classList.remove('show');
  renderProject(analysis);
  showToast('Loaded the built-in sample project. No GitHub request was needed.');
});

$('#resetBtn').addEventListener('click', () => {
  project = null;
  setAssessmentLength(elements.assessmentLength.value);
  elements.results.classList.remove('show');
  elements.url.value = '';
  try {
    sessionStorage.removeItem('proof-of-build-repository');
    sessionStorage.removeItem('proof-of-build-length');
  } catch { /* Reset remains usable when browser storage is unavailable. */ }
  setProgress(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

elements.submitAnswer.addEventListener('click', submitReflection);
elements.retryVerification.addEventListener('click', retryLastVerification);
elements.continueAnswer.addEventListener('click', continueAssessment);
elements.liveReviewPrev.addEventListener('click', () => {
  if (liveReviewIndex > 0) {
    liveReviewIndex -= 1;
    renderLiveAnswerReview();
  }
});
elements.liveReviewNext.addEventListener('click', () => {
  if (liveReviewIndex < reflectionResults.length - 1) {
    liveReviewIndex += 1;
    renderLiveAnswerReview();
  }
});
elements.reviewPrev.addEventListener('click', () => {
  if (reviewIndex > 0) {
    reviewIndex -= 1;
    renderAnswerReview();
  }
});
elements.reviewNext.addEventListener('click', () => {
  if (reviewIndex < reflectionResults.length - 1) {
    reviewIndex += 1;
    renderAnswerReview();
  }
});

document.querySelectorAll('.metric-trigger').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    const details = metricDetails(trigger.dataset.metric);
    if (!details) return;
    elements.metricDialogTitle.textContent = details.title;
    elements.metricDialogContent.innerHTML = details.body;
    elements.metricDialog.showModal();
  });
});
$('#metricDialogClose').addEventListener('click', () => elements.metricDialog.close());
elements.metricDialog.addEventListener('click', (event) => {
  if (event.target === elements.metricDialog) elements.metricDialog.close();
});

document.querySelectorAll('.choice-option').forEach((button) => {
  button.addEventListener('click', () => {
    setAssessmentLength(button.dataset.count);
  });
});

elements.retryQuestionBtn.addEventListener('click', () => {
  if (project && allowQuestionRetry) beginAssessment();
});

elements.teamMode.addEventListener('change', () => {
  elements.teamNames.hidden = elements.teamMode.value !== 'pair';
  if (!project) return;
  const question = project.questions[questionIndex];
  if (question) {
    const teammate = questionIndex % 2 === 0 ? elements.teammateOne.value.trim() || 'Teammate 1' : elements.teammateTwo.value.trim() || 'Teammate 2';
    elements.respondentLabel.textContent = elements.teamMode.value === 'pair' ? `PAIR HANDOFF · ${teammate} ANSWERS THIS QUESTION` : 'TAKE YOUR TIME · THERE ARE NO TRICK QUESTIONS';
  }
});

elements.compareRevisions.addEventListener('click', async () => {
  if (!project) return;
  const branch = elements.compareBranch.value;
  if (!branch || branch === project.defaultBranch) return;
  elements.compareRevisions.disabled = true;
  elements.revisionResult.textContent = `Comparing ${project.defaultBranch} with ${branch}…`;
  try {
    const comparison = await compareBranches(project.owner, project.repo, project.defaultBranch, branch);
    const files = (comparison.files || []).slice(0, 8).map((file) => `<li><a href="${escapeHtml(file.blob_url || `${project.url}/blob/${encodeURIComponent(branch)}/${file.filename.split('/').map(encodeURIComponent).join('/')}`)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.filename)}</a><span>+${Number(file.additions) || 0} / −${Number(file.deletions) || 0}</span></li>`).join('');
    elements.revisionResult.innerHTML = `<strong>${escapeHtml(project.defaultBranch)} → ${escapeHtml(branch)}</strong><p>${Number(comparison.total_commits) || 0} commits ahead · ${escapeHtml(comparison.status || 'compared')}</p>${files ? `<ul>${files}</ul>` : '<p>No file changes were returned for this comparison.</p>'}`;
  } catch (error) {
    elements.revisionResult.textContent = `Could not compare branches: ${error.message}`;
  } finally {
    elements.compareRevisions.disabled = false;
  }
});

elements.shareReport.addEventListener('click', async () => {
  if (!project || !reflectionResults.length) return;
  const score = Math.round(reflectionResults.reduce((total, entry) => total + entry.result.score, 0) / reflectionResults.length);
  const verified = reflectionResults.filter((entry) => entry.result.verified).length;
  const skills = [...new Set(reflectionResults.map((entry) => entry.skill))].map((skill) => {
    const entries = reflectionResults.filter((entry) => entry.skill === skill);
    return `${skill}: ${Math.round(entries.reduce((total, entry) => total + entry.result.score, 0) / entries.length)}%`;
  });
  const text = [`Proof of Build · ${project.name}`, `Learning estimate: ${score}% · ${verified}/${reflectionResults.length} LLM verified`, ...skills, 'This is a learning signal, not a hiring or authorship verdict.'].join('\n');
  try {
    if (navigator.share) await navigator.share({ title: `Proof of Build · ${project.name}`, text });
    else {
      await navigator.clipboard.writeText(text);
      showToast('A privacy-safe summary was copied. Your written answers were not included.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('Sharing is unavailable in this browser.');
  }
});

elements.runChallenge.addEventListener('click', () => {
  const code = elements.challengeCode.value.trim();
  if (!code) {
    elements.challengeStatus.textContent = 'Write a function before running the checks.';
    return;
  }
  elements.runChallenge.disabled = true;
  elements.challengeStatus.textContent = 'Running the hidden checks in an isolated browser sandbox…';
  elements.challengeResults.textContent = '';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.className = 'challenge-sandbox';
  frame.title = 'Isolated code challenge sandbox';
  frame.src = '/challenge-sandbox.html';
  frame.addEventListener('load', () => frame.contentWindow.postMessage(code, '*'), { once: true });
  document.body.append(frame);
  const timeout = setTimeout(() => finishChallenge({ error: 'The code exceeded the 2-second time limit or the sandbox did not respond.' }), 2000);
  function finishChallenge(result) {
    clearTimeout(timeout);
    frame.remove();
    elements.runChallenge.disabled = false;
    if (result.error) {
      elements.challengeStatus.textContent = 'The challenge could not run.';
      elements.challengeResults.innerHTML = `<p class="challenge-fail">${escapeHtml(result.error)}</p>`;
    } else {
      elements.challengeStatus.textContent = `${result.passed} of ${result.total} hidden checks passed.`;
      elements.challengeResults.innerHTML = `<p class="${result.passed === result.total ? 'challenge-pass' : 'challenge-fail'}">${result.passed === result.total ? 'All checks passed — the behavior change works for these cases.' : 'Some checks failed. Revisit trimming, case normalization, blanks, and preserving first-seen order.'}</p><details><summary>Reveal test coverage</summary><ul><li>Whitespace, normalization, empty values and non-strings</li><li>Empty input</li><li>Duplicate values while preserving order</li></ul></details>`;
    }
  }
  window.addEventListener('message', function onMessage(event) {
    if (event.source !== frame.contentWindow || event.data?.kind !== 'challenge') return;
    window.removeEventListener('message', onMessage);
    finishChallenge(event.data);
  });
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

try {
  const previousRepository = sessionStorage.getItem('proof-of-build-repository');
  const previousLength = sessionStorage.getItem('proof-of-build-length');
  if (previousRepository) {
    elements.url.value = previousRepository;
    if (['4', '10'].includes(previousLength)) setAssessmentLength(previousLength);
    elements.form.requestSubmit();
  }
} catch { /* The user can always start a fresh analysis manually. */ }

