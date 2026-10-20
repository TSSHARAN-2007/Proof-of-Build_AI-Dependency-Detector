export function gradeReflection(answer, question) {
  const normalized = answer.toLowerCase();
  const matched = [...new Set(question.keys
    .map((cue) => cue.toLowerCase())
    .filter((cue) => cue.length > 2 && normalized.includes(cue)))];
  const wordCount = normalized.trim().split(/\s+/).filter(Boolean).length;
  const points = Math.min(25, Math.max(0, Math.round(matched.length * 5 + Math.min(wordCount, 60) / 8)));
  const label = points >= 18 ? 'Several code concepts mentioned' : points >= 10 ? 'Some code concepts mentioned' : 'Few code concepts matched';

  return {
    points,
    label,
    matched,
    hint: question.hint,
    explanation: `Matched ${matched.length} rubric cues${matched.length ? `: ${matched.slice(0, 4).join(', ')}` : ''}. This quick local rubric cannot judge correctness or depth; use the feedback as a reflection prompt.`,
  };
}

export function adaptQuestion(question, previousResult) {
  if (!previousResult) return question.text;
  if (previousResult.points < 10) {
    return `${question.text} Start with one specific file detail, then explain its role.`;
  }
  if (previousResult.points >= 18) {
    return `${question.text} Go deeper: include an edge case or a trade-off.`;
  }
  return question.text;
}

