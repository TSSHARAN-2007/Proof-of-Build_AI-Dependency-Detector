let audioContext;

function playTone() {
  if (!audioContext || audioContext.state !== 'running') return;

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(720, now);
  oscillator.frequency.exponentialRampToValueAtTime(190, now + 0.095);
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(0.12, now + 0.006);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
  oscillator.connect(volume);
  volume.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.11);
}

function playPop() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    audioContext ||= new AudioContextClass();
    if (audioContext.state === 'suspended') {
      // Resume directly inside the click gesture; play after the browser unlocks audio.
      void audioContext.resume().then(playTone).catch(() => {});
      return;
    }
    playTone();
  } catch {
    // Sound is decorative; unsupported or blocked audio must not affect the UI.
  }
}

export function enableClickPops() {
  // Capture phase still sees clicks if a control's own handler stops bubbling.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest('button, a[href], input[type="radio"], select, [role="button"], [role="option"], .mcq-option');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return;
    playPop();
  }, true);
}
