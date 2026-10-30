(function () {
  'use strict';
  Shell.register('settings', function (ctx) {
    var data = ctx.data,
      kit = ctx.kit,
      shell = ctx.shell;
    var QUALITIES = [
      { value: 'best', label: 'Best available' },
      { value: 1080, label: '1080p' },
      { value: 720, label: '720p' },
      { value: 480, label: '480p' }
    ];
    var SIZES = [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' }
    ];
    // type: toggle (OK flips), choice (Left/Right or OK cycles), action (OK runs it).
    var sections = [
      { title: 'Playback', items: [
        { key: 'quality', type: 'choice', options: QUALITIES, title: 'Video quality',
          help: 'Best available picks the sharpest stream a title has, usually 1080p. Lower it if playback stutters on your network. You can also change it while watching, from the player’s Quality button.' },
        { key: 'autoplayNext', type: 'toggle', title: 'Autoplay next episode',
          help: 'When an episode ends, the next one starts after a 10 second countdown. Press Back on the Up Next card to stay.' },
        { key: 'sleep', type: 'choice', title: 'Sleep timer', options: [0, 15, 30, 60, 90, 120].map(function (m) {
          return { value: m, label: m ? m + ' min' : 'Off' };
        }), help: 'Turns the TV off after the time you pick, even mid-film. The Home launcher keeps the timer, so it runs in any app. The first time, the TV may ask you to Allow “Home launcher”.' }
      ] },
      { title: 'Sources', items: [
        { key: 'askSource', type: 'toggle', title: 'Ask how to stream',
          help: 'Before a film or episode starts, choose Torrent (downloads on this TV) or Web stream (from your stream server). The other way is still tried if the one you pick has nothing that plays.' },
        { key: 'sourceOrder', type: 'choice', title: 'Source order', options: [
          { value: 'addons-first', label: 'Add-ons first' },
          { value: 'provider-first', label: 'Stream server first' }
        ], help: 'Which sources to try first when Ask how to stream is off. If a stream fails, the next source is tried automatically.' },
        { key: 'torrent', type: 'action', title: 'Torrent server',
          help: 'Torrents play on this TV unless a server override is configured. Press OK to test its connection again.' }
      ] },
      { title: 'Subtitles', items: [
        { key: 'subtitles', type: 'toggle', title: 'Show subtitles',
          help: 'Turns subtitles on automatically for titles that include them. You can switch tracks while watching.' },
        { key: 'subtitleSize', type: 'choice', options: SIZES, title: 'Subtitle size', preview: true,
          help: 'How large captions appear on screen.' }
      ] },
      { title: 'Display', items: [
        { key: 'noMotion', type: 'toggle', title: 'Remove animations',
          help: 'Turns off fades, slides and zooms; focus and screens change instantly. Can feel snappier on a slow TV. Loading indicators still move.' },
        { key: 'navClicks', type: 'toggle', title: 'Navigation clicks',
          help: 'A soft click as focus moves, a duller one at the end of a row, and a tap when you select, as on Apple TV.' }
      ] },
      { title: 'Library', items: [
        { key: 'history', type: 'action', title: 'Clear watch history', confirm: 'Your Continue Watching row and resume points will be cleared.',
          help: 'Removes everything from Continue Watching and forgets where you stopped in each title.' },
        { key: 'mylist', type: 'action', title: 'Clear My List', confirm: 'All titles will be removed from My List.',
          help: 'Removes every title you added with the + button.' },
        { key: 'searches', type: 'action', title: 'Clear recent searches',
          help: 'Forgets the searches shown on the Search screen.' },
        { key: 'cache', type: 'action', title: 'Refresh catalog and artwork',
          help: 'Home rows and title logos are kept on the TV for faster start-up. Refresh them if something looks out of date; they reload on your next visit to Home.' }
      ] },
      { title: 'Connection', items: [
        { key: 'server', type: 'action', title: 'Stream server',
          help: 'Web streams come from the stream server set in js/secrets.js. If titles won’t play, press OK to test it again.' },
        { key: 'sports', type: 'action', title: 'Sports streams',
          help: 'Sports schedules and streams come from the sports relay set in js/secrets.js. If they stop playing, this row says why. Press OK to test with a live channel now; it can take up to a minute.' },
        { key: 'health', type: 'action', title: 'App health',
          help: 'Unexpected errors are recorded here so problems can be traced. Press OK to clear the list.' }
      ] }
    ];

    var el = kit.el('main', 'settings-screen'),
      main = kit.el('div', 'settings-main'),
      side = kit.el('aside', 'settings-side');
    var header = kit.el('div', 'settings-header');
    header.appendChild(kit.el('h1', 'screen-title', 'Settings'));
    var viewport = kit.el('div', 'settings-viewport'),
      track = kit.el('div', 'settings-track');
    track.appendChild(header);
    viewport.appendChild(track);
    main.appendChild(viewport);

    var rows = [];
    sections.forEach(function (section) {
      track.appendChild(kit.el('div', 'settings-section', section.title));
      section.items.forEach(function (def) {
        var row = kit.el('div', 'setting-row setting-' + def.type);
        var text = kit.el('div', 'setting-text');
        text.appendChild(kit.el('div', 'setting-label', def.title));
        var detail = kit.el('div', 'setting-detail');
        text.appendChild(detail);
        row.appendChild(text);
        var value = kit.el('div', 'setting-value');
        if (def.type === 'toggle') value.appendChild(kit.el('span', 'setting-switch'));
        var valueText = kit.el('span', 'setting-value-text');
        value.appendChild(valueText);
        row.appendChild(value);
        track.appendChild(row);
        rows.push({ def: def, el: row, detail: detail, value: value, valueText: valueText });
      });
    });

    var sideTitle = kit.el('h2', 'settings-side-title'),
      sideHelp = kit.el('p', 'settings-side-help'),
      preview = kit.el('div', 'settings-preview'),
      previewCaption = kit.el('div', 'settings-preview-caption', 'Walter, you can’t\ndo this to me.');
    preview.appendChild(previewCaption);
    side.appendChild(sideTitle);
    side.appendChild(sideHelp);
    side.appendChild(preview);
    var about = kit.el('div', 'settings-about');
    about.appendChild(kit.el('div', 'settings-about-title', 'Couch TV'));
    about.appendChild(kit.el('div', 'about-version', 'Version 0.4.0'));
    // TMDB's terms require this notice wherever its data or images are used.
    about.appendChild(kit.el('p', '', 'Titles and artwork from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.'));
    side.appendChild(about);
    el.appendChild(main);
    el.appendChild(side);

    var index = 0,
      scrollY = 0,
      focused = false,
      servers = { server: { state: 'unknown', text: '' }, torrent: { state: 'unknown', text: '' } },
      serverChecks = { server: 0, torrent: 0 },
      sports = { state: 'unknown', value: 'Checking…', text: '' },
      sportsCheck = 0,
      sleep = { minutes: 0, endsAt: 0, down: false };

    function optionIndex(def, value) {
      for (var i = 0; i < def.options.length; i++) if (def.options[i].value === value) return i;
      return 0;
    }
    function plural(n, one, many) {
      return n + ' ' + (n === 1 ? one : many);
    }
    function updateValues() {
      var settings = data.settings();
      rows.forEach(function (row) {
        var def = row.def, value = '', detail = '';
        if (def.key === 'sleep') {
          value = sleep.down ? 'Unavailable' : sleep.endsAt ? 'Off in ' + Math.max(1, Math.round((sleep.endsAt - Date.now()) / 60000)) + ' min' : 'Off';
        } else if (def.type === 'toggle') {
          value = settings[def.key] ? 'On' : 'Off';
          row.el.classList.toggle('is-on', !!settings[def.key]);
        } else if (def.type === 'choice') {
          value = def.options[optionIndex(def, settings[def.key])].label;
        } else if (def.key === 'history') {
          detail = plural(data.continueWatching().length, 'title', 'titles') + ' in Continue Watching';
        } else if (def.key === 'mylist') {
          detail = plural(data.myList().length, 'title', 'titles');
        } else if (def.key === 'searches') {
          detail = plural(data.recentSearches().length, 'search', 'searches');
        } else if (def.key === 'server' || def.key === 'torrent') {
          var server = servers[def.key];
          detail = server.text;
          value = server.state === 'ok' ? 'Connected' : server.state === 'down' ? 'Not reachable' : 'Checking…';
          row.el.classList.toggle('is-down', server.state === 'down');
          row.el.classList.toggle('is-ok', server.state === 'ok');
        }
        if (def.key === 'sports') {
          value = sports.value;
          detail = sports.text;
          row.el.classList.toggle('is-down', sports.state === 'down');
          row.el.classList.toggle('is-ok', sports.state === 'ok');
        }
        if (def.key === 'health') {
          var errors = data.errors();
          var last = errors[0];
          value = errors.length ? plural(errors.length, 'error', 'errors') : 'No errors';
          detail = last ? last.message + ' · ' + new Date(last.at).toLocaleString() : 'Nothing unexpected has happened';
          row.el.classList.toggle('is-down', errors.length > 0);
          row.el.classList.toggle('is-ok', !errors.length);
        }
        row.el.classList.toggle('setting-link', def.type === 'action' && def.key !== 'server' && def.key !== 'torrent' && def.key !== 'sports' && def.key !== 'health');
        row.valueText.textContent = value;
        row.detail.textContent = detail;
        row.detail.hidden = !detail;
      });
      previewCaption.className = 'settings-preview-caption settings-preview-' + settings.subtitleSize;
    }
    function checkServer(key) {
      var request = ++serverChecks[key];
      servers[key] = { state: 'unknown', text: '' };
      updateValues();
      data.serverStatus(key === 'torrent').then(function (status) {
        if (request !== serverChecks[key]) return;
        servers[key] = status.ok
          ? { state: 'ok', text: status.host + ' · answered in ' + status.ms + ' ms' }
          : { state: 'down', text: status.host + ' · no answer' };
        updateValues();
      });
    }
    function checkSports(test) {
      var request = ++sportsCheck;
      sports = { state: 'unknown', value: test ? 'Testing…' : 'Checking…', text: test ? 'Finding a live stream; this can take up to a minute' : '' };
      updateValues();
      data.sportsHealth(test).then(function (health) {
        if (request !== sportsCheck) return;
        sports = Live.health(health, Date.now());
        updateValues();
      });
    }
    // Keeps the focused row inside the visible area; the header scrolls away with the list.
    function updateScroll() {
      var row = rows[index].el;
      var top = row.offsetTop, bottom = top + row.offsetHeight;
      var height = viewport.clientHeight;
      if (index === 0) scrollY = 0;
      else if (top - scrollY < 140) scrollY = top - 140;
      else if (bottom - scrollY > height - 40) scrollY = bottom - height + 40;
      scrollY = Math.max(0, scrollY);
      track.style.transform = 'translate3d(0,' + -scrollY + 'px,0)';
      if (focused) shell.tuck(scrollY > 0);
    }
    function updateFocus() {
      rows.forEach(function (row, i) {
        row.el.classList.toggle('focused', focused && i === index);
      });
      var def = rows[index].def;
      sideTitle.textContent = def.title;
      sideHelp.textContent = def.help;
      preview.hidden = !def.preview;
      updateScroll();
    }
    function setSleep(minutes) {
      sleep.minutes = minutes;
      data.sleepTimer(minutes).then(function (state) {
        sleep = { minutes: minutes, endsAt: state.endsAt, down: !!state.down };
        updateValues();
      });
    }
    function change(def, step, wrap) {
      if (def.key === 'sleep') {
        var at = optionIndex(def, sleep.minutes) + step;
        if (wrap) at = (at + def.options.length) % def.options.length;
        if (at < 0 || at >= def.options.length) return false;
        setSleep(def.options[at].value);
        return true;
      }
      var settings = data.settings();
      var next = optionIndex(def, settings[def.key]) + step;
      if (wrap) next = (next + def.options.length) % def.options.length;
      if (next < 0 || next >= def.options.length) return false;
      data.setSetting(def.key, def.options[next].value);
      updateValues();
      return true;
    }
    function run(def) {
      if (def.key === 'server' || def.key === 'torrent') { checkServer(def.key); return; }
      if (def.key === 'sports') { checkSports(true); return; }
      if (def.key === 'health') {
        data.clearErrors();
        shell.toast('Error list cleared');
        updateValues();
        return;
      }
      if (def.key === 'searches') {
        data.clearRecentSearches();
        shell.toast('Recent searches cleared');
      } else if (def.key === 'cache') {
        data.clearCache();
        shell.toast('Catalog and artwork will refresh');
      } else {
        shell.confirm({ title: def.title + '?', body: def.confirm, confirm: 'Clear', cancel: 'Keep' }).then(function (yes) {
          if (!yes) return;
          if (def.key === 'history') data.clearHistory();
          else data.clearMyList();
          shell.toast(def.key === 'history' ? 'Watch history cleared' : 'My List cleared');
          updateValues();
        });
      }
      updateValues();
    }
    function handleKey(code) {
      if (code === 10009) return false;
      var def = rows[index].def;
      if (code === 38 && index === 0) return false; // the tab bar
      if (code === 38 || code === 40) {
        index = Math.max(0, Math.min(rows.length - 1, index + (code === 40 ? 1 : -1)));
        updateFocus();
        return true;
      }
      if (def.type === 'choice' && (code === 37 || code === 39)) {
        return change(def, code === 39 ? 1 : -1, false) || code === 39;
      }
      if (code === 37) return false;
      if (code === 13) {
        if (def.type === 'toggle') {
          data.setSetting(def.key, !data.settings()[def.key]);
          updateValues();
        } else if (def.type === 'choice') change(def, 1, true);
        else run(def);
        return true;
      }
      return code === 39;
    }
    return {
      el: el,
      show: function () {
        updateValues();
        checkServer('server');
        checkServer('torrent');
        checkSports(false);
        data.sleepTimer().then(function (state) {
          sleep.endsAt = state.endsAt;
          sleep.down = !!state.down;
          if (!state.endsAt) sleep.minutes = 0;
          updateValues();
        });
      },
      hide: function () {
        focused = false;
        updateFocus();
        el.hidden = true;
      },
      focus: function () {
        focused = true;
        updateFocus();
      },
      hideFocus: function () {
        focused = false;
        updateFocus();
      },
      refresh: updateValues,
      handleKey: handleKey
    };
  });
})();
