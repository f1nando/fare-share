import assert from 'node:assert/strict';
import test from 'node:test';
import { createCityRenderer, createWebGLReporter, isWebGLUnavailable, WebGLUnavailableError } from '../src/city/webglSupport.js';
import { startBackgroundScene } from '../src/city/backgroundScene.js';

test('unsupported WebGL is detected before constructing Three renderer', () => {
  let constructed = false;
  const document = { createElement: () => ({ getContext: () => null }) };
  assert.throws(() => createCityRenderer(class { constructor() { constructed = true; } }, document), WebGLUnavailableError);
  assert.equal(constructed, false);
  assert.throws(() => createCityRenderer(class {}, { createElement: () => ({ getContext() { throw new Error('GPU disabled'); } }) }), WebGLUnavailableError);
});
test('supported renderer reuses the checked WebGL2 context and existing options', () => {
  const context = {};
  const canvas = { getContext(type, options) { assert.equal(type, 'webgl2'); assert.equal(options.antialias, true); return context; } };
  const renderer = createCityRenderer(class { constructor(options) { this.options = options; } }, { createElement: () => canvas });
  assert.equal(renderer.options.context, context);
  assert.equal(renderer.options.canvas, canvas);
  assert.equal(renderer.options.powerPreference, 'high-performance');
});
test('3D unavailability is reported only once per page; unrelated errors are not classified', () => {
  const reports = [];
  const report = createWebGLReporter((error, context) => reports.push({ error, context }));
  report('landing'); report('landing'); report('other-background');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].error.name, 'WebGLUnavailableError');
  assert.equal(reports[0].context.event, 'webgl-unavailable');
  assert.equal(isWebGLUnavailable('THREE.WebGLRenderer: Error creating WebGL context.'), true);
  assert.equal(isWebGLUnavailable(new Error('Resource failed to load')), false);
});
function container() {
  const listeners = new Map();
  return { listeners, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
}
test('initialization failure enables fallback; settings updates and cleanup stay safe', () => {
  const target = container();
  let fallback = 0, warning = 0;
  const scene = startBackgroundScene(target, {}, {
    createScene() { throw new WebGLUnavailableError(); }, onFallback() { fallback++; }, onUnavailable() { warning++; }, onError() { assert.fail('Not a fatal error'); },
  });
  scene.updateSettings({}); scene.dispose(); scene.dispose();
  assert.equal(fallback, 1); assert.equal(warning, 1); assert.equal(target.listeners.size, 0);
});
test('context loss disposes scene once and enables fallback, but other failures remain errors', () => {
  const target = container();
  let disposed = 0, fallback = 0, warning = 0;
  const scene = startBackgroundScene(target, {}, {
    createScene: () => ({ dispose() { disposed++; }, updateSettings() {} }),
    onFallback() { fallback++; }, onUnavailable() { warning++; }, onError() { assert.fail('Not a fatal error'); },
  });
  target.listeners.get('webglcontextlost')({ preventDefault() {} });
  scene.dispose();
  assert.equal(disposed, 1); assert.equal(fallback, 1); assert.equal(warning, 1);
  let fatal = 0;
  startBackgroundScene(container(), {}, { createScene() { throw new Error('Unexpected scene bug'); }, onFallback() {}, onUnavailable() { assert.fail('Not a WebGL problem'); }, onError() { fatal++; } });
  assert.equal(fatal, 1);
});
