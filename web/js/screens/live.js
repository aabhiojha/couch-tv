(function () {
  'use strict';
  Shell.register('live', function (ctx) {
    var data = ctx.data, kit = ctx.kit, shell = ctx.shell, PAGE = 80;
    var el = kit.el('main', 'browse-screen live-screen sports-screen');
    var track = kit.el('div', 'browse-track');
    var header = kit.el('div', 'browse-header');
    header.appendChild(kit.el('h1', 'screen-title', 'Sports'));
    var message = kit.el('p', 'sports-message', 'Loading match schedules and channels…');
    message.setAttribute('role', 'status');
    header.appendChild(message);
    track.appendChild(header);
    var viewWrap = kit.el('div', 'browse-tabs-wrap');
    var sportWrap = kit.el('div', 'browse-tabs-wrap');
    [viewWrap, sportWrap].forEach(function (node) { track.appendChild(node); });
    // OK asks which watch option to use; the Play key starts the preferred one straight away.
    var grid = kit.Grid({ columns: 4, onSelect: function (item) { play(item, false); },
      onPlay: function (item) { play(item, true); }, onNeedMore: more, onFocus: describe });
    track.appendChild(grid.el);
    var hint = kit.el('div', 'sports-hint');
    hint.setAttribute('aria-live', 'polite');
    el.appendChild(track);
    el.appendChild(hint);
    // row: the focused row, 'view', 'sport' or 'grid'. The sport row hides when a view has one sport.
    var snapshot = null, shown = [], count = 0, row = 'view', focused = false, visible = false;
    var busy = false, timer = null, loadedAt = 0, views, sports;
    // Every commentary is listed; English, Hindi and Nepali feeds come first, so the Play key starts one of those.
    var ANY = 'all';
    var viewItems = [{ key: 'now', title: 'On now' }, { key: 'today', title: 'Today' },
      { key: 'upcoming', title: 'Upcoming' }, { key: 'channels', title: 'Channels' }];

    function makeTabs(wrap, label, items, index, onChange) {
      wrap.textContent = '';
      if (label) wrap.appendChild(kit.el('div', 'tabs-label', label));
      var tabs = kit.Tabs({ items: items, index: index, onChange: onChange });
      wrap.appendChild(tabs.el);
      return tabs;
    }
    function changeView() { buildSports(); filter(false); }
    views = makeTabs(viewWrap, '', viewItems, 0, changeView);

    function buildSports() {
      var selected = sports ? sports.value : 'all';
      var names = snapshot ? Live.sportsIn(snapshot.items, views.value, ANY, Date.now()) : [];
      var choices = [{ key: 'all', title: 'Cricket & football' }].concat(names.map(function (name) { return { key: name, title: name }; }));
      var index = Math.max(0, choices.map(function (choice) { return choice.key; }).indexOf(selected));
      sports = makeTabs(sportWrap, 'Sport', choices, index, function () { filter(false); });
      sportWrap.hidden = names.length < 2;
      if (sportWrap.hidden && row === 'sport') row = 'view';
    }
    buildSports();
    function rows() { return sportWrap.hidden ? ['view', 'grid'] : ['view', 'sport', 'grid']; }
    function tabs(name) { return { view: views, sport: sports }[name]; }
    function describe(item) {
      if (!item) { hint.textContent = ''; return; }
      var languages = [];
      item.streams.forEach(function (stream) {
        var name = Live.languageName(stream.language);
        if (languages.indexOf(name) < 0) languages.push(name);
      });
      var parts = [item.streams.length + (item.streams.length === 1 ? ' watch option' : ' watch options'), languages.join(', ')];
      if (item.score && item.score.summary) parts.unshift(item.score.summary);
      if (Live.timing(item, Date.now())) parts.push(Live.timing(item, Date.now()));
      hint.textContent = parts.join(' · ');
    }
    // OK: the watch options plus saving to My Sports (the Home launcher's row); a match more than 15 minutes
    // away offers only the reminder. Play starts the first, preferred option.
    function play(item, direct) {
      var now = Date.now(), far = item.kind === 'event' && item.startsAt - now > 15 * 60000;
      if (Live.state(item, now) === 'Ended') { shell.toast('This event’s scheduled window has ended.'); return; }
      if (direct && far) {
        shell.toast(Live.timing(item, now) + ' (' + Live.startLabel(item, now) + '). Press OK to get a reminder.');
        return;
      }
      if (direct) { data.playLive(item, { direct: true }); return; }
      var saved = data.isSportsBookmark(item.id);
      var options = far ? [] : item.streams.map(function (s, i) {
        return (i + 1) + '. ' + (s.label || 'Stream') + ' · ' + Live.languageName(s.language);
      });
      shell.choose({ title: item.title, body: far ? Live.timing(item, now) + ' · ' + Live.startLabel(item, now) : 'Choose a stream',
        choices: options.concat(saved ? (far ? 'Cancel reminder' : 'Remove from My Sports') :
          far ? 'Remind me on the Home screen' : 'Add to My Sports') }).then(function (index) {
        if (index === false) return;
        if (index < options.length) { data.playLive(item, { index: index }); return; }
        var on = data.toggleSportsBookmark(item);
        shell.toast(!on ? (far ? 'Reminder cancelled' : 'Removed from My Sports') :
          far ? 'Saved. The Home screen will remind you when it’s about to start.' : 'Added to My Sports on the Home screen');
        filter(true);
      });
    }
    function more() {
      if (count >= shown.length) return;
      var next = Math.min(shown.length, count + PAGE);
      var items = shown.slice(count, next);
      count = next;
      grid.appendItems(items);
    }
    function emptyText() {
      if (views.value === 'channels') return 'No channels for this sport.';
      var now = Date.now();
      var next = views.value === 'upcoming' ? null :
        Live.select(snapshot ? snapshot.items : [], 'upcoming', sports.value, ANY, now)[0];
      if (next) return (views.value === 'now' ? 'Nothing is scheduled right now.' : 'Nothing else today.') +
        ' Next up: ' + next.title + ', ' + Live.startLabel(next, now) + ' (' + Live.timing(next, now).toLowerCase() + ').';
      return 'No matches for this sport. Try another view or sport.';
    }
    function filter(preserve) {
      var previous = preserve && shown[grid.index], position = grid.index;
      // Saved channels and matches carry a star; in Channels they come first.
      shown = Live.select(snapshot ? snapshot.items : [], views.value, sports.value, ANY, Date.now()).map(function (item) {
        // ESPN's score (via the TV service) replaces the start time; "LIVE" only when ESPN says the game is on.
        if (item.score) item = Object.assign({}, item, { meta: item.score.line, live: item.score.state === 'in',
          badge: item.score.state === 'in' ? 'LIVE' : item.badge, crests: item.thumb ? null : item.score.crests });
        return data.isSportsBookmark(item.id) ? Object.assign({}, item, { saved: true, badge: '★' + (item.badge ? ' ' + item.badge : '') }) : item;
      });
      if (views.value === 'channels') shown = shown.filter(function (i) { return i.saved; }).concat(shown.filter(function (i) { return !i.saved; }));
      el.classList.toggle('sports-channels', views.value === 'channels');
      if (previous) {
        var found = shown.map(function (item) { return item.id; }).indexOf(previous.id);
        position = found < 0 ? Math.min(position, Math.max(0, shown.length - 1)) : found;
      } else position = 0;
      count = Math.min(shown.length, Math.max(PAGE, position + 1));
      grid.setItems(shown.slice(0, count));
      if (!shown.length) grid.setEmpty(emptyText());
      if (focused && row === 'grid') grid.focus(position);
      describe(shown[position]);
      updateFocus();
    }
    function status(result) {
      var names = result.providers.filter(function (provider) { return provider.status !== 'unavailable'; })
        .map(function (provider) { return provider.name; });
      var text = result.message || ('Match listings from ' + (names.join(' + ') || 'your sources') +
        ' · ' + new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }));
      if (result.stale && result.updatedAt > 0)
        text += ' Updated ' + new Date(result.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
      return text;
    }
    function load() {
      if (busy) return;
      busy = true;
      if (!snapshot) grid.setLoading(true);
      data.sports().then(function (result) {
        var first = !snapshot, now = Date.now();
        snapshot = result;
        data.updateSportsBookmarks(result.items);
        busy = false;
        loadedAt = now;
        grid.setLoading(false);
        // Open on the first view with something in it: On now, else Today, else Upcoming, else Channels.
        if (first && views.value === 'now' && !Live.select(result.items, 'now', 'all', ANY, now).length) {
          var start = Live.select(result.items, 'today', 'all', ANY, now).length ? 1 :
            Live.select(result.items, 'upcoming', 'all', ANY, now).length ? 2 : 3;
          views = makeTabs(viewWrap, '', viewItems, start, changeView);
        }
        buildSports();
        message.textContent = status(result);
        filter(!first);
      }, function () {
        busy = false;
        message.textContent = 'Couldn’t load sports. Check your connection and press OK to retry.';
        if (!snapshot) { grid.setError(load); row = 'grid'; }
        updateFocus();
      });
    }
    function updateFocus() {
      var shift = row === 'grid' ? Math.max(0, grid.el.offsetTop - 90) : 0;
      track.style.transform = 'translate3d(0,' + -shift + 'px,0)';
      if (focused) shell.tuck(shift > 0);
      ['view', 'sport'].forEach(function (name) {
        if (focused && row === name) tabs(name).focus(); else tabs(name).blur();
      });
      if (focused && row === 'grid') grid.focus(); else grid.blur();
    }
    function move(step) {
      var list = rows(), next = list[list.indexOf(row) + step];
      if (!next) return false;
      row = next;
      updateFocus();
      return true;
    }
    function handleKey(code) {
      if (code === 10009) return false;
      if (row === 'grid') {
        if (code === 38) {
          if (!grid.handleKey(code)) move(-1);
          return true;
        }
        return grid.handleKey(code);
      }
      if (code === 38 || code === 40) return move(code === 38 ? -1 : 1);
      return tabs(row).handleKey(code);
    }
    return {
      el: el,
      show: function () {
        visible = true;
        if (!snapshot || Date.now() - loadedAt >= 60000) load();
        clearInterval(timer);
        timer = setInterval(function () { if (visible) load(); }, 60000);
        updateFocus();
      },
      hide: function () { visible = false; focused = false; clearInterval(timer); updateFocus(); },
      focus: function () { focused = true; updateFocus(); },
      hideFocus: function () { focused = false; updateFocus(); },
      handleKey: handleKey
    };
  });
})();
