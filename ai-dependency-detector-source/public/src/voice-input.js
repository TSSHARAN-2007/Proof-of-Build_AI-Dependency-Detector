export function createVoiceInput({ button, status, textarea }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    button.disabled = true;
    button.title = 'Voice dictation is not supported by this browser';
    button.setAttribute('aria-label', 'Voice dictation is not supported by this browser');
    status.textContent = 'Voice dictation is not supported by this browser.';
    return { stop() {} };
  }

  const recognition = new Recognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  let listening = false;
  let finalTranscript = '';
  let baseText = '';

  const setListening = (value) => {
    listening = value;
    button.setAttribute('aria-pressed', String(value));
    button.classList.toggle('recording', value);
    button.title = value ? 'Stop dictation' : 'Dictate answer';
    button.setAttribute('aria-label', value ? 'Stop voice dictation' : 'Use microphone to dictate your answer');
  };

  button.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    baseText = textarea.value.trim();
    finalTranscript = '';
    status.textContent = 'Listening. Speak your answer.';
    recognition.lang = navigator.language || 'en-US';
    try {
      recognition.start();
    } catch {
      status.textContent = 'Could not start voice dictation. Try again or type your answer.';
    }
  });

  recognition.onstart = () => setListening(true);
  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalTranscript += `${text} `;
      else interim += text;
    }
    textarea.value = [baseText, finalTranscript.trim(), interim].filter(Boolean).join(' ');
    status.textContent = interim ? `Hearing: ${interim}` : 'Speech added. You can edit your answer.';
  };
  recognition.onerror = (event) => {
    const messages = {
      'not-allowed': 'Microphone access was blocked. Allow it in browser settings or type instead.',
      'service-not-allowed': 'The browser speech service is unavailable. You can type instead.',
      'no-speech': 'No speech detected. Try again or type instead.',
      network: 'Voice service connection failed. You can type instead.',
    };
    status.textContent = messages[event.error] || 'Voice dictation stopped. You can type instead.';
  };
  recognition.onend = () => setListening(false);

  return {
    stop() {
      if (listening) recognition.stop();
    },
  };
}
