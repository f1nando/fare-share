import assert from 'node:assert/strict';
import test from 'node:test';
import { browserErrorDetails, resourceLocation } from '../src/clientErrorDetails.js';

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
