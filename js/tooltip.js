// One shared tooltip for any element with data-tip (charts, badges, cells).
export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let current = null;

  const show = (el, x, y) => {
    current = el;
    tip.textContent = el.dataset.tip;
    tip.classList.add('on');
    position(x, y);
  };
  const position = (x, y) => {
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  };
  const hide = () => { current = null; tip.classList.remove('on'); };

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (el && el !== current) show(el, e.clientX, e.clientY);
    else if (!el && current) hide();
  });
  document.addEventListener('mousemove', e => { if (current) position(e.clientX, e.clientY); });
  document.addEventListener('focusin', e => {
    const el = e.target.closest('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left, r.bottom); }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
}
