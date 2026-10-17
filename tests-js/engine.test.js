const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../web/engine.js');

function run(e, seconds, fps) {
  const dt = 1 / fps;
  for (let i = 0; i < seconds * fps; i++) e.step(dt);
}

test('speed is frame-rate independent', () => {
  const out = [30, 60, 144].map((fps) => {
    const e = new Engine(); e.setMax(100000); e.speed = 100; e.play();
    run(e, 5, fps);
    return e.pos;
  });
  out.forEach((p) => assert.ok(Math.abs(p - 500) < 1, `pos ${p}`));
});

test('long frames are capped, never a big jump', () => {
  const e = new Engine(); e.setMax(100000); e.speed = 100; e.play();
  e.step(5); // tab was hidden for 5 s
  assert.ok(e.pos <= 10.0001, `pos ${e.pos}`);
});

test('stops and flags end at the end', () => {
  const e = new Engine(); e.setMax(100); e.speed = 1000; e.play();
  run(e, 1, 60);
  assert.strictEqual(e.pos, 100);
  assert.strictEqual(e.playing, false);
  assert.strictEqual(e.ended, true);
});

test('short seek: eased, monotonic, capped speed, lands exactly', () => {
  const e = new Engine(); e.setMax(100000); e.maxSeekV = 2400;
  e.seekFraction(0.01); // 1000 px away
  let last = e.pos, maxStep = 0, first = null, arrived = false;
  for (let i = 0; i < 600; i++) {
    e.step(1 / 60);
    assert.ok(e.pos >= last, 'monotonic');
    const step = e.pos - last;
    if (first === null) first = step;
    maxStep = Math.max(maxStep, step);
    last = e.pos;
    if (e.target === null) { arrived = true; break; }
  }
  assert.ok(arrived);
  assert.strictEqual(e.pos, 1000);
  assert.ok(first < 1000 * 0.2, 'does not teleport on the first frame: ' + first);
  assert.ok(maxStep <= Math.max(2400, 1000 * 5) / 60 + 1e-9, 'bounded step ' + maxStep);
});

test('very long seek: smooth and still arrives in about a second', () => {
  const e = new Engine(); e.setMax(1000000); // a 1,000,000 px script (hundreds of screens)
  e.seekFraction(0.95);
  let last = e.pos, frames = 0, jump1 = 0;
  while (e.target !== null && frames < 600) {
    e.step(1 / 60); frames++;
    assert.ok(e.pos >= last, 'monotonic');
    if (frames === 1) jump1 = e.pos - last;
    last = e.pos;
  }
  assert.strictEqual(e.pos, 950000);
  assert.ok(frames <= 150, 'arrived in ' + frames + ' frames (' + (frames / 60).toFixed(2) + ' s)');
  assert.ok(jump1 < 950000 * 0.09, 'first frame is a small fraction, not a teleport: ' + jump1);
});

test('seek does not move while playing, playback resumes after', () => {
  const e = new Engine(); e.setMax(10000); e.speed = 100; e.play();
  e.seekFraction(0.5);
  run(e, 10, 60);
  assert.strictEqual(e.target, null);
  assert.ok(e.pos > 5000);
  assert.strictEqual(e.playing, true);
});

test('jog moves both ways and overrides play', () => {
  const e = new Engine(); e.setMax(100000); e.pos = 5000; e.speed = 100; e.play();
  e.jog = -1; run(e, 1, 60);
  assert.ok(Math.abs(e.pos - (5000 - 600)) < 1);
  e.jog = 0.25; run(e, 2, 60);
  assert.ok(Math.abs(e.pos - (4400 + 300)) < 1);
});

test('never leaves the 0..max range, bad input is safe', () => {
  const e = new Engine(); e.setMax(50);
  e.jog = -1; run(e, 1, 60);
  assert.strictEqual(e.pos, 0);
  e.seekFraction(NaN); assert.strictEqual(e.target, 0);
  e.seekFraction(9); assert.strictEqual(e.target, 50);
  assert.strictEqual(e.step(-1), false);
  assert.strictEqual(e.step(NaN), false);
  e.setMax(10); assert.ok(e.target <= 10);
});

test('eta and speed conversion', () => {
  const e = new Engine(); e.setMax(1000); e.speed = 100; e.pos = 200;
  assert.strictEqual(e.eta(), 8);
  e.speed = 0; assert.strictEqual(e.eta(), null);
  assert.strictEqual(Engine.speedToPx(60, 50, 1.5), 75);
});
