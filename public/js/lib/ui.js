/** Tiny DOM helpers shared by the app shell and activities. */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (val === undefined || val === null) continue;
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * A labelled group of pill buttons (single choice). Each choice is { value, label, preview? }.
 * Returns { node, get() }.
 */
export function choiceField(label, choices, value) {
  let current = value ?? choices[0].value;
  const group = el('div', { class: 'choices', role: 'radiogroup' });
  choices.forEach((c) => {
    const b = el('button', {
      type: 'button',
      class: `choice${c.preview ? ' choice-preview' : ''}`,
      role: 'radio',
      onclick: () => select(c.value),
    }, c.preview || null, el('span', { text: c.label }));
    b.dataset.value = c.value;
    group.append(b);
  });
  function select(v) {
    current = v;
    group.querySelectorAll('.choice').forEach((b) => {
      const on = b.dataset.value === String(v);
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  select(current);
  const node = el('div', { class: 'field' }, el('span', { text: label }), group);
  return { node, get: () => current, set: select, group };
}

export function rand32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  return (...args) => {
    pending = args;
    const now = performance.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn(...pending);
      pending = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = performance.now();
        if (pending) fn(...pending);
        pending = null;
      }, wait);
    }
  };
}
