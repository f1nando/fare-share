import { CAMERA_OFFSET } from './activeWorld.js';

// A separate presentation offset: pointer input never changes the moving world
// origin or the traffic simulation. Reuse the same output on every frame.
export function createPointerCamera(container, onAvailabilityChange = () => {}) {
  const pointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const horizontal = Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
  const rightX = CAMERA_OFFSET.z / horizontal, rightZ = -CAMERA_OFFSET.x / horizontal;
  const downX = CAMERA_OFFSET.x / horizontal, downZ = CAMERA_OFFSET.z / horizontal;
  const offset = { x: 0, z: 0 };
  let active = false, mouseSeen = false, targetX = 0, targetY = 0, x = 0, y = 0;
  const reset = () => { targetX = 0; targetY = 0; };
  const move = event => {
    if (event.pointerType !== 'mouse' || reduced.matches) return;
    // Some embedded browsers report no fine/hover device despite receiving
    // real mouse events. Trust the event, without enabling anything for touch.
    if (!mouseSeen) { mouseSeen = true; availability(); }
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) { reset(); return; }
    targetX = (event.clientX - rect.left) / rect.width * 2 - 1;
    targetY = (event.clientY - rect.top) / rect.height * 2 - 1;
    // Corners have the same half-block maximum as the middle of an edge.
    const length = Math.max(1, Math.hypot(targetX, targetY));
    targetX /= length; targetY /= length;
  };
  const leave = event => { if (!event.relatedTarget) reset(); };
  function listen(enabled) {
    const method = enabled ? 'addEventListener' : 'removeEventListener';
    window[method]('pointerout', leave);
    window[method]('blur', reset);
  }
  function availability() {
    const next = (pointer.matches || mouseSeen) && !reduced.matches;
    if (next === active) return;
    active = next;
    listen(active);
    reset(); x = 0; y = 0; offset.x = 0; offset.z = 0;
    onAvailabilityChange();
  }
  active = pointer.matches && !reduced.matches;
  // Dormant on touch devices: return before geometry reads or camera updates.
  window.addEventListener('pointermove', move, { passive: true });
  if (active) listen(true);
  pointer.addEventListener('change', availability);
  reduced.addEventListener('change', availability);
  return {
    get active() { return active; },
    update(delta, blockSize, moving = true) {
      if (!active || !moving) return offset;
      const blend = -Math.expm1(-5 * Math.max(0, delta));
      x += (targetX - x) * blend; y += (targetY - y) * blend;
      const distance = blockSize / 2;
      offset.x = (rightX * x + downX * y) * distance;
      offset.z = (rightZ * x + downZ * y) * distance;
      return offset;
    },
    dispose() {
      window.removeEventListener('pointermove', move);
      if (active) listen(false);
      pointer.removeEventListener('change', availability);
      reduced.removeEventListener('change', availability);
    },
  };
}
