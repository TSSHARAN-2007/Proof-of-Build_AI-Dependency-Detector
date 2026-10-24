const splash = document.querySelector('#introSplash');
const movingEmoji = document.querySelector('#introEmoji');
const headerEmoji = document.querySelector('#coolEmoji');
const swoosh = document.querySelector('#introSwoosh');
const swooshPath = document.querySelector('#introSwooshPath');

if (splash && movingEmoji && headerEmoji && swoosh && swooshPath) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let animation;
  let isFinished = false;

  const finish = () => {
    if (isFinished) return;
    isFinished = true;
    headerEmoji.classList.add('intro-visible');
    if (!animation) {
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
    const travelX = targetX - centerX;
    const travelY = targetY - centerY;
    const control1X = centerX + travelX * 0.36;
    const control1Y = centerY - Math.abs(travelY) * 0.28;
    const control2X = targetX - travelX * 0.15;
    const control2Y = targetY + Math.abs(travelY) * 0.18;

    swoosh.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    swooshPath.setAttribute('d', `M ${centerX} ${centerY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${targetX} ${targetY}`);
    const swooshLength = swooshPath.getTotalLength();
    swooshPath.style.strokeDasharray = `${swooshLength}`;
    swooshPath.style.strokeDashoffset = `${swooshLength}`;

    swooshPath.animate([
      { strokeDashoffset: `${swooshLength}`, opacity: 0 },
      { strokeDashoffset: `${swooshLength * 0.92}`, opacity: 0.9, offset: 0.12 },
      { strokeDashoffset: '0', opacity: 0.68 },
    ], {
      duration: 900,
      delay: 2550 * 0.56,
      easing: 'cubic-bezier(.2,.75,.18,1)',
      fill: 'forwards',
    });

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
        filter: 'drop-shadow(0 0 24px #f2d990) blur(.6px)',
        offset: 0.9,
      },
      {
        left: `${targetX}px`,
        top: `${targetY}px`,
        opacity: 1,
        transform: `translate(-50%, -50%) scale(${scale})`,
        filter: 'drop-shadow(0 0 18px #d7b87366) blur(0)',
        offset: 1,
      },
    ], {
      duration: 2550,
      easing: 'cubic-bezier(.2,.75,.18,1)',
      fill: 'forwards',
    });

    animation.finished.then(() => finish(false)).catch(() => {});
    reducedMotion.addEventListener?.('change', (event) => {
      if (event.matches) finish();
    }, { once: true });
  }
}
