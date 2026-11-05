// Sports, laid out like a scores site: Matches (a date strip, competitions, every game of the day from ESPN with
// the TV's streams attached, and the focused game's details beside the list), Tables (league standings) and
// Channels (24/7 feeds). OK opens a game's match page; Play watches it, or sets a reminder for a later one.
(function () {
  'use strict';
  Shell.register('live', function (ctx) {
    var data = ctx.data, kit = ctx.kit, shell = ctx.shell;
    var DAY = 86400000, ROW = 112, GROUP = 72, LIST_TOP = 36, PAGE = 80;
    var el = kit.el('main', 'sports-screen');
    var track = kit.el('div', 'sports-track');
    el.appendChild(track);

    // ---- Top: views, status, date strip, competitions ----
    var top = kit.el('div', 'sports-top');
    var viewWrap = kit.el('div', 'sports-views');
    var status = kit.el('div', 'sports-status');
    status.setAttribute('role', 'status');
    var dateWrap = kit.el('div', 'sports-dates');
    var compWrap = kit.el('div', 'sports-comps');
    [viewWrap, status, dateWrap, compWrap].forEach(function (n) { top.appendChild(n); });
    track.appendChild(top);

    // ---- Matches: the list and the focused game's panel ----
    var body = kit.el('div', 'sports-body');
    var listView = kit.el('div', 'fx-list');
    var listTrack = kit.el('div', 'fx-track');
    listView.appendChild(listTrack);
    var empty = kit.el('div', 'fx-empty');
    listView.appendChild(empty);
    var panel = kit.el('aside', 'fx-panel');
    body.appendChild(listView);
    body.appendChild(panel);
    track.appendChild(body);

    // ---- Tables ----
    var tableView = kit.el('div', 'st-view');
    var tableTrack = kit.el('div', 'st-track');
    var tablePanel = kit.el('aside', 'fx-panel st-panel');
    tableView.appendChild(tableTrack);
    tableView.appendChild(tablePanel);
    track.appendChild(tableView);

    // ---- Channels ----
    var grid = kit.Grid({ columns: 4, onSelect: function (item) { playChannel(item, false); },
      onPlay: function (item) { playChannel(item, true); }, onNeedMore: moreChannels, onFocus: function () {} });
    var channelView = kit.el('div', 'sports-channels');
    channelView.appendChild(grid.el);
    track.appendChild(channelView);

    var views, dates, comps, tableComps;
    var row = 'date', focused = false, visible = false, timer = null;
    var catalog = null, catalogAt = 0, catalogBusy = false;
    var nextUp = null, hinting = false, touched = false, lastFixtures = true, games = [], entries = [], at = 0, scroll = 0, loading = false, failed = '', token = 0;
    var channels = [], channelCount = 0;
    var table = null, tableRows = [], tableAt = 0, tableScroll = 0, tableToken = 0, tableState = '';

    function settings() { return data.settings(); }
    function shown(sport) {
      var s = settings().sportsShown || 'both';
      return s === 'both' || s === sport.toLowerCase();
    }
    function followed() { return (settings().followed || []).map(function (f) { return f.key; }); }
    function saved(g) { return data.isSportsBookmark(g.listing || g.id) || data.isSportsBookmark(g.id); }
    function hideScores() { return !!settings().hideScores; }

    // ---- Views ----
    var VIEWS = [{ key: 'matches', title: 'Matches' }, { key: 'tables', title: 'Tables' }, { key: 'channels', title: 'Channels' }];
    function makeTabs(wrap, items, index, onChange, className) {
      wrap.textContent = '';
      var tabs = kit.Tabs({ items: items, index: index, onChange: onChange });
      if (className) tabs.el.classList.add(className);
      wrap.appendChild(tabs.el);
      return tabs;
    }
    views = makeTabs(viewWrap, VIEWS, 0, function () { paintView(); });

    // ---- Date strip: Live, then three days back to a week ahead ----
    function midnight(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
    var dayList = [];
    function buildDates(selected) {
      var today = midnight(Date.now());
      dayList = [{ key: 'live', title: 'Live' }];
      for (var i = -3; i <= 7; i++) {
        // Local midnights, not +24 h steps: a DST change would drift them an hour.
        var d = new Date(today); d.setDate(d.getDate() + i);
        var title = i === 0 ? 'Today' : i === -1 ? 'Yesterday' : i === 1 ? 'Tomorrow' : Live.format('weekday', d) + ' ' + d.getDate();
        dayList.push({ key: String(d.getTime()), title: title, from: d.getTime() });
      }
      var keys = dayList.map(function (d) { return d.key; });
      var index = keys.indexOf(selected);
      if (index < 0) index = keys.indexOf(String(today));
      dates = makeTabs(dateWrap, dayList, index, function () { loadGames(false); }, 'sports-date-tabs');
    }
    function selectedDay() { return dayList.filter(function (d) { return d.key === dates.value; })[0]; }

    // ---- Competitions row ----
    var compKey = 'all', compList = [];
    function buildComps() {
      var follow = followed();
      compList = Live.competitions(games, follow);
      var items = [{ key: 'all', title: 'All competitions' }].concat(compList.map(function (c) {
        return { key: c.key, title: (follow.indexOf(c.key) >= 0 ? '★ ' : '') + shortName(c.title) + (c.live ? ' · ' + c.live + ' live' : '') };
      }));
      var index = Math.max(0, items.map(function (i) { return i.key; }).indexOf(compKey));
      compKey = items[index].key;
      comps = makeTabs(compWrap, items, index, function (key) { compKey = key; paintList(null); updateFocus(); }, 'sports-comp-tabs');
      compWrap.hidden = compList.length < 2;
      if (compWrap.hidden && row === 'comp') row = 'date';
    }
    function shortName(name) {
      return String(name).replace(/^(?:English|Spanish|Italian|German|French|Dutch|Portuguese|Mexican|Belgian|Scottish|Turkish)\s+/, '')
        .replace(/^Asian Cricket Council\s+/, 'ACC ');
    }
    function toggleFollow() {
      var c = compList.filter(function (x) { return x.key === compKey; })[0];
      if (!c) return;
      var list = (settings().followed || []).filter(function (f) { return f.key !== c.key; });
      var on = list.length === (settings().followed || []).length;
      if (on) list.unshift({ key: c.key, title: c.title, sport: c.sport, league: c.league });
      data.setSetting('followed', list.slice(0, 30));
      shell.toast(on ? 'Following ' + c.title + '. Its games come first.' : 'Stopped following ' + c.title);
      buildComps();
      paintList(null);
      paintTables(true);
      updateFocus();
    }

    // ---- Loading a day ----
    function loadCatalog(force) {
      if (catalogBusy || (!force && catalog && Date.now() - catalogAt < 60000)) return Promise.resolve(catalog);
      catalogBusy = true;
      return data.sports().then(function (result) {
        catalog = result;
        catalogAt = Date.now();
        data.updateSportsBookmarks(result.items);
        return result;
      }, function () { return catalog; }).then(function (result) { catalogBusy = false; return result; });
    }
    function loadGames(quiet) {
      var day = selectedDay(), now = Date.now(), request = ++token;
      if (!day) return;
      var live = day.key === 'live';
      // Live: today's games, and yesterday's for the Test or late game still going.
      var from = live ? midnight(now) - DAY : day.from, to = live ? midnight(now) + DAY : day.from + DAY;
      if (!quiet) {
        loading = true;
        failed = '';
        games = [];
        status.textContent = 'Loading fixtures…';
        paintList(null);
      }
      var keep = quiet && entries[at] ? entries[at].game.id : null;
      Promise.all([Espn.fixtures(from, to, now).catch(function () { return null; }), loadCatalog(false)]).then(function (both) {
        if (request !== token) return;
        var fixtures = both[0], result = both[1];
        var events = (result ? result.items : []).filter(function (i) {
          return i.kind === 'event' && i.startsAt >= from && i.startsAt < to;
        });
        var all = Live.guide(fixtures || [], events, now).filter(function (g) { return shown(g.sport); });
        if (live) {
          nextUp = all.filter(function (g) { return g.state === 'pre' && g.startsAt > now; })[0] || null;
          all = all.filter(function (g) { return g.state === 'in'; });
        }
        loading = false;
        failed = !fixtures && !result ? 'Couldn’t load fixtures. Check your connection, then press OK to try again.' : '';
        games = all;
        lastFixtures = !!fixtures;
        notice(fixtures, result);
        if (live || day.from === midnight(now)) liveCount(all.filter(function (g) { return g.state === 'in'; }).length);
        buildComps();
        paintList(keep);
        // Arriving on Sports, focus starts on the game that matters (live, else next) rather than the strip; a list
        // that empties under the focus (a setting changed) hands it back to the strip.
        if (!quiet && !touched && entries.length && (row === 'date' || row === 'comp')) row = 'list';
        if ((row === 'list' && !entries.length) || (row === 'comp' && compWrap.hidden)) row = 'date';
        updateFocus();
      });
    }
    function liveCount(n) {
      var tab = dateWrap.querySelector('.kit-tab');
      if (tab) tab.textContent = n ? 'Live · ' + n : 'Live';
    }
    function notice(fixtures, result) {
      var day = selectedDay(), count = games.length, liveCount = games.filter(function (g) { return g.state === 'in'; }).length;
      var bits = [];
      if (day.key === 'live') bits.push(liveCount ? liveCount + ' live now' : 'Nothing live right now');
      else bits.push(Live.format('longDay', new Date(day.from)), count + (count === 1 ? ' game' : ' games') + (liveCount ? ' · ' + liveCount + ' live' : ''));
      if (!fixtures && result) bits.push('Fixtures unavailable; showing what has a stream');
      else if (fixtures && !result) bits.push('Streams unavailable right now');
      else if (result && result.message) bits.push(result.message);
      status.textContent = bits.join('  ·  ');
    }

    // ---- The list ----
    function visibleGames() {
      return compKey === 'all' ? games : games.filter(function (g) { return (g.league || g.competition) === compKey; });
    }
    function paintList(keepId) {
      listTrack.textContent = '';
      entries = [];
      lit = null;
      panelGame = undefined;
      bodyTop = 0;
      var list = visibleGames(), y = 0;
      empty.hidden = !!list.length && !loading;
      if (loading) {
        empty.hidden = true;
        for (var s = 0; s < 6; s++) {
          var sk = kit.el('div', 'fx-row fx-skeleton');
          sk.style.transform = 'translate3d(0,' + (s * ROW + GROUP) + 'px,0)';
          listTrack.appendChild(sk);
        }
        paintPanel(null);
        return;
      }
      if (!list.length) {
        empty.textContent = failed || emptyText();
        paintPanel(null);
        at = 0;
        return;
      }
      // Grouped by competition in the order of the row above; kick-off order inside each.
      var order = compList.map(function (c) { return c.key; });
      var groups = {};
      list.forEach(function (g) { var k = g.league || g.competition; (groups[k] = groups[k] || []).push(g); });
      order.filter(function (k) { return groups[k]; }).forEach(function (k) {
        var first = groups[k][0], head = kit.el('div', 'fx-group' + (first.league === Espn.NEPAL_LEAGUE ? ' fx-group-nepal' : ''));
        head.appendChild(kit.el('span', 'fx-group-name', first.competition));
        head.appendChild(kit.el('span', 'fx-group-meta', first.sport + (followed().indexOf(k) >= 0 ? '  ·  Following' : '')));
        head.style.transform = 'translate3d(0,' + y + 'px,0)';
        listTrack.appendChild(head);
        y += GROUP;
        groups[k].forEach(function (g) {
          var node = rowFor(g);
          node.style.transform = 'translate3d(0,' + y + 'px,0)';
          listTrack.appendChild(node);
          entries.push({ game: g, el: node, top: y, head: g === groups[k][0] ? y - GROUP : -1 });
          y += ROW;
        });
        y += 18;
      });
      listTrack.style.height = y + 'px';
      var found = keepId ? entries.map(function (e) { return e.game.id; }).indexOf(keepId) : -1;
      at = found >= 0 ? found : keepId ? Math.min(at, entries.length - 1) : firstInteresting();
      paintRows();
    }
    // Opening a day lands on what matters: the first live game, else the next to start, else the first.
    function firstInteresting() {
      var now = Date.now(), i;
      for (i = 0; i < entries.length; i++) if (entries[i].game.state === 'in') return i;
      for (i = 0; i < entries.length; i++) if (entries[i].game.startsAt > now) return i;
      return 0;
    }
    function emptyText() {
      var day = selectedDay();
      if (day.key === 'live') return 'Nothing is live right now.' + (nextUp ? ' Next up: ' + nextUp.title + ', ' +
        Live.startLabel(nextUp, Date.now()) + ' (' + nextUp.competition + ').' : ' Tomorrow and the days after list what’s coming up.');
      if (compKey !== 'all') return 'No games in this competition on this day.';
      return 'No cricket or football listed for ' + (day.title === 'Today' || day.title === 'Tomorrow' || day.title === 'Yesterday' ? day.title.toLowerCase() : Live.format('longDay', new Date(day.from))) + '.';
    }
    function scoreText(g, t) {
      if (g.state === 'pre' || g.state === 'off' || hideScores()) return '';
      if (g.sport === 'Cricket') return String(t.score || '').replace(/\s*\(.*$/, '');
      return t.score;
    }
    function oversText(g, t) {
      if (g.sport !== 'Cricket' || hideScores()) return '';
      var m = /\(([\d.]+)(?:\/\d+)? ov/.exec(t.score || '');
      return m ? m[1] + ' ov' : '';
    }
    function timeText(g) {
      if (g.state === 'in') return g.clock || (g.sport === 'Football' ? g.detail || 'Live' : 'Live');
      if (g.state === 'post') return g.sport === 'Football' ? (g.detail && g.detail.length <= 6 ? g.detail : 'FT') : 'Result';
      if (g.state === 'off') return /cancel/i.test(g.detail) ? 'Off' : 'PPD';
      return Live.format('time', g.startsAt);
    }
    // Without a crest (ESPN has none for the NPL's teams) a team gets its initials on a colour of its own.
    function crest(url, name) {
      var node = kit.el('span', 'fx-crest');
      node.textContent = initials(name);
      node.style.backgroundColor = crestColour(name);
      if (url) node._src = url;
      return node;
    }
    function crestColour(name) {
      var hue = 0;
      for (var i = 0; i < String(name).length; i++) hue = (hue * 31 + String(name).charCodeAt(i)) % 360;
      return 'hsl(' + hue + ',42%,34%)';
    }
    function initials(name) {
      return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
    }
    function rowFor(g) {
      var node = kit.el('div', 'fx-row' + (g.state === 'in' ? ' is-live' : '') + (g.state === 'post' || g.state === 'off' ? ' is-done' : ''));
      var time = kit.el('div', 'fx-time');
      if (g.state === 'in') time.appendChild(kit.el('span', 'fx-dot'));
      time.appendChild(kit.el('span', '', timeText(g)));
      node.appendChild(time);
      var teams = kit.el('div', 'fx-teams');
      var done = g.state === 'post' && !hideScores();
      g.teams.forEach(function (t) {
        var line = kit.el('div', 'fx-team' + (done && t.winner ? ' winner' : done && g.teams.some(function (o) { return o.winner; }) ? ' loser' : ''));
        line.appendChild(crest(t.logo, t.name));
        line.appendChild(kit.el('span', 'fx-name', t.name || '—'));
        var overs = oversText(g, t);
        if (overs) line.appendChild(kit.el('span', 'fx-overs', overs));
        line.appendChild(kit.el('span', 'fx-score', scoreText(g, t)));
        teams.appendChild(line);
      });
      node.appendChild(teams);
      var note = kit.el('div', 'fx-note', g.sport === 'Cricket' ? (g.state === 'pre' ? g.round : hideScores() ? '' : g.summary) : '');
      node.appendChild(note);
      var tags = kit.el('div', 'fx-tags');
      if (saved(g)) { var star = kit.el('span', 'fx-tag fx-tag-saved'); star.appendChild(kit.icon('star')); tags.appendChild(star); }
      if (g.streams.length && g.state !== 'post' && g.state !== 'off') {
        var watch = kit.el('span', 'fx-tag fx-tag-watch' + (g.state === 'in' ? ' on' : ''));
        watch.appendChild(kit.icon('play'));
        watch.appendChild(kit.el('span', '', g.state === 'in' ? 'Watch' : 'Stream'));
        tags.appendChild(watch);
      }
      node.appendChild(tags);
      return node;
    }
    // Crests load near the focus only: a weekend lists ~90 games.
    function loadCrests() {
      for (var i = Math.max(0, at - 6); i < Math.min(entries.length, at + 12); i++) {
        var crests = entries[i].el.querySelectorAll('.fx-crest');
        for (var j = 0; j < crests.length; j++) attachCrest(crests[j]);
      }
    }
    function attachCrest(node) {
      if (!node._src || node._loaded) return;
      node._loaded = true;
      var img = kit.el('img', 'fx-crest-img');
      img.alt = '';
      img.decoding = 'async';
      img.onload = function () { node.classList.add('has-image'); };
      img.onerror = function () { img.remove(); };
      img.src = node._src;
      node.appendChild(img);
    }
    // The page and the list scroll as one: moving down first slides the tabs away, then the list; each move
    // scrolls only as far as it takes to keep the focused game (and its competition's heading) on screen.
    // Each move repaints two rows and reads no layout (the list's top is measured when the list is built), and a
    // held arrow repaints the panel only when it settles: 20 ms a move on the TV before, mostly the panel.
    var offset = 0, lit = null, bodyTop = 0, panelGame = null, panelAt = 0, panelTimer = 0;
    function paintRows() {
      var e = entries[at], on = focused && row === 'list' && e ? e.el : null;
      if (lit !== on) {
        if (lit) lit.classList.remove('focused');
        if (on) on.classList.add('focused');
        lit = on;
      }
      if (e && row === 'list') {
        var top = bodyTop || (bodyTop = body.offsetTop), page = top - LIST_TOP, total = parseFloat(listTrack.style.height) || 0;
        var lo = top + e.top + ROW - 1040, hi = top + e.top - LIST_TOP - (e.head >= 0 ? GROUP : 40);
        if (at === 0) offset = 0; // the first game shows the tabs above it again
        offset = Math.max(0, Math.min(Math.max(lo, Math.min(offset, hi)), page + Math.max(0, total - (1080 - LIST_TOP - 40) + 20)));
      } else offset = 0;
      var shift = Math.min(offset, body.offsetTop - LIST_TOP);
      scroll = offset - shift;
      if (view() === 'matches') {
        track.style.transform = 'translate3d(0,' + -shift + 'px,0)';
        if (focused) shell.tuck(shift > 0);
      }
      listTrack.style.transform = 'translate3d(0,' + -scroll + 'px,0)';
      loadCrests();
      var g = e ? e.game : null, now = Date.now();
      clearTimeout(panelTimer);
      if (g === panelGame) return;
      if (now - panelAt > 250) { panelAt = now; panelGame = g; paintPanel(g); }
      else panelTimer = setTimeout(function () { panelAt = Date.now(); panelGame = g; paintPanel(g); }, 160);
    }

    // ---- The panel: everything known about the focused game ----
    // Built once and filled in per game (text, hidden, an image's src): rebuilding it cost the TV 46 ms a move.
    function pnode(parent, tag, cls) { return parent.appendChild(kit.el(tag, cls)); }
    var P = { eyebrow: pnode(panel, 'div', 'fx-p-eyebrow') };
    var pboard = pnode(panel, 'div', 'fx-p-board');
    P.sides = [0, 1].map(function (i) {
      var side = kit.el('div', 'fx-p-side');
      var c = pnode(side, 'span', 'fx-crest fx-p-crest'), img = pnode(c, 'img', 'fx-crest-img'), initials = pnode(c, 'span', 'fx-p-initials');
      img.alt = '';
      img.onload = function () { c.classList.add('has-image'); };
      img.onerror = function () { c.classList.remove('has-image'); img.removeAttribute('src'); };
      var out = { crest: c, img: img, initials: initials, name: pnode(side, 'div', 'fx-p-team'), runs: pnode(side, 'div', 'fx-p-runs') };
      pboard.appendChild(side);
      if (!i) { var mid = pnode(pboard, 'div', 'fx-p-mid'); P.score = pnode(mid, 'div', 'fx-p-score'); }
      return out;
    });
    P.status = pnode(panel, 'div', 'fx-p-status');
    P.summary = pnode(panel, 'div', 'fx-p-summary');
    var pfacts = pnode(panel, 'div', 'fx-p-facts');
    P.facts = ['Venue', 'On TV', 'Watch here', 'Reminder'].map(function (label) {
      var f = pnode(pfacts, 'div', 'fx-p-fact');
      pnode(f, 'span', 'fx-p-label').textContent = label;
      return { el: f, value: pnode(f, 'span', 'fx-p-value') };
    });
    var pkeys = pnode(panel, 'div', 'fx-p-keys');
    P.keys = [0, 1].map(function () {
      var k = pnode(pkeys, 'div', 'fx-p-key');
      return { el: k, cap: pnode(k, 'span', 'fx-p-cap'), text: pnode(k, 'span', '') };
    });
    function put(node, text) {
      text = text || '';
      if (node.textContent !== text) node.textContent = text;
      node.hidden = !text;
    }
    function paintPanel(g) {
      panel.classList.toggle('is-live', !!g && g.state === 'in');
      panel.hidden = !g;
      if (!g) return;
      var now = Date.now(), hidden = hideScores();
      put(P.eyebrow, [shortName(g.competition), g.round].filter(Boolean).join('  ·  ').toUpperCase());
      P.sides.forEach(function (side, i) {
        var t = g.teams[i] || { name: '' }, src = t.logo ? String(t.logo).replace('&w=96&h=96', '&w=240&h=240') : '';
        if (side.img.getAttribute('src') !== src) {
          side.crest.classList.remove('has-image');
          if (src) side.img.src = src; else side.img.removeAttribute('src');
        }
        side.initials.textContent = initials(t.name);
        side.crest.style.backgroundColor = crestColour(t.name);
        put(side.name, t.name);
        put(side.runs, g.sport === 'Cricket' && scoreText(g, t) ? scoreText(g, t) + (oversText(g, t) ? '  (' + oversText(g, t) + ')' : '') : '');
      });
      P.score.textContent = g.sport === 'Football' && g.state !== 'pre' && g.state !== 'off' && !hidden
        ? g.teams[0].score + ' – ' + g.teams[1].score : g.state === 'pre' ? Live.format('time', g.startsAt) : 'v';
      P.score.className = 'fx-p-score' + (g.state === 'pre' ? ' is-time' : '');
      put(P.status, g.state === 'in' ? 'LIVE' + (g.clock ? '  ·  ' + g.clock : g.detail && g.sport === 'Football' ? '  ·  ' + g.detail : '')
        : g.state === 'post' ? (g.sport === 'Football' ? 'Full time' : 'Finished') + '  ·  ' + Live.startLabel(g, now)
        : g.state === 'off' ? (g.detail || 'Postponed')
        : Live.startLabel(g, now) + '  ·  ' + Live.timing({ kind: 'event', startsAt: g.startsAt }, now).replace(/^S/, 's'));
      P.status.className = 'fx-p-status' + (g.state === 'in' ? ' live' : '');
      var spoiler = hidden && (g.state === 'in' || g.state === 'post');
      put(P.summary, spoiler ? 'Scores are hidden. The match page shows them.' : g.state !== 'pre' ? g.summary : '');
      P.summary.className = 'fx-p-summary' + (spoiler ? ' muted' : '');
      var languages = [];
      g.streams.forEach(function (s) { var n = Live.languageName(s.language); if (languages.indexOf(n) < 0) languages.push(n); });
      [g.venue, g.broadcast,
        g.streams.length ? g.streams.length + (g.streams.length === 1 ? ' stream' : ' streams') + ' · ' + languages.join(', ')
          : g.state === 'post' || g.state === 'off' ? '' : 'No stream listed yet',
        saved(g) ? (g.startsAt > now ? 'Set. Home reminds you before kick-off' : 'In My Sports') : ''
      ].forEach(function (value, i) { put(P.facts[i].value, value); P.facts[i].el.hidden = !value; });
      var second = watchable(g) ? 'Watch now' : g.state === 'pre' ? (saved(g) ? 'Cancel reminder' : 'Remind me') : '';
      P.keys[0].cap.textContent = 'OK';
      P.keys[0].text.textContent = g.fixture ? 'Match centre' : 'Details';
      P.keys[1].cap.textContent = '▶';
      P.keys[1].text.textContent = second;
      P.keys[1].el.hidden = !second;
    }

    // ---- Acting on a game ----
    function watchable(g) {
      return g.streams.length > 0 && g.state !== 'post' && g.state !== 'off' && g.startsAt - Date.now() <= 15 * 60000 &&
        Live.state(watchItem(g), Date.now()) !== 'Ended';
    }
    // What the match page, the player and My Sports take: the catalog listing's id and streams, ESPN's crests.
    function watchItem(g) {
      return Object.assign({}, g, { id: g.listing || g.id, title: g.teams[0].name + (g.teams[1].name ? ' vs ' + g.teams[1].name : ''),
        streams: Live.preferredStreams(g.streams, 'all'), crests: g.teams.map(function (t) { return t.logo; }),
        score: g.state === 'pre' ? null : { state: g.state === 'in' ? 'in' : 'post', line: '', summary: g.summary || '', crests: [] } });
    }
    function openGame(g) { shell.go('match', { item: watchItem(g) }); }
    function playGame(g) {
      if (watchable(g)) { data.playLive(watchItem(g), { direct: true }); return; }
      if (g.state !== 'pre') { shell.toast(g.streams.length ? 'This game has finished.' : 'No stream is listed for this game.'); return; }
      var on = data.toggleSportsBookmark(watchItem(g));
      if (!on && data.isSportsBookmark(g.id)) data.toggleSportsBookmark(g);
      shell.toast(on ? 'Reminder set. Home will remind you before ' + Live.format('time', g.startsAt) + '.' : 'Reminder cancelled');
      var keep = g.id;
      paintList(keep);
      updateFocus();
    }

    // ---- Tables ----
    var TABLES = [
      { key: '23081', sport: 'cricket', title: 'Nepal Premier League' },
      { key: 'eng.1', sport: 'soccer', title: 'Premier League' }, { key: 'uefa.champions', sport: 'soccer', title: 'Champions League' },
      { key: 'esp.1', sport: 'soccer', title: 'LALIGA' }, { key: 'ita.1', sport: 'soccer', title: 'Serie A' },
      { key: 'ger.1', sport: 'soccer', title: 'Bundesliga' }, { key: 'fra.1', sport: 'soccer', title: 'Ligue 1' },
      { key: 'uefa.europa', sport: 'soccer', title: 'Europa League' }, { key: 'uefa.europa.conf', sport: 'soccer', title: 'Conference League' },
      { key: 'ind.1', sport: 'soccer', title: 'Indian Super League' }, { key: 'ned.1', sport: 'soccer', title: 'Eredivisie' },
      { key: 'por.1', sport: 'soccer', title: 'Primeira Liga' }, { key: 'usa.1', sport: 'soccer', title: 'MLS' }
    ];
    var tableCache = {};
    function tableChoices() {
      var follow = followed();
      return TABLES.filter(function (t) { return shown(t.sport === 'cricket' ? 'Cricket' : 'Football'); }).map(function (t, i) {
        return { key: t.key, title: (follow.indexOf(t.key) >= 0 ? '★ ' : '') + t.title, sport: t.sport, rank: t.key === '23081' ? -1 : follow.indexOf(t.key) >= 0 ? 0 : 1, i: i };
      }).sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
    }
    function buildTableComps() {
      var choices = tableChoices(), current = tableComps ? tableComps.value : null;
      var index = Math.max(0, choices.map(function (c) { return c.key; }).indexOf(current));
      tableComps = makeTabs(tableCompsWrap, choices, index, function () { loadTable(); }, 'sports-comp-tabs');
    }
    var tableCompsWrap = kit.el('div', 'sports-comps st-comps');
    function loadTable() {
      var choice = tableChoices().filter(function (c) { return c.key === tableComps.value; })[0];
      if (!choice) return;
      var request = ++tableToken, cached = tableCache[choice.key];
      tableAt = 0;
      if (cached && Date.now() - cached.at < 10 * 60000) { table = cached.table; tableState = ''; paintTable(); return; }
      table = null;
      tableState = 'Loading the table…';
      paintTable();
      Espn.standings(choice.sport, choice.key).then(function (t) {
        tableCache[choice.key] = { at: Date.now(), table: t };
        if (request !== tableToken) return;
        table = t;
        tableState = '';
        paintTable();
      }, function () {
        if (request !== tableToken) return;
        tableState = 'This table isn’t available right now.';
        paintTable();
      });
    }
    function paintTables(rebuild) {
      if (rebuild && tableComps) buildTableComps();
    }
    function paintTable() {
      tableTrack.textContent = '';
      tableRows = [];
      if (!table) { tableTrack.appendChild(kit.el('div', 'fx-empty', tableState)); updateFocus(); return; }
      var names = games.reduce(function (m, g) { g.teams.forEach(function (t) { m[Live.normal(t.name)] = g; }); return m; }, {});
      table.groups.forEach(function (group) {
        if (group.title && table.groups.length > 1) tableTrack.appendChild(kit.el('div', 'st-group', group.title));
        var head = kit.el('div', 'st-row st-head');
        head.appendChild(kit.el('span', 'st-rank', '#'));
        head.appendChild(kit.el('span', 'st-team', 'Team'));
        table.columns.forEach(function (c) { head.appendChild(kit.el('span', 'st-num', c)); });
        tableTrack.appendChild(head);
        group.rows.forEach(function (r) {
          var node = kit.el('div', 'st-row');
          if (r.note) node.style.borderLeftColor = r.note.color;
          node.appendChild(kit.el('span', 'st-rank', r.rank || ''));
          var teamCell = kit.el('span', 'st-team');
          var c = crest(r.logo, r.team);
          teamCell.appendChild(c);
          teamCell.appendChild(kit.el('span', 'st-name', r.team));
          var playing = names[Live.normal(r.team)];
          if (playing && playing.state === 'in') teamCell.appendChild(kit.el('span', 'st-live', 'LIVE'));
          node.appendChild(teamCell);
          [r.played, r.won, r.drawn, r.lost, r.diff, r.points].forEach(function (v, i) {
            node.appendChild(kit.el('span', 'st-num' + (i === 5 ? ' st-pts' : ''), v));
          });
          tableTrack.appendChild(node);
          tableRows.push({ el: node, row: r, crest: c });
        });
      });
      var notes = {};
      table.groups.forEach(function (g) { g.rows.forEach(function (r) { if (r.note && r.note.text) notes[r.note.color] = r.note.text; }); });
      var legend = kit.el('div', 'st-legend');
      Object.keys(notes).forEach(function (color) {
        var item = kit.el('span', 'st-legend-item');
        var sw = kit.el('span', 'st-swatch');
        sw.style.background = color;
        item.appendChild(sw);
        item.appendChild(kit.el('span', '', notes[color]));
        legend.appendChild(item);
      });
      if (legend.firstChild) tableTrack.appendChild(legend);
      tableRows.forEach(function (t) { attachCrest(t.crest); });
      updateFocus();
    }
    function paintTableFocus() {
      tableRows.forEach(function (t, i) { t.el.classList.toggle('focused', focused && row === 'table' && i === tableAt); });
      var e = tableRows[tableAt];
      paintTeam(e ? e.row : null);
      tableScroll = row === 'table' && e ? Math.max(0, e.el.offsetTop - 300) : 0;
      tableTrack.style.transform = 'translate3d(0,' + -tableScroll + 'px,0)';
    }

    // The focused team: its place, record and what its position is worth, beside the table.
    function paintTeam(r) {
      tablePanel.textContent = '';
      tablePanel.hidden = !r;
      if (!r) return;
      var football = table.football, choice = TABLES.filter(function (x) { return x.key === tableComps.value; })[0];
      tablePanel.appendChild(kit.el('div', 'fx-p-eyebrow', (choice ? choice.title : table.title).toUpperCase()));
      var c = crest(r.logo, r.team);
      c.className = 'fx-crest fx-p-crest st-p-crest';
      attachCrest(c);
      tablePanel.appendChild(c);
      tablePanel.appendChild(kit.el('div', 'st-p-team', r.team));
      tablePanel.appendChild(kit.el('div', 'st-p-place', ordinal(r.rank) + '  ·  ' + r.points + ' pts'));
      if (r.note && r.note.text) {
        var note = kit.el('div', 'st-p-note', r.note.text);
        note.style.borderColor = r.note.color;
        tablePanel.appendChild(note);
      }
      var facts = kit.el('div', 'fx-p-facts');
      [['Played', r.played], ['Won', r.won], [football ? 'Drawn' : 'No result', r.drawn], ['Lost', r.lost],
        [football ? 'Goal difference' : 'Net run rate', r.diff]].forEach(function (f) {
        if (f[1] === '') return;
        var row2 = kit.el('div', 'fx-p-fact');
        row2.appendChild(kit.el('span', 'fx-p-label st-p-label', f[0]));
        row2.appendChild(kit.el('span', 'fx-p-value', f[1]));
        facts.appendChild(row2);
      });
      tablePanel.appendChild(facts);
      var keys = kit.el('div', 'fx-p-keys'), k = kit.el('div', 'fx-p-key');
      k.appendChild(kit.el('span', 'fx-p-cap', 'OK'));
      k.appendChild(kit.el('span', '', 'Next game'));
      keys.appendChild(k);
      tablePanel.appendChild(keys);
    }
    function ordinal(n) {
      var v = n % 100, suffix = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
      return n + suffix;
    }

    // ---- Channels (the TV service's 24/7 feeds and the configured playlists) ----
    function paintChannels() {
      var now = Date.now();
      channels = (catalog ? Live.select(catalog.items, 'channels', 'all', 'all', now) : []).filter(function (c) { return shown(c.sport); })
        .map(function (c) { return data.isSportsBookmark(c.id) ? Object.assign({}, c, { saved: true, badge: '★' }) : c; });
      channels = channels.filter(function (c) { return c.saved; }).concat(channels.filter(function (c) { return !c.saved; }));
      channelCount = Math.min(channels.length, PAGE);
      grid.setItems(channels.slice(0, channelCount));
      if (!channels.length) grid.setEmpty(catalog ? 'No channels for the sports you follow.' : 'Loading channels…');
    }
    function moreChannels() {
      if (channelCount >= channels.length) return;
      var next = Math.min(channels.length, channelCount + PAGE);
      grid.appendItems(channels.slice(channelCount, next));
      channelCount = next;
    }
    function playChannel(item, direct) {
      if (direct) { data.playLive(item, { direct: true }); return; }
      var on = data.isSportsBookmark(item.id);
      var options = item.streams.map(function (s, i) { return (i + 1) + '. ' + (s.label || 'Stream') + ' · ' + Live.languageName(s.language); });
      shell.choose({ title: item.title, body: 'Choose a stream', choices: options.concat(on ? 'Remove from My Sports' : 'Add to My Sports') }).then(function (index) {
        if (index === false) return;
        if (index < options.length) { data.playLive(item, { index: index }); return; }
        shell.toast(data.toggleSportsBookmark(item) ? 'Added to My Sports on the Home screen' : 'Removed from My Sports');
        paintChannels();
        updateFocus();
      });
    }

    // ---- Views and focus ----
    function view() { return views.value; }
    function paintView() {
      var v = view();
      el.className = 'sports-screen sports-view-' + v;
      dateWrap.hidden = v !== 'matches';
      compWrap.hidden = v !== 'matches' || compList.length < 2;
      body.hidden = v !== 'matches';
      tableView.hidden = v !== 'tables';
      channelView.hidden = v !== 'channels';
      bodyTop = 0;
      if (v === 'tables') {
        if (!tableCompsWrap.parentNode) top.appendChild(tableCompsWrap);
        tableCompsWrap.hidden = false;
        if (!tableComps) { buildTableComps(); loadTable(); }
        status.textContent = 'League tables from ESPN  ·  OK on a team shows its next game';
      } else {
        tableCompsWrap.hidden = true;
        if (v === 'channels') { status.textContent = 'Always-on sports channels'; paintChannels(); }
        else if (loading) status.textContent = 'Loading fixtures…';
        else if (selectedDay()) notice(lastFixtures, catalog);
      }
      updateFocus();
    }
    function rows() {
      var v = view();
      if (v === 'tables') return ['view', 'tcomp', 'table'];
      if (v === 'channels') return ['view', 'grid'];
      return compWrap.hidden ? ['view', 'date', 'list'] : ['view', 'date', 'comp', 'list'];
    }
    function updateFocus() {
      var deep = row === 'list' || row === 'table' || row === 'grid';
      if (view() !== 'matches') {
        var shift = row === 'table' ? tableView.offsetTop - LIST_TOP : row === 'grid' ? Math.max(0, channelView.offsetTop - 90) : 0;
        track.style.transform = 'translate3d(0,' + -shift + 'px,0)';
        if (focused) shell.tuck(deep);
      }
      // A competition focused: say what OK does with it.
      if (row === 'comp' && focused) {
        var c = compList.filter(function (x) { return x.key === compKey; })[0];
        status.textContent = !c ? 'Press OK on a competition to follow it' : followed().indexOf(c.key) >= 0
          ? 'Following ' + c.title + '  ·  OK to stop' : 'OK to follow ' + c.title + ' and list its games first';
        hinting = true;
      } else if (hinting) { hinting = false; if (view() === 'matches' && !loading) notice(lastFixtures, catalog); }
      var tabs = { view: views, date: dates, comp: comps, tcomp: tableComps };
      Object.keys(tabs).forEach(function (name) {
        if (!tabs[name]) return;
        if (focused && row === name) tabs[name].focus(); else tabs[name].blur();
      });
      if (focused && row === 'grid') grid.focus(); else grid.blur();
      if (view() === 'matches') paintRows();
      if (view() === 'tables') paintTableFocus();
      el.classList.toggle('sports-deep', deep);
    }
    function move(step) {
      var list = rows(), i = list.indexOf(row);
      if (i < 0) i = 0;
      var next = list[i + step];
      if (!next) return false;
      if (next === 'list' && !entries.length) return step > 0;
      if (next === 'table' && !tableRows.length) return step > 0;
      row = next;
      updateFocus();
      return true;
    }
    function handleKey(code) {
      touched = true;
      if (code === 10009) {
        // Back from deep in a list climbs to the tabs first, as tvOS does.
        if (row === 'list' || row === 'table' || row === 'grid') { row = view() === 'matches' ? 'date' : view() === 'tables' ? 'tcomp' : 'view'; updateFocus(); return true; }
        return false;
      }
      if (rows().indexOf(row) < 0) row = 'view';
      if (row === 'grid') {
        if (code === 38 && !grid.handleKey(code)) return move(-1);
        return grid.handleKey(code);
      }
      if (row === 'list') {
        var g = entries[at] && entries[at].game;
        if (code === 38 || code === 40) {
          var next = at + (code === 40 ? 1 : -1);
          if (next < 0) return move(-1);
          if (next >= entries.length) return true;
          at = next;
          paintRows();
          return true;
        }
        if (code === 13 && g) { openGame(g); return true; }
        if ((code === 10252 || code === 415) && g) { playGame(g); return true; }
        // Left at the list's edge reaches the side navigation bar, as on every screen; Right goes nowhere.
        return code === 39;
      }
      if (row === 'table') {
        if (code === 38 || code === 40) {
          var n = tableAt + (code === 40 ? 1 : -1);
          if (n < 0) return move(-1);
          if (n < tableRows.length) { tableAt = n; paintTableFocus(); }
          return true;
        }
        if (code === 13 && tableRows[tableAt]) { nextGameOf(tableRows[tableAt].row); return true; }
        return code !== 37;
      }
      if (code === 38 || code === 40) return move(code === 38 ? -1 : 1);
      if (code === 13) {
        if (row === 'comp') { if (compKey !== 'all') toggleFollow(); else shell.toast('Press OK on a competition to follow it'); return true; }
        if (row === 'tcomp') { followTable(); return true; }
        if (row === 'date' && failed) { loadGames(false); return true; }
        if (row === 'date' || row === 'view') return move(1) || true;
      }
      if (row === 'view') return views.handleKey(code);
      if (row === 'date') return dates.handleKey(code);
      if (row === 'comp') return comps.handleKey(code);
      if (row === 'tcomp') return tableComps.handleKey(code);
      return false;
    }
    function followTable() {
      var t = TABLES.filter(function (x) { return x.key === tableComps.value; })[0];
      if (!t) return;
      var list = (settings().followed || []).filter(function (f) { return f.key !== t.key; });
      var on = list.length === (settings().followed || []).length;
      if (on) list.unshift({ key: t.key, title: t.title, sport: t.sport === 'cricket' ? 'Cricket' : 'Football', league: t.key });
      data.setSetting('followed', list.slice(0, 30));
      shell.toast(on ? 'Following ' + t.title + '. Its games come first.' : 'Stopped following ' + t.title);
      buildTableComps();
      buildComps();
      paintList(entries[at] && entries[at].game.id);
      updateFocus();
    }
    // OK on a table row: that team's next (or current) game, on its match page.
    function nextGameOf(r) {
      var t = TABLES.filter(function (x) { return x.key === tableComps.value; })[0], now = Date.now();
      if (!t) return;
      Espn.teamNext(t.sport, t.key, r.id, now).then(function (g) {
        if (!g) { shell.toast('No upcoming game listed for ' + r.team); return; }
        var events = catalog ? catalog.items.filter(function (i) { return i.kind === 'event'; }) : [];
        openGame(Live.guide([Object.assign(g, { competition: g.competition || t.title })], events, now)[0]);
      }, function () { shell.toast('Couldn’t load ' + r.team + '’s games. Check your connection.'); });
    }

    function refresh() {
      if (!visible) return;
      loadCatalog(false).then(function () {
        if (view() === 'channels') paintChannels();
      });
      if (view() === 'matches') loadGames(true);
    }
    buildDates(null);
    buildComps();
    return {
      el: el,
      show: function (params, returning) {
        visible = true;
        // The strip is rebuilt each visit so "Today" is today after midnight.
        var today = String(midnight(Date.now()));
        if (!returning || !dayList[4] || dayList[4].key !== today) {
          buildDates(settings().sportsStart === 'live' ? 'live' : today);
          if (!returning) { row = 'date'; compKey = 'all'; touched = false; offset = 0; }
          loadGames(false);
        } else loadGames(true);
        paintView();
        clearInterval(timer);
        timer = setInterval(refresh, 60000);
      },
      hide: function () { visible = false; focused = false; clearInterval(timer); updateFocus(); },
      focus: function () { focused = true; updateFocus(); },
      hideFocus: function () { focused = false; updateFocus(); },
      // Settings changed (Hide scores, Sports shown, Clock) or a game was saved elsewhere: repaint in place.
      refresh: function () { if (visible && view() === 'matches') loadGames(true); else if (visible && view() === 'channels') paintChannels(); },
      handleKey: handleKey
    };
  });
})();
