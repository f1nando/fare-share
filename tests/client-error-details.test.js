import assert from 'node:assert/strict';
import test from 'node:test';
import { browserErrorDetails, resourceLocation, createErrorReportGate } from '../src/clientErrorDetails.js';

test('CSS href, image currentSrc, and script src identify failed resources', () => {
  const browserWindow = {};
  for (const target of [
    { tagName: 'LINK', href: 'https://site.test/assets/style.css' },
    { tagName: 'IMG', currentSrc: 'https://cdn.test/large.webp', src: '/small.webp' },
    { tagName: 'SCRIPT', src: 'https://site.test/assets/app.js' },
  ]) {
    const details = browserErrorDetails({ target }, browserWindow);
    assert.equal(details.error, 'Resource failed to load');
    assert.equal(details.context.event, 'resource-error');
    assert.equal(details.context.resource, target.currentSrc || target.src || target.href);
    assert.equal(details.context.resourceType, target.tagName.toLowerCase());
  }
});
test('runtime errors preserve source file and line without mislabeling a resource', () => {
  const browserWindow = {};
  const error = new Error('Rendering failed');
  const details = browserErrorDetails({ target: browserWindow, error, filename: 'https://site.test/app.js', lineno: 42, colno: 7 }, browserWindow);
  assert.equal(details.error, error);
  assert.deepEqual(details.context, { event: 'window-error', filename: 'https://site.test/app.js', line: 42, column: 7 });
});
test('resource locations remove credentials, query, fragment, and non-HTTP payloads', () => {
  assert.equal(resourceLocation('https://user:password@cdn.test/a.css?token=secret#fragment', 'https://site.test'), 'https://cdn.test/a.css');
  assert.equal(resourceLocation('/a.js?key=secret', 'https://site.test'), 'https://site.test/a.js');
  assert.equal(resourceLocation('data:text/plain,private', 'https://site.test'), '');
});
test('SVG animated href resolves to the real image URL, never an object string', () => {
  const target = { tagName: 'image', href: { baseVal: '/driving-demo/mark.webp', animVal: '/driving-demo/mark.webp' } };
  const details = browserErrorDetails({ target }, {});
  assert.equal(details.context.resource, '/driving-demo/mark.webp');
  assert.equal(details.context.resourceType, 'image');
  assert.equal(resourceLocation(target.href, 'https://site.test'), 'https://site.test/driving-demo/mark.webp');
  assert.equal(resourceLocation({}, 'https://site.test'), '');
  assert.equal(resourceLocation(undefined, 'https://site.test'), '');
});
test('SVG attribute fallback supports href and legacy xlink references', () => {
  const target = { tagName: 'image', href: {}, getAttribute: name => name === 'href' ? '/image.webp' : null };
  assert.equal(browserErrorDetails({ target }, {}).context.resource, '/image.webp');
  const legacy = { tagName: 'image', getAttributeNS: (namespace, name) => {
    assert.equal(namespace, 'http://www.w3.org/1999/xlink'); assert.equal(name, 'href'); return '/legacy.webp';
  } };
  assert.equal(browserErrorDetails({ target: legacy }, {}).context.resource, '/legacy.webp');
});
test('repeated resource errors produce one report, preserving distinct resources and bounded size', () => {
  const gate = createErrorReportGate(2);
  const payload = { path: '/', name: 'Error', message: 'Resource failed to load', context: { event: 'resource-error', resource: 'https://site.test/mark.webp', resourceType: 'image' } };
  assert.equal(gate(payload), true);
  for (let i = 0; i < 20; i++) assert.equal(gate(payload), false);
  assert.equal(gate({ ...payload, context: { ...payload.context, resource: 'https://site.test/other.webp' } }), true);
  assert.equal(gate({ ...payload, message: 'A third distinct error' }), false);
  // A new page has its own reporting budget and can report the same failed resource.
  assert.equal(createErrorReportGate()(payload), true);
});
test('same messages at different JavaScript locations remain distinct errors', () => {
  const gate = createErrorReportGate();
  const payload = { path: '/', name: 'Error', message: 'Rendering failed', context: { event: 'window-error', filename: 'https://site.test/app.js', line: 10 } };
  assert.equal(gate(payload), true);
  assert.equal(gate({ ...payload, context: { ...payload.context, line: 20 } }), true);
  assert.equal(gate({ ...payload, stack: 'different call site' }), true);
});
