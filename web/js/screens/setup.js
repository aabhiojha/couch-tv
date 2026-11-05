// First run without a TMDB key (an installer left it empty, or none was set): explain where to get one and type it
// with the remote. A v3 key is 32 hex characters, so the keypad has only 0-9 and a-f; the key is checked with TMDB
// before it is saved. Settings › TMDB key opens this screen again.
(function () {
  'use strict';
  Shell.register('setup', function (ctx) {
    var kit = ctx.kit, data = ctx.data, shell = ctx.shell;
    var KEYS = ['0123456789'.split(''), 'abcdef'.split('').concat(['Delete']), ['Clear', 'Done']];
    var el = kit.el('main', 'setup-screen');
    var copy = kit.el('div', 'setup-copy');
    copy.appendChild(kit.el('h1', 'setup-title', 'Welcome to Couch TV'));
    copy.appendChild(kit.el('p', 'setup-body', 'Films, series and artwork come from TMDB. Get a free API key at themoviedb.org › Settings › API, then type it here with the remote. It is 32 letters and digits.'));
    var field = kit.el('div', 'setup-field');
    var value = kit.el('span', 'setup-value');
    var caret = kit.el('span', 'setup-caret');
    field.appendChild(value);
    field.appendChild(caret);
    copy.appendChild(field);
    var count = kit.el('div', 'setup-count');
    copy.appendChild(count);
    var board = kit.el('div', 'setup-keys');
    var nodes = KEYS.map(function (row) {
      var r = kit.el('div', 'setup-key-row');
      board.appendChild(r);
      return row.map(function (k) {
        var n = kit.el('div', 'setup-key' + (k.length > 1 ? ' setup-key-wide' : ''), k);
        r.appendChild(n);
        return n;
      });
    });
    copy.appendChild(board);
    var message = kit.el('p', 'setup-message');
    message.setAttribute('role', 'status');
    copy.appendChild(message);
    el.appendChild(copy);

    var text = '', rowAt = 0, colAt = 0, focused = false, checking = false;
    function paint() {
      value.textContent = text.replace(/(.{4})/g, '$1 ').trim();
      count.textContent = text.length + ' of 32';
      nodes.forEach(function (row, r) {
        row.forEach(function (n, c) { n.classList.toggle('focused', focused && r === rowAt && c === colAt); });
      });
    }
    function press(k) {
      message.textContent = '';
      if (k === 'Delete') text = text.slice(0, -1);
      else if (k === 'Clear') text = '';
      else if (k === 'Done') { check(); return; }
      else if (text.length < 32) {
        text += k;
        // The last character moves to Done, so OK finishes.
        if (text.length === 32) { rowAt = 2; colAt = 1; }
      }
      paint();
    }
    function check() {
      if (checking) return;
      if (text.length !== 32) { message.textContent = 'A TMDB API key has 32 characters; this one has ' + text.length + '.'; return; }
      checking = true;
      message.textContent = 'Checking the key with TMDB…';
      fetch('https://api.themoviedb.org/3/configuration?api_key=' + text).then(function (r) {
        checking = false;
        if (r.status === 401) { message.textContent = 'TMDB didn’t accept this key. Check it on themoviedb.org and try again.'; return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        data.setTmdbKey(text);
        shell.toast('Key saved. Welcome to Couch TV.');
        shell.go('home');
      }).catch(function () {
        checking = false;
        message.textContent = 'Couldn’t reach TMDB. Check the TV’s internet connection, then choose Done again.';
      });
    }
    function handleKey(code) {
      if (code === 10009) return false;
      if (code >= 48 && code <= 57) { press(String(code - 48)); return true; } // the remote's digit keys
      if (code === 38 || code === 40) {
        var r = rowAt + (code === 40 ? 1 : -1);
        if (r < 0 || r >= nodes.length) return true;
        colAt = Math.min(nodes[r].length - 1, Math.round(colAt * (nodes[r].length - 1) / Math.max(1, nodes[rowAt].length - 1)));
        rowAt = r;
      } else if (code === 37 || code === 39) {
        colAt = Math.max(0, Math.min(nodes[rowAt].length - 1, colAt + (code === 39 ? 1 : -1)));
      } else if (code === 13) {
        press(KEYS[rowAt][colAt]);
        return true;
      }
      paint();
      return true;
    }
    return {
      el: el,
      show: function () { text = data.tmdbKey() || ''; rowAt = 0; colAt = 0; message.textContent = ''; paint(); },
      hide: function () { focused = false; paint(); },
      focus: function () { focused = true; paint(); },
      hideFocus: function () { focused = false; paint(); },
      handleKey: handleKey
    };
  });
})();
