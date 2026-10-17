// Old WebViews (Android 6) must be able to parse the UI: enforce ES5 syntax.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const acorn = require('acorn');
for (const f of ['engine.js', 'i18n.js', 'app.js', 'vendor/jsQR.js']) {
  test(`${f} is valid ES5`, () => {
    const src = fs.readFileSync(`${__dirname}/../web/${f}`, 'utf8');
    acorn.parse(src, { ecmaVersion: 5 });
  });
}
test('CSS avoids features missing from old WebViews', () => {
  const css = fs.readFileSync(`${__dirname}/../web/style.css`, 'utf8');
  assert.ok(!/var\(--/.test(css), 'no CSS variables');
  assert.ok(!/display:\s*grid/.test(css), 'no grid');
  assert.ok(!/\bgap:/.test(css), 'no flex/grid gap');
  assert.ok(!/aspect-ratio|inset:|:is\(|:where\(/.test(css), 'no modern selectors/props');
});
