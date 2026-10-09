// Classify existing Three.js records too, without changing or deleting old logs.
export const webglUnavailableFilter = { $or: [
  { name: 'WebGLUnavailableError' },
  { 'context.event': 'webgl-unavailable' },
  { message: { $regex: '^(THREE\\.WebGLRenderer:.*(WebGL context|context could not be created)|(Error creating|Could not create) (a )?WebGL context)', $options: 'i' } },
] };

export function browserErrorFilters(window) {
  return {
    errors: { ...window, source: 'client', $nor: webglUnavailableFilter.$or },
    webgl: { ...window, source: 'client', ...webglUnavailableFilter },
  };
}
