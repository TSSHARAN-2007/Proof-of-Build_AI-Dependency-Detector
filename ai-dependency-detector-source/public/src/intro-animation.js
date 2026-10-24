const splash = document.querySelector('#introSplash');
const movingEmoji = document.querySelector('#introEmoji');
const headerEmoji = document.querySelector('#coolEmoji');
const skipButton = document.querySelector('#introSkip');

if (splash && movingEmoji && headerEmoji && skipButton) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let animation;
  let isFinished = false;

  const finish = (skip = false) => {
    if (isFinished) return;
    isFinished = true;
    headerEmoji.classList.add('intro-visible');
    if (skip || !animation) {
      animation?.cancel();
      splash.remove();
      return;
    }
    splash.classList.add('is-finished');
    window.setTimeout(() => splash.remove(), 320);
  };

  if (reducedMotion.matches || !movingEmoji.animate) {
    finish(true);
  } else {
    const target = headerEmoji.getBoundingClientRect();
    const origin = movingEmoji.getBoundingClientRect();
    const startSize = Math.max(origin.width, origin.height);
    const endSize = Math.max(target.width, target.height);
    const scale = Math.max(0.12, Math.min(0.3, endSize / startSize));
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const dropSettle = Math.max(110, centerY * 0.34);

    animation = movingEmoji.animate([
      {
        left: `${centerX}px`,
        top: `${-origin.height}px`,
        opacity: 0,
        transform: 'translate(-50%, -50%) scale(.72)',
        offset: 0,
      },
      {
        left: `${centerX}px`,
        top: `${dropSettle}px`,
        opacity: 1,
        transform: 'translate(-50%, -50%) scale(.94)',
        offset: 0.14,
      },
      {
        left: `${centerX}px`,
        top: `${centerY + 14}px`,
        opacity: 1,
        transform: 'translate(-50%, -50%) scale(1.05)',
        offset: 0.42,
      },
      {
        left: `${centerX}px`,
        top: `${centerY - 7}px`,
        opacity: 1,
        transform: 'translate(-50%, -50%) scale(.98)',
        offset: 0.49,
      },
      {
        left: `${centerX}px`,
        top: `${centerY}px`,
        opacity: 1,
        transform: 'translate(-50%, -50%) scale(1)',
        offset: 0.56,
      },
      {
        left: `${targetX}px`,
        top: `${targetY}px`,
        opacity: 1,
        transform: `translate(-50%, -50%) scale(${scale})`,
        offset: 0.9,
      },
      {
        left: `${targetX}px`,
        top: `${targetY}px`,
        opacity: 1,
        transform: `translate(-50%, -50%) scale(${scale})`,
        offset: 1,
      },
    ], {
      duration: 2550,
      easing: 'cubic-bezier(.2,.75,.18,1)',
      fill: 'forwards',
    });

    animation.finished.then(() => finish(false)).catch(() => {});
    skipButton.addEventListener('click', () => finish(true), { once: true });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(true);
    }, { once: true });
    reducedMotion.addEventListener?.('change', (event) => {
      if (event.matches) finish(true);
    }, { once: true });
  }
}
