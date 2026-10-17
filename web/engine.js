/* CueMe scroll engine. Pure logic, no DOM: unit-tested with node.
 * Position is in px. step(dt) advances by REAL elapsed seconds, so speed is
 * identical on 30 Hz, 60 Hz and 144 Hz screens and survives dropped frames. */
(function (root) {
  'use strict';

  function Engine() {
    this.pos = 0;          // px from the start of the script
    this.max = 0;          // px at the end of the script
    this.playing = false;
    this.speed = 0;        // px / second while playing
    this.jog = 0;          // -1..1 held jog (fraction of jogSpeed)
    this.jogSpeed = 600;   // px / second at full jog
    this.target = null;    // px we are easing towards (seek), or null
    this.easeRate = 9;     // higher = snappier seek
    this.maxSeekV = 2400;  // px / second cap for short seeks (calm, readable glide)
    this.farRate = 5;      // long seeks: cover at most this fraction of the remaining distance per second
    this.ended = false;
  }

  Engine.prototype.setMax = function (max) {
    this.max = Math.max(0, max);
    if (this.pos > this.max) this.pos = this.max;
    if (this.target !== null && this.target > this.max) this.target = this.max;
  };

  Engine.prototype.progress = function () {
    return this.max > 0 ? this.pos / this.max : 0;
  };

  Engine.prototype.seekFraction = function (p) {
    if (!(p >= 0)) p = 0;
    if (p > 1) p = 1;
    this.target = p * this.max;
  };

  Engine.prototype.jump = function (px) { // instant, e.g. restoring layout
    this.pos = Math.min(this.max, Math.max(0, px));
    this.target = null;
  };

  Engine.prototype.play = function () { this.ended = false; this.playing = true; };
  Engine.prototype.pause = function () { this.playing = false; };

  /** Seconds left at the current speed (null if not meaningful). */
  Engine.prototype.eta = function () {
    if (this.speed <= 0) return null;
    return Math.max(0, (this.max - this.pos) / this.speed);
  };

  /** Advance by dt seconds. Returns true if the position changed. */
  Engine.prototype.step = function (dt) {
    if (!(dt > 0)) return false;
    if (dt > 0.1) dt = 0.1; // tab was hidden / long frame: never leap ahead
    var before = this.pos;

    if (this.target !== null) {
      var d = this.target - this.pos;
      var move = d * (1 - Math.exp(-this.easeRate * dt));
      // Short jumps glide at a readable speed; long jumps speed up in proportion
      // to the distance, so ANY jump (even 40 screens) takes under ~1 second and is still eased.
      var cap = Math.max(this.maxSeekV, Math.abs(d) * this.farRate) * dt;
      if (move > cap) move = cap;
      if (move < -cap) move = -cap;
      this.pos += move;
      if (Math.abs(this.target - this.pos) < 1) {
        this.pos = this.target;
        this.target = null;
      }
    } else if (this.jog !== 0) {
      this.pos += this.jog * this.jogSpeed * dt;
    } else if (this.playing) {
      this.pos += this.speed * dt;
    }

    if (this.pos < 0) this.pos = 0;
    if (this.pos >= this.max) {
      this.pos = this.max;
      if (this.playing && this.max > 0) {
        this.playing = false;
        this.ended = true;
      }
    }
    return this.pos !== before;
  };

  /** lines/min -> px/s for a given font size and line height factor. */
  Engine.speedToPx = function (linesPerMin, fontSize, lineHeight) {
    return (linesPerMin / 60) * fontSize * lineHeight;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.CueEngine = Engine;
})(typeof window !== 'undefined' ? window : this);
