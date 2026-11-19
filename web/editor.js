/* CueMe script editor tools. Pure logic, no DOM: unit-tested with node, plain ES5.
 *
 * Every function takes and returns a "state": { v: text, s: selection start, e: selection end }
 * and never changes its argument. The panel (app.js) applies the returned state to the
 * <textarea> and keeps the undo history in a History object, so undo and redo also work
 * on phones (there is no Ctrl+Z on a touch keyboard) and after any tool button.
 */
(function (root) {
  'use strict';

  var E = {};

  function st(v, s, e) { return { v: v, s: s, e: e === undefined ? s : e }; }
  E.state = st;

  function lineStart(v, i) { return v.lastIndexOf('\n', i - 1) + 1; }
  function lineEnd(v, i) { var j = v.indexOf('\n', i); return j < 0 ? v.length : j; }

  /* ------------------------------------------------------------------ stats */
  E.stats = function (v) {
    var w = v.match(/\S+/g);
    var n = w ? w.length : 0;
    // reading aloud takes about 140 words a minute: a rough length for the script
    return { words: n, chars: v.length, lines: v === '' ? 0 : v.split('\n').length, seconds: Math.round(n / 140 * 60) };
  };

  /* ---------------------------------------------------- inline marks (** * ~~ `) */
  var DELIM = /[\s.,;:!?()\[\]{}"<>«»،؛؟\/\\|]/;

  function runLeft(v, i, ch) { var n = 0; while (i - 1 - n >= 0 && v.charAt(i - 1 - n) === ch) n++; return n; }
  function runRight(v, i, ch) { var n = 0; while (i + n < v.length && v.charAt(i + n) === ch) n++; return n; }

  /* is the span [s,e) already inside `mark`? (a lone * is italic only when its run is odd:
     ** is bold and *** is bold + italic) */
  function marked(v, s, e, mark) {
    var ch = mark.charAt(0), n = mark.length;
    var m = Math.min(runLeft(v, s, ch), runRight(v, e, ch));
    if (ch === '*' && n === 1) return m % 2 === 1;
    return m >= n;
  }

  // a selection that includes the marks themselves (e.g. all of **bold**): move inside them
  function inside(v, s, e, ch) {
    while (e - s >= 3 && v.charAt(s) === ch && v.charAt(e - 1) === ch) { s++; e--; }
    return [s, e];
  }

  // one span, returns {v, s, e, d} where d is how much the text grew
  function wrapSpan(v, s, e, mark) {
    var ch = mark.charAt(0), n = mark.length;
    var x = inside(v, s, e, ch);
    s = x[0]; e = x[1];
    if (marked(v, s, e, mark)) {
      return { v: v.slice(0, s - n) + v.slice(s, e) + v.slice(e + n), s: s - n, e: e - n, d: -2 * n };
    }
    return { v: v.slice(0, s) + mark + v.slice(s, e) + mark + v.slice(e), s: s + n, e: e + n, d: 2 * n };
  }

  E.wrap = function (a, mark) {
    var v = a.v, s = a.s, e = a.e, n = mark.length, r;
    if (s === e) {
      // caret between an empty pair: remove it
      if (v.substr(s - n, n) === mark && v.substr(s, n) === mark) {
        return st(v.slice(0, s - n) + v.slice(s + n), s - n);
      }
      // otherwise use the word under the caret
      var a0 = s, b0 = e;
      while (a0 > 0 && !DELIM.test(v.charAt(a0 - 1))) a0--;
      while (b0 < v.length && !DELIM.test(v.charAt(b0))) b0++;
      if (a0 === b0) return st(v.slice(0, s) + mark + mark + v.slice(s), s + n);
      r = wrapSpan(v, a0, b0, mark);
      return st(r.v, s + (r.d > 0 ? n : -n));
    }
    // trim spaces from the ends of the selection (a mark next to a space is not valid Markdown)
    while (s < e && /\s/.test(v.charAt(s))) s++;
    while (e > s && /\s/.test(v.charAt(e - 1))) e--;
    if (s === e) return a;
    var seg = v.slice(s, e);
    if (seg.indexOf('\n') < 0) {
      r = wrapSpan(v, s, e, mark);
      return st(r.v, r.s, r.e);
    }
    // several lines: each non-empty line on its own (a mark cannot span a paragraph break)
    var spans = [], pos = s, i;
    while (pos <= e) {
      var le = lineEnd(v, pos);
      if (le > e) le = e;
      var ss = pos, ee = le;
      while (ss < ee && /\s/.test(v.charAt(ss))) ss++;
      while (ee > ss && /\s/.test(v.charAt(ee - 1))) ee--;
      if (ss < ee) spans.push(inside(v, ss, ee, mark.charAt(0)));
      pos = le + 1;
    }
    var all = true;
    for (i = 0; i < spans.length; i++) if (!marked(v, spans[i][0], spans[i][1], mark)) all = false;
    var out = v, total = 0;
    for (i = spans.length - 1; i >= 0; i--) {
      var on = marked(out, spans[i][0], spans[i][1], mark);
      if (on === all) {
        r = wrapSpan(out, spans[i][0], spans[i][1], mark);
        out = r.v;
        total += r.d;
      }
    }
    // the whole edited block stays selected, so the same button toggles it back
    return st(out, s, Math.max(s, e + total));
  };

  /* ------------------------------------------------------------- line prefixes */
  // the lines the selection touches; a selection that ends right after a line break
  // does not include the next line
  function lineRange(a) {
    var eEff = (a.e > a.s && a.v.charAt(a.e - 1) === '\n') ? a.e - 1 : a.e;
    var from = lineStart(a.v, a.s), to = lineEnd(a.v, eEff);
    return { from: from, to: to, lines: a.v.slice(from, to).split('\n') };
  }

  function replaceLines(a, rg, lines) {
    var text = lines.join('\n');
    var v = a.v.slice(0, rg.from) + text + a.v.slice(rg.to);
    if (a.s === a.e) return st(v, rg.from + text.length);
    return st(v, rg.from, rg.from + text.length);
  }

  var RE_HEAD = /^#{1,6}[ \t]+/;
  var RE_TASK = /^([ \t]*)[-*+][ \t]+\[[ xX]\][ \t]+/;
  var RE_UL = /^([ \t]*)[-*+][ \t]+/;
  var RE_OL = /^([ \t]*)\d+[.)][ \t]+/;
  var RE_QUOTE = /^>[ \t]?/;

  function blank(l) { return /^\s*$/.test(l); }

  function stripList(l) {
    var m = RE_TASK.exec(l) || RE_UL.exec(l) || RE_OL.exec(l);
    return m ? m[1] + l.slice(m[0].length) : l;
  }

  E.heading = function (a, level) {
    var rg = lineRange(a), lines = rg.lines, i, same = true, any = false;
    var mark = '';
    for (i = 0; i < level; i++) mark += '#';
    for (i = 0; i < lines.length; i++) {
      if (blank(lines[i])) continue;
      any = true;
      var m = RE_HEAD.exec(lines[i]);
      if (!m || m[0].replace(/\s+$/, '') !== mark) same = false;
    }
    if (!any) return a;
    var out = [];
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (blank(l)) { out.push(l); continue; }
      l = l.replace(RE_HEAD, '');
      out.push(same ? l : mark + ' ' + l);
    }
    return replaceLines(a, rg, out);
  };

  E.list = function (a, kind) { // 'ul' | 'ol' | 'task' | 'quote'
    var rg = lineRange(a), lines = rg.lines, i, all = true, any = false;
    function has(l) {
      if (kind === 'ul') return RE_UL.test(l) && !RE_TASK.test(l);
      if (kind === 'task') return RE_TASK.test(l);
      if (kind === 'ol') return RE_OL.test(l);
      return RE_QUOTE.test(l);
    }
    for (i = 0; i < lines.length; i++) {
      if (blank(lines[i])) continue;
      any = true;
      if (!has(lines[i])) all = false;
    }
    if (!any) return a;
    var out = [], n = 0;
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (blank(l)) { out.push(l); continue; }
      if (kind === 'quote') {
        out.push(all ? l.replace(RE_QUOTE, '') : '> ' + l);
        continue;
      }
      l = stripList(l);
      if (all) { out.push(l); continue; }
      var indent = /^[ \t]*/.exec(l)[0];
      var body = l.slice(indent.length);
      n++;
      out.push(indent + (kind === 'ol' ? n + '. ' : kind === 'task' ? '- [ ] ' : '- ') + body);
    }
    return replaceLines(a, rg, out);
  };

  E.indent = function (a, dir) { // +1 / -1: two spaces per level
    var rg = lineRange(a), out = [], i;
    for (i = 0; i < rg.lines.length; i++) {
      var l = rg.lines[i];
      if (dir > 0) out.push(blank(l) ? l : '  ' + l);
      else out.push(l.replace(/^(\t| {1,2})/, ''));
    }
    return replaceLines(a, rg, out);
  };

  E.rule = function (a) { // a horizontal rule on its own, with a blank line around it
    var v = a.v, at = a.e;
    var before = v.slice(0, at), after = v.slice(at);
    var pre = before === '' ? '' : (/\n\n$/.test(before) ? '' : (/\n$/.test(before) ? '\n' : '\n\n'));
    var post = after === '' ? '\n' : (/^\n\n/.test(after) ? '' : (/^\n/.test(after) ? '\n' : '\n\n'));
    var ins = pre + '---' + post;
    return st(before + ins + after, at + ins.length);
  };

  /* ------------------------------------------------------------------- tidy up */
  function tidy(v) {
    return v.replace(/\r\n?/g, '\n')
      .replace(/[​﻿]/g, '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }
  E.tidy = function (a) {
    var v = tidy(a.v);
    var s = Math.min(tidy(a.v.slice(0, a.s)).length, v.length);
    var e = Math.min(tidy(a.v.slice(0, a.e)).length, v.length);
    return st(v, s, e);
  };

  /* ------------------------------------------------------------ find / replace */
  function re(q, matchCase) {
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  }

  E.count = function (v, q, matchCase) {
    if (!q) return 0;
    var r = re(q, matchCase), n = 0;
    while (r.exec(v)) n++;
    return n;
  };

  /* next (or previous) match from `from`, wrapping around; {index, length} or null */
  E.find = function (v, q, from, matchCase, backwards) {
    if (!q) return null;
    var r = re(q, matchCase), m, first = null, last = null, prev = null;
    while ((m = r.exec(v))) {
      if (!first) first = m;
      last = m;
      if (backwards) { if (m.index < from) prev = m; }
      else if (m.index >= from) return { index: m.index, length: m[0].length };
    }
    var pick = backwards ? (prev || last) : first;
    return pick ? { index: pick.index, length: pick[0].length } : null;
  };

  /* the selection itself is a match: replace it. Otherwise null (the caller finds first). */
  E.replaceOne = function (a, q, r, matchCase) {
    if (!q || a.s === a.e) return null;
    var seg = a.v.slice(a.s, a.e);
    var x = re(q, matchCase).exec(seg);
    if (!x || x.index !== 0 || x[0].length !== seg.length) return null;
    return st(a.v.slice(0, a.s) + r + a.v.slice(a.e), a.s + r.length);
  };

  E.replaceAll = function (a, q, r, matchCase) {
    if (!q) return { st: a, n: 0 };
    var n = 0;
    var v = a.v.replace(re(q, matchCase), function () { n++; return r; });
    return { st: n ? st(v, Math.min(a.s, v.length)) : a, n: n };
  };

  /* ------------------------------------------------------------------- history */
  /* Snapshots of the whole text with the selection. Typing is merged into one step until
     a pause (0.8 s) or a space, so undo goes back about a word at a time; every tool button
     is a step of its own. A cap on steps and on total size keeps memory small. */
  function History(maxSteps, maxChars) {
    this.maxSteps = maxSteps || 300;
    this.maxChars = maxChars || 4000000;
    this.items = [];
    this.i = -1;
    this.t = 0;
    this.typing = false;
    this.chars = 0;
  }
  History.prototype.reset = function (a) {
    this.items = [st(a.v, a.s, a.e)];
    this.i = 0;
    this.t = 0;
    this.typing = false;
    this.chars = a.v.length;
  };
  History.prototype.cur = function () { return this.items[this.i]; };
  History.prototype.record = function (a, now, typing) {
    if (!this.items.length) { this.reset(a); return; }
    var cur = this.items[this.i];
    if (a.v === cur.v) { cur.s = a.s; cur.e = a.e; return; }
    var snap = st(a.v, a.s, a.e);
    var word = typing && a.v.length > cur.v.length && /\s/.test(a.v.charAt(a.s - 1));
    if (typing && this.typing && !word && this.i === this.items.length - 1 && now - this.t < 800 && this.i > 0) {
      this.chars += snap.v.length - cur.v.length;
      this.items[this.i] = snap;
    } else {
      var dropped = this.items.splice(this.i + 1, this.items.length);
      for (var k = 0; k < dropped.length; k++) this.chars -= dropped[k].v.length;
      this.items.push(snap);
      this.i = this.items.length - 1;
      this.chars += snap.v.length;
      while (this.items.length > 2 && (this.items.length > this.maxSteps || this.chars > this.maxChars)) {
        this.chars -= this.items[0].v.length;
        this.items.shift();
        this.i--;
      }
    }
    this.typing = !!typing;
    this.t = now;
  };
  History.prototype.canUndo = function () { return this.i > 0; };
  History.prototype.canRedo = function () { return this.i < this.items.length - 1; };
  History.prototype.undo = function () {
    if (!this.canUndo()) return null;
    this.i--;
    this.typing = false;
    var x = this.items[this.i];
    return st(x.v, x.s, x.e);
  };
  History.prototype.redo = function () {
    if (!this.canRedo()) return null;
    this.i++;
    this.typing = false;
    var x = this.items[this.i];
    return st(x.v, x.s, x.e);
  };
  E.History = History;

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.CueEditor = E;
})(typeof window !== 'undefined' ? window : this);
