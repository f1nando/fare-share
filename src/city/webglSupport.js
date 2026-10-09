export class WebGLUnavailableError extends Error {
  constructor() {
    super('3D unavailable: this browser could not create a WebGL 2 context.');
    this.name = 'WebGLUnavailableError';
    this.code = 'WEBGL_UNAVAILABLE';
  }
}

export function isWebGLUnavailable(error) {
  if (error?.code === 'WEBGL_UNAVAILABLE' || error?.name === 'WebGLUnavailableError') return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /^(?:THREE\.WebGLRenderer:.*(?:WebGL context|context could not be created)|(?:Error creating|Could not create) (?:a )?WebGL context)/i.test(message);
}

export function createWebGLReporter(report) {
  let reported = false;
  return component => {
    if (reported) return;
    reported = true;
    report(new WebGLUnavailableError(), { event: 'webgl-unavailable', component });
  };
}

export function createCityRenderer(Renderer, browserDocument = document) {
  const canvas = browserDocument.createElement('canvas');
  const options = { antialias: true, alpha: false, powerPreference: 'high-performance' };
  let context;
  try { context = canvas.getContext('webgl2', options); }
  catch { throw new WebGLUnavailableError(); }
  if (!context) throw new WebGLUnavailableError();
  // Reuse this context, avoiding Three.js's repeated console errors on unsupported GPUs.
  return new Renderer({ ...options, canvas, context });
}
