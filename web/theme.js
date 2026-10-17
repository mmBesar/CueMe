/* Catppuccin themes (4 flavours x 14 accents). Plain ES5 and a generated <style> element:
   no CSS variables, so it also works in old Android WebViews. Per-device, stored locally. */
(function (root) {
  'use strict';
  var P = {
    latte: { name: 'Latte', dark: false,
      rosewater: 'dc8a78', flamingo: 'dd7878', pink: 'ea76cb', mauve: '8839ef', red: 'd20f39', maroon: 'e64553', peach: 'fe640b',
      yellow: 'df8e1d', green: '40a02b', teal: '179299', sky: '04a5e5', sapphire: '209fb5', blue: '1e66f5', lavender: '7287fd',
      text: '4c4f69', subtext1: '5c5f77', subtext0: '6c6f85', overlay0: '9ca0b0', surface2: 'acb0be', surface1: 'bcc0cc', surface0: 'ccd0da',
      base: 'eff1f5', mantle: 'e6e9ef', crust: 'dce0e8' },
    frappe: { name: 'Frappé', dark: true,
      rosewater: 'f2d5cf', flamingo: 'eebebe', pink: 'f4b8e4', mauve: 'ca9ee6', red: 'e78284', maroon: 'ea999c', peach: 'ef9f76',
      yellow: 'e5c890', green: 'a6d189', teal: '81c8be', sky: '99d1db', sapphire: '85c1dc', blue: '8caaee', lavender: 'babbf1',
      text: 'c6d0f5', subtext1: 'b5bfe2', subtext0: 'a5adce', overlay0: '737994', surface2: '626880', surface1: '51576d', surface0: '414559',
      base: '303446', mantle: '292c3c', crust: '232634' },
    macchiato: { name: 'Macchiato', dark: true,
      rosewater: 'f4dbd6', flamingo: 'f0c6c6', pink: 'f5bde6', mauve: 'c6a0f6', red: 'ed8796', maroon: 'ee99a0', peach: 'f5a97f',
      yellow: 'eed49f', green: 'a6da95', teal: '8bd5ca', sky: '91d7e3', sapphire: '7dc4e4', blue: '8aadf4', lavender: 'b7bdf8',
      text: 'cad3f4', subtext1: 'b8c0e0', subtext0: 'a5adcb', overlay0: '6e738d', surface2: '5b6078', surface1: '494d64', surface0: '363a4f',
      base: '24273a', mantle: '1e2030', crust: '181926' },
    mocha: { name: 'Mocha', dark: true,
      rosewater: 'f5e0dc', flamingo: 'f2cdcd', pink: 'f5c2e7', mauve: 'cba6f7', red: 'f38ba8', maroon: 'eba0ac', peach: 'fab387',
      yellow: 'f9e2af', green: 'a6e3a1', teal: '94e2d5', sky: '89dceb', sapphire: '74c7ec', blue: '89b4fa', lavender: 'b4befe',
      text: 'cdd6f4', subtext1: 'bac2de', subtext0: 'a6adc8', overlay0: '6c7086', surface2: '585b70', surface1: '45475a', surface0: '313244',
      base: '1e1e2e', mantle: '181825', crust: '11111b' }
  };
  var FLAVORS = ['latte', 'frappe', 'macchiato', 'mocha'];
  var ACCENTS = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'sky', 'sapphire', 'blue', 'lavender'];
  var DEFAULT = { f: 'macchiato', a: 'mauve' };

  function css(p, accent) {
    var c = function (k) { return '#' + p[k]; };
    var A = '#' + p[accent];
    var on = c('crust'); // text on accent-coloured buttons
    return [
      'html,body{background:' + c('base') + ';color:' + c('text') + '}',
      'button{background:' + c('surface0') + ';border-color:' + c('surface1') + ';color:' + c('text') + '}',
      'button:hover{background:' + c('surface1') + '}',
      'button:active{background:' + c('surface2') + '}',
      'button.primary{background:' + A + ';border-color:' + A + ';color:' + on + '}',
      'button.primary:hover,button.primary:active{background:' + A + ';opacity:.85}',
      'button.danger{background:' + c('red') + ';border-color:' + c('red') + ';color:' + on + '}',
      'input[type=text],input[type=password],textarea,select{background:' + c('mantle') + ';border-color:' + c('surface1') + ';color:' + c('text') + '}',
      'input[type=color]{background:' + c('mantle') + ';border-color:' + c('surface1') + '}',
      'input[type=range]{accent-color:' + A + '}',
      '.sub,.muted,.ctl .lab,.big span{color:' + c('subtext0') + '}',
      '.ctl .val{color:' + c('text') + '}',
      '.err{color:' + c('red') + '}',
      '#remote{background:' + c('base') + '}',
      '#rtop,#transport{border-color:' + c('surface0') + '}',
      '#panel{background:' + c('mantle') + ';border-color:' + c('surface0') + '}',
      '#panel.full{background:transparent}',
      '.tabs{border-color:' + c('surface0') + '}',
      '.tabs button{background:transparent}',
      '.tabs button.on{border-bottom-color:' + A + ';background:' + c('surface0') + '}',
      '.url{background:' + c('crust') + '}',
      '.preview{background:' + c('crust') + ';color:' + c('text') + '}',
      '.files .file{border-color:' + c('surface0') + '}',
      '.files .file button.name{background:transparent}',
      '.dot{background:' + c('overlay0') + '}.dot.on{background:' + c('green') + '}.dot.err{background:' + c('red') + '}',
      '#toast{background:' + c('mantle') + ';border-color:' + c('surface1') + ';color:' + c('text') + '}',
      '#progressbar{background:' + A + '}',
      '#hint{color:' + c('subtext0') + '}',
      '#count{color:' + c('yellow') + '}',
      '#dctl{background:' + c('mantle') + ';border-color:' + c('surface1') + '}',
      '.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{color:' + A + '}',
      '.md blockquote{border-color:' + A + '}',
      '.scan{background:' + c('crust') + '}.scan video{background:' + c('mantle') + '}',
      '.sw{border-color:' + c('surface2') + '}.sw.on{border-color:' + c('text') + '}',
      '.fl.on{border-color:' + A + ';background:' + c('surface1') + '}'
    ].join('\n');
  }

  var cur = { f: DEFAULT.f, a: DEFAULT.a };

  function valid(t) {
    return t && P[t.f] && P[t.f][t.a] && ACCENTS.indexOf(t.a) >= 0;
  }

  function apply(t) {
    if (!valid(t)) t = DEFAULT;
    cur = { f: t.f, a: t.a };
    var doc = root.document;
    var st = doc.getElementById('cueme-theme');
    if (!st) { st = doc.createElement('style'); st.id = 'cueme-theme'; doc.head.appendChild(st); }
    var text = css(P[t.f], t.a);
    if (st.styleSheet) st.styleSheet.cssText = text; else st.textContent = text;
    var meta = doc.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', '#' + P[t.f].base);
    return cur;
  }

  root.CueTheme = {
    palettes: P, flavors: FLAVORS, accents: ACCENTS, defaults: DEFAULT,
    valid: valid, apply: apply, css: css,
    current: function () { return { f: cur.f, a: cur.a }; },
    hex: function (key) { return '#' + P[cur.f][key]; },
    /* colours for the script itself (display text/background) */
    scriptColors: function () { return { text_color: '#' + P[cur.f].text, bg_color: '#' + P[cur.f].base }; }
  };
}(window));
