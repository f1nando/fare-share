import { isWebGLUnavailable, WebGLUnavailableError } from './webglSupport.js';

export function startBackgroundScene(container, settings, { createScene, onFallback, onUnavailable, onError }) {
  let scene;
  let disposed = false;
  let failed = false;
  const fail = error => {
    if (failed || disposed) return;
    failed = true;
    container.removeEventListener('webglcontextlost', lost, true);
    scene?.dispose();
    scene = null;
    onFallback();
    if (isWebGLUnavailable(error)) onUnavailable(error);
    else onError(error);
  };
  const lost = event => {
    event.preventDefault();
    fail(new WebGLUnavailableError());
  };
  container.addEventListener('webglcontextlost', lost, true);
  try {
    const created = createScene(container, settings);
    if (failed) created.dispose();
    else scene = created;
  }
  catch (error) { fail(error); }
  return {
    updateSettings(next) { scene?.updateSettings(next); },
    dispose() {
      if (disposed) return;
      disposed = true;
      container.removeEventListener('webglcontextlost', lost, true);
      scene?.dispose();
      scene = null;
    },
  };
}
