const test = require('node:test');
const assert = require('node:assert');
const E = require('../web/editor.js');
const S = E.state;
const w = (v, s, e, m) => E.wrap(S(v, s, e), m);

test('stats count words, characters and lines (Arabic too)', () => {
  assert.deepEqual(E.stats(''), { words: 0, chars: 0, lines: 0, seconds: 0 });
  assert.deepEqual(E.stats('one two\nthree'), { words: 3, chars: 13, lines: 2, seconds: 1 });
  assert.equal(E.stats(new Array(281).join('w ')).seconds, 120, '280 words = 2 minutes');
  assert.equal(E.stats('مرحبا بالعالم').words, 2);
});

test('bold / italic / strike / code wrap a selection and toggle off again', () => {
  let r = w('hello world', 0, 5, '**');
  assert.deepEqual([r.v, r.s, r.e], ['**hello** world', 2, 7]);
  r = E.wrap(r, '**');
  assert.deepEqual([r.v, r.s, r.e], ['hello world', 0, 5]);
  assert.equal(w('a b', 0, 3, '~~').v, '~~a b~~');
  assert.equal(w('x', 0, 1, '`').v, '`x`');
  assert.equal(w('say hi', 4, 6, '*').v, 'say *hi*');
});

test('marks go around the word under the caret, and an empty caret gets a pair', () => {
  let r = w('hello world', 8, 8, '**');
  assert.equal(r.v, 'hello **world**');
  assert.equal(r.s, 10);
  r = w('hi ', 3, 3, '**');
  assert.deepEqual([r.v, r.s], ['hi ****', 5]);
  r = E.wrap(r, '**'); // caret inside the empty pair removes it
  assert.equal(r.v, 'hi ');
});

test('italic inside bold adds a third star, and bold-italic toggles one layer at a time', () => {
  let r = w('**hi**', 0, 6, '*');
  assert.equal(r.v, '***hi***');
  r = E.wrap(r, '*');
  assert.equal(r.v, '**hi**');
  r = E.wrap(S('**hi**', 0, 6), '**');
  assert.equal(r.v, 'hi');
  assert.equal(w('*hi*', 0, 4, '*').v, 'hi');
});

test('spaces at the ends of a selection stay outside the marks', () => {
  assert.equal(w('a  b  c', 1, 6, '**').v, 'a  **b**  c');
});

test('arabic text and punctuation delimiters', () => {
  assert.equal(w('مرحبا، يا عالم', 2, 2, '**').v, '**مرحبا**، يا عالم');
});

test('several lines: each line gets its own marks; a second press removes all of them', () => {
  const r = w('one\n\ntwo', 0, 8, '**');
  assert.equal(r.v, '**one**\n\n**two**');
  assert.equal(E.wrap(r, '**').v, 'one\n\ntwo');
});

test('headings: set, change level and remove', () => {
  let r = E.heading(S('Title', 2), 2);
  assert.equal(r.v, '## Title');
  r = E.heading(r, 3);
  assert.equal(r.v, '### Title');
  r = E.heading(r, 3);
  assert.equal(r.v, 'Title');
  r = E.heading(S('a\n\nb', 0, 4), 1);
  assert.equal(r.v, '# a\n\n# b');
});

test('lists: bullets, numbers, tasks, quotes; toggle off; convert between kinds', () => {
  let r = E.list(S('a\nb\nc', 0, 5), 'ul');
  assert.equal(r.v, '- a\n- b\n- c');
  assert.equal(E.list(r, 'ul').v, 'a\nb\nc');
  r = E.list(r, 'ol');
  assert.equal(r.v, '1. a\n2. b\n3. c');
  r = E.list(r, 'task');
  assert.equal(r.v, '- [ ] a\n- [ ] b\n- [ ] c');
  assert.equal(E.list(r, 'task').v, 'a\nb\nc');
  r = E.list(S('x\ny', 0, 3), 'quote');
  assert.equal(r.v, '> x\n> y');
  assert.equal(E.list(r, 'quote').v, 'x\ny');
  // blank lines are left alone and do not break the numbering
  assert.equal(E.list(S('a\n\nb', 0, 4), 'ol').v, '1. a\n\n2. b');
});

test('a selection that ends right after a line break does not touch the next line', () => {
  assert.equal(E.list(S('a\nb', 0, 2), 'ul').v, '- a\nb');
});

test('indent and outdent', () => {
  let r = E.indent(S('- a\n- b', 0, 7), 1);
  assert.equal(r.v, '  - a\n  - b');
  assert.equal(E.indent(r, -1).v, '- a\n- b');
  assert.equal(E.indent(S('x', 0), -1).v, 'x');
});

test('horizontal rule sits in its own paragraph', () => {
  assert.equal(E.rule(S('one', 3)).v, 'one\n\n---\n');
  assert.equal(E.rule(S('one\n\ntwo', 3)).v, 'one\n\n---\n\ntwo');
  assert.equal(E.rule(S('', 0)).v, '---\n');
});

test('tidy: line endings, trailing spaces, invisible characters and runs of blank lines', () => {
  const r = E.tidy(S('a  \r\n\r\n\r\n\r\nb c​', 0));
  assert.equal(r.v, 'a\n\nb c');
});

test('find wraps around, both ways, and respects case', () => {
  const v = 'Ab ab AB';
  assert.deepEqual(E.find(v, 'ab', 0, false), { index: 0, length: 2 });
  assert.deepEqual(E.find(v, 'ab', 1, false), { index: 3, length: 2 });
  assert.deepEqual(E.find(v, 'ab', 7, false), { index: 0, length: 2 }); // wrapped
  assert.deepEqual(E.find(v, 'ab', 6, false, true), { index: 3, length: 2 });
  assert.deepEqual(E.find(v, 'ab', 0, false, true), { index: 6, length: 2 }); // wrapped backwards
  assert.equal(E.find(v, 'ab', 0, true).index, 3);
  assert.equal(E.find(v, 'zz', 0, false), null);
  assert.equal(E.count(v, 'ab', false), 3);
  assert.equal(E.count(v, 'ab', true), 1);
  assert.equal(E.count(v, '', false), 0);
});

test('find treats the text literally (no regular expressions)', () => {
  assert.equal(E.count('a.b a+b (x)', '.', false), 1);
  assert.equal(E.count('a.b a+b (x)', '(x)', false), 1);
  assert.equal(E.count('a.b a+b', 'a+b', false), 1);
});

test('replace one needs the selection to be a match; replace all counts', () => {
  assert.equal(E.replaceOne(S('cat dog', 0, 3), 'cat', 'bird', false).v, 'bird dog');
  assert.equal(E.replaceOne(S('cat dog', 0, 0), 'cat', 'bird', false), null);
  assert.equal(E.replaceOne(S('cat dog', 4, 7), 'cat', 'bird', false), null);
  const r = E.replaceAll(S('a a A', 0), 'a', '$&$&', false);
  assert.equal(r.n, 3);
  assert.equal(r.st.v, '$&$& $&$& $&$&'); // replacement is literal
  assert.equal(E.replaceAll(S('x', 0), 'q', 'z', false).n, 0);
});

test('history: undo and redo, typing merged, tools are separate steps', () => {
  const h = new E.History();
  h.reset(S('', 0));
  h.record(S('h', 1), 100, true);   // first step after reset
  h.record(S('he', 2), 200, true);  // merged (same burst)
  h.record(S('hel', 3), 300, true);
  assert.equal(h.items.length, 2);
  h.record(S('hel ', 4), 400, true); // a space starts a new step (the next word joins it)
  h.record(S('hel w', 5), 500, true);
  assert.equal(h.items.length, 3);
  h.record(S('hel **w**', 9), 600, false); // a tool button
  assert.equal(h.items.length, 4);
  assert.equal(h.undo().v, 'hel w');
  assert.equal(h.undo().v, 'hel'); // undo goes back about one word at a time
  assert.equal(h.undo().v, '');
  assert.equal(h.undo(), null);
  assert.equal(h.redo().v, 'hel');
  // a new edit after undo drops the redo branch
  h.record(S('hex', 3), 5000, false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.undo().v, 'hel');
});

test('history: a pause starts a new step; selection is remembered; caps hold', () => {
  const h = new E.History(5, 1000);
  h.reset(S('a', 1));
  h.record(S('ab', 2), 10, true);
  h.record(S('abc', 3), 5000, true); // 5 s later
  assert.equal(h.items.length, 3);
  for (let i = 0; i < 20; i++) h.record(S('x' + i, 1), 10000 + i, false);
  assert.ok(h.items.length <= 5);
  const big = new E.History(300, 100);
  big.reset(S('', 0));
  for (let i = 0; i < 10; i++) big.record(S('y'.repeat(30 + i), 1), i, false);
  assert.ok(big.chars <= 100 + 40);
  assert.ok(big.canUndo());
});
