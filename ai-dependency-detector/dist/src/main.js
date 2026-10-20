import { adaptQuestion, gradeReflection } from './assessment.js';
import { analyzeRepository, parseRepositoryUrl } from './github.js';
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
const voiceInput = createVoiceInput({ button: $('#voiceBtn'), status: $('#voiceStatus'), textarea: elements.answer });

fetch('/api/verify')
  .then(async (response) => {
    const status = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(status.error || `HTTP ${response.status}`);
    return status;
  })
  .then((status) => {
    elements.llmStatus.textContent = status.configured
      ? `LLM answer checks · ${status.provider} · ${status.verifyModel || status.model} · questions · ${status.model}`
      : 'LLM verification is not configured · local cue estimate will be labeled unverified.';
    elements.llmStatus.classList.toggle('configured', status.configured);
  })
  .catch(() => {
    elements.llmStatus.textContent = 'Assessment API route is unavailable. Restart with start-local.bat, or redeploy the latest project on Vercel.';
  });

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
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
    `<a class="tag" href="${escapeHtml(analysis.url)}" target="_blank" rel="noopener noreferrer">View repository ↗</a>`;
  elements.tree.innerHTML = analysis.files.map((file) =>
    `<div><span class="filename">${escapeHtml(file.path)}</span><span class="count">${escapeHtml(file.kind)}</span></div>`).join('');
  elements.insights.innerHTML = analysis.signals.map(([number, title, detail]) =>
    `<div class="insight"><strong><i>${escapeHtml(number)}</i>${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`).join('');

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
  elements.questionType.textContent = 'LLM-screened repository assessment';
  elements.questionText.textContent = `Preparing ${count} distinct questions from the repository code…`;
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
    elements.llmStatus.textContent = `LLM question generation failed · ${error.message}`;
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
    pending: true,
    verdict: 'LLM verification in progress',
    explanation: `${local.explanation} Your answer is saved; you can continue while verification runs.`,
    correction: '',
    tips: [local.hint],
    hint: local.hint,
  };
  const entry = { question: elements.questionText.textContent, prompt: evaluationQuestion, answer, result };
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
  void verifySubmittedAnswer({ entry, resultIndex, project: assessedProject, answerIndex: answeredQuestionIndex, question, multipleChoice });
}

function renderFeedback(result) {
  const scoreLabel = result.verified ? `${result.score}/100` : `${Math.round(result.score)}/100 · ${result.pending ? 'preliminary' : 'local'}`;
  elements.feedback.innerHTML = `<strong>${escapeHtml(result.verdict)} · ${scoreLabel}</strong><span>${escapeHtml(result.explanation)}</span>${result.correction ? `<div class="feedback-hint"><b>One solid explanation:</b> ${escapeHtml(result.correction)}</div>` : ''}${result.tips?.length ? `<div class="feedback-hint"><b>Improving tip:</b> ${escapeHtml(result.tips[0])}</div>` : ''}`;
  elements.feedback.classList.add('show');
}

async function verifySubmittedAnswer({ entry, resultIndex, project: assessedProject, answerIndex, question, multipleChoice }) {
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
  elements.liveReviewCard.innerHTML = `<article class="review-entry"><div class="review-verdict"><span>${escapeHtml(result.verdict)}</span><b>${result.verified ? `${result.score}/100` : `${Math.round(result.score)}/100 · ${result.pending ? 'preliminary' : 'unverified'}`}</b></div><h5>${escapeHtml(entry.question)}</h5><div class="review-block"><b>Your answer</b><p>${escapeHtml(entry.answer)}</p></div><div class="review-block"><b>Explanation</b><p>${escapeHtml(result.explanation)}</p></div><div class="review-block reference"><b>Reference answer</b><p>${escapeHtml(result.correction || (result.pending ? 'Waiting for the LLM reference answer…' : 'An LLM reference answer is unavailable for this response.'))}</p></div></article>`;
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

  const nextFocus = answerCueScore >= 70 ? 'Explain edge cases and trade-offs' : 'Trace one code path from input to output';
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
  const misses = reflectionResults.filter((entry) => !entry.result.pending && (entry.result.correct === false || (!entry.result.verified && entry.result.score < 40)));
  const tips = [...new Set(reflectionResults.flatMap((entry) => entry.result.tips || []))].slice(0, 5);
  elements.wrongAnswers.innerHTML = `<h4>Questions to revisit <span>${misses.length}</span></h4>${misses.length ? misses.map((entry) => `<article class="wrong-answer"><b>${escapeHtml(entry.question)}</b><p><span>${entry.result.verified ? 'LLM result:' : 'Local estimate:'}</span> ${entry.result.verified ? 'Marked incorrect' : 'Unverified; consider reviewing'}</p><p><span>Your answer:</span> ${escapeHtml(entry.answer)}</p>${entry.result.correction ? `<p><span>Reference answer:</span> ${escapeHtml(entry.result.correction)}</p>` : ''}<p class="miss-feedback">${escapeHtml(entry.result.explanation)}</p></article>`).join('') : '<p class="all-correct">No answers were marked incorrect. Unverified local estimates cannot confirm correctness; review all answers above and use the tips below to deepen your explanations.</p>'}<h4>Improving tips</h4><ul>${tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul>`;
  reviewIndex = 0;
  renderAnswerReview();
  elements.report.classList.add('show');
  setProgress(3);
  if (shouldScroll) elements.report.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderAnswerReview() {
  if (!reflectionResults.length) return;
  const entry = reflectionResults[reviewIndex];
  const result = entry.result;
  elements.reviewCount.textContent = `${reviewIndex + 1} / ${reflectionResults.length}`;
  elements.reviewPrev.disabled = reviewIndex === 0;
  elements.reviewNext.disabled = reviewIndex === reflectionResults.length - 1;
  elements.reviewCard.innerHTML = `<article class="review-entry"><div class="review-verdict"><span>${escapeHtml(result.verdict)}</span><b>${result.verified ? `${result.score}/100` : `${Math.round(result.score)}/100 · ${result.pending ? 'preliminary' : 'unverified'}`}</b></div><h5>${escapeHtml(entry.question)}</h5><div class="review-block"><b>Your answer</b><p>${escapeHtml(entry.answer)}</p></div><div class="review-block"><b>Explanation</b><p>${escapeHtml(result.explanation)}</p></div><div class="review-block reference"><b>Reference answer</b><p>${escapeHtml(result.correction || (result.pending ? 'Waiting for the LLM reference answer…' : 'An LLM reference answer is unavailable for this response.'))}</p></div>${(result.tips || []).length ? `<div class="review-block"><b>Tips</b><ul>${result.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul></div>` : ''}</article>`;
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
  elements.url.value = 'https://github.com/tiangolo/fastapi';
  elements.form.requestSubmit();
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

try {
  const previousRepository = sessionStorage.getItem('proof-of-build-repository');
  const previousLength = sessionStorage.getItem('proof-of-build-length');
  if (previousRepository) {
    elements.url.value = previousRepository;
    if (['4', '10'].includes(previousLength)) setAssessmentLength(previousLength);
    elements.form.requestSubmit();
  }
} catch { /* The user can always start a fresh analysis manually. */ }

