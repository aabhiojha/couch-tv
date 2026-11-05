// A match's page, opened from Sports: the scoreboard over the two teams' colours, Watch buttons when it can be
// watched, then what ESPN knows (Espn.match): clips, timeline, stats, lineups, recent form and the table for
// football; scorecards and notes for cricket. Up/Down walk the sections; a live match refreshes every minute.
(function () {
  'use strict';
  Shell.register('match', function (ctx) {
    var kit = ctx.kit, data = ctx.data, shell = ctx.shell;
    var el = kit.el('main', 'details-screen match-screen');
    var viewport = kit.el('div', 'details-viewport');
    var track = kit.el('div', 'details-track');
    var hero = kit.el('section', 'match-hero');
    // The teams' colours as two soft spots, painted on a 64×24 canvas the GPU stretches over the hero: a blurred
    // full-size gradient cost the TV seconds of raster per scroll (tools/frames.js, match page).
    var glow = kit.el('canvas', 'match-glow');
    glow.width = 64;
    glow.height = 24;
    var eyebrow = kit.el('div', 'match-eyebrow');
    var board = kit.el('div', 'match-board');
    var sides = [0, 1].map(function () {
      var side = kit.el('div', 'match-side');
      var crest = kit.el('div', 'match-crest');
      var name = kit.el('div', 'match-team');
      var runs = kit.el('div', 'match-runs');
      side.appendChild(crest);
      side.appendChild(name);
      side.appendChild(runs);
      return { el: side, crest: crest, name: name, runs: runs };
    });
    var middle = kit.el('div', 'match-middle');
    var score = kit.el('div', 'match-score');
    var status = kit.el('div', 'match-status');
    middle.appendChild(score);
    middle.appendChild(status);
    board.appendChild(sides[0].el);
    board.appendChild(middle);
    board.appendChild(sides[1].el);
    var summary = kit.el('div', 'match-summary');
    var facts = kit.el('div', 'match-facts');
    var actions = kit.el('div', 'details-actions match-actions');
    var loadState = kit.el('div', 'details-load-state match-load');
    [glow, eyebrow, board, summary, facts, actions, loadState].forEach(function (node) { hero.appendChild(node); });
    track.appendChild(hero);

    function section(key, title) {
      var node = kit.el('section', 'match-section match-sec-' + key);
      node.appendChild(kit.el('h2', 'details-section-title', title));
      var body = kit.el('div', 'match-body');
      node.appendChild(body);
      node.hidden = true;
      track.appendChild(node);
      return { key: key, el: node, body: body };
    }
    var clipsSection = section('clips', 'Highlights & clips');
    var clips = kit.Row({ title: '', onSelect: playClip, onPlay: playClip });
    clipsSection.body.appendChild(clips.el);
    var sections = [clipsSection, section('timeline', 'Timeline'), section('stats', 'Match stats'),
      section('scorecard', 'Scorecard'), section('lineups', 'Lineups'), section('form', 'Recent form'),
      section('table', 'Table'), section('notes', 'Match notes')];
    function find(key) { return sections.filter(function (s) { return s.key === key; })[0]; }
    viewport.appendChild(track);
    el.appendChild(viewport);
    var marker = kit.el('div', 'match-marker');
    el.appendChild(marker);

    var item = null, match = null, buttons = [], buttonIndex = 0, zone = 'buttons', focused = false;
    var token = 0, timer = null, scrollY = 0;

    // ---- Hero ----
    function teamNames() {
      var parts = String(item.title || '').split(/\s+(?:vs?\.?|v)\s+/i);
      return parts.length === 2 ? parts : [item.title || '', ''];
    }
    function setCrest(node, url, name) {
      node.textContent = '';
      if (url) {
        var img = kit.el('img', 'match-crest-img');
        img.alt = '';
        img.onerror = function () { node.textContent = initials(name); };
        img.src = url;
        node.appendChild(img);
      } else node.textContent = initials(name);
    }
    function initials(name) {
      return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
    }
    function startText(at) {
      return at ? Live.startLabel({ startsAt: at }, Date.now()) : '';
    }
    function paintGlow(colors) {
      var g = glow.getContext('2d');
      g.clearRect(0, 0, glow.width, glow.height);
      [[colors[0], .22], [colors[1], .78]].forEach(function (spot) {
        if (!spot[0]) return;
        var x = glow.width * spot[1], y = glow.height * .3;
        var fill = g.createRadialGradient(x, y, 0, x, y, glow.width * .42);
        fill.addColorStop(0, spot[0]);
        fill.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = fill;
        g.fillRect(0, 0, glow.width, glow.height);
      });
    }
    function paintHero() {
      var now = Date.now(), m = match;
      var names = m ? m.teams.map(function (t) { return t.name; }) : teamNames();
      var crests = m ? m.teams.map(function (t) { return t.logo; }) : (item.crests || (item.score && item.score.crests) || []);
      eyebrow.textContent = [m ? m.competition : item.competition, m && m.round, item.sport || (m && m.sport)]
        .filter(Boolean).filter(function (v, i, all) { return all.indexOf(v) === i; }).join('  ·  ').toUpperCase();
      sides.forEach(function (side, i) {
        var t = m && m.teams[i];
        setCrest(side.crest, crests[i] || '', names[i]);
        side.name.textContent = names[i] || '';
        side.el.classList.toggle('winner', !!(t && t.winner));
        // Cricket: each side's innings under its name ("185 (40.2 ov)"); football's score sits in the middle.
        side.runs.textContent = t && !m.football ? t.innings.map(function (inn) {
          return inn.runs + (inn.wickets < 10 ? '/' + inn.wickets : '') + (inn.overs ? ' (' + inn.overs + ' ov)' : '');
        }).join('  &  ') : '';
      });
      var state = m ? m.state : item.kind === 'result' ? 'post' : item.score ? item.score.state : 'pre';
      var start = (m && m.startsAt) || item.startsAt;
      hero.classList.toggle('is-live', state === 'in');
      if (m && m.football && state !== 'pre') score.textContent = m.teams[0].score + ' – ' + m.teams[1].score;
      else if (!m && item.score && /^\S+ (\d+) – (\d+) \S+/.test(item.score.line) && state !== 'pre')
        score.textContent = item.score.line.replace(/^\S+ (\d+) – (\d+) \S+.*$/, '$1 – $2'); // "COMO 4 – 1 MAN" until ESPN answers
      else if (m && !m.football && state !== 'pre') score.textContent = 'v';
      else score.textContent = start ? Live.format('time', start) : 'v';
      score.classList.toggle('match-score-time', state === 'pre' || (m && !m.football));
      if (state === 'in') status.textContent = 'LIVE' + (m && m.clock ? '  ' + m.clock : m && m.detail ? '  ' + m.detail : '');
      else if (state === 'post') status.textContent = (m && m.detail) || 'Full time';
      else status.textContent = start ? startText(start) + (start > now ? '  ·  ' + Live.timing({ kind: 'event', startsAt: start }, now) : '') : '';
      status.className = 'match-status' + (state === 'in' ? ' live' : '');
      summary.textContent = (m && m.summary) || (item.score && item.score.summary) || '';
      var bits = [];
      if (m && m.venue) bits.push(m.venue);
      if (start && state !== 'pre') bits.push(Live.format('date', start));
      if (m && m.attendance) bits.push(Live.format('number', m.attendance) + ' attendance');
      facts.textContent = bits.join('   ·   ');
      // The teams' own colours, faint, behind the board.
      paintGlow(m ? m.teams.map(function (t) { return t.color; }) : []);
    }

    // ---- Buttons: Watch (the preferred feed), Watch options, My Sports, and the first clip of a finished game ----
    function watchable() {
      if (!item.streams || !item.streams.length) return false;
      var s = Live.state(item, Date.now());
      return s !== 'Ended' && !(item.kind === 'event' && item.startsAt - Date.now() > 15 * 60000);
    }
    function button(iconName, label, action) {
      var b = kit.el('div', 'details-button');
      if (iconName) b.appendChild(kit.icon(iconName));
      b.appendChild(kit.el('span', '', label));
      b._action = action;
      return b;
    }
    function buildButtons() {
      actions.textContent = '';
      buttons = [];
      var saved = data.isSportsBookmark(item.id);
      var far = item.kind === 'event' && item.startsAt - Date.now() > 15 * 60000;
      if (watchable()) {
        buttons.push(button('play', item.kind === 'channel' || (match && match.state === 'in') || !match ? 'Watch live' : 'Watch', function () {
          data.playLive(item, { direct: true });
        }));
        if (item.streams.length > 1) buttons.push(button('list', 'Watch options', chooseFeed));
      }
      if (match && match.videos.length && !watchable()) buttons.push(button('film', 'Highlights', function () { playClip(match.videos[0]); }));
      if (item.kind !== 'result' && item.streams && item.streams.length) {
        buttons.push(button(saved ? 'check' : 'plus', saved ? (far ? 'Reminder set' : 'In My Sports') : (far ? 'Remind me' : 'My Sports'), function () {
          var on = data.toggleSportsBookmark(item);
          shell.toast(!on ? (far ? 'Reminder cancelled' : 'Removed from My Sports') :
            far ? 'Saved. The Home screen will remind you when it’s about to start.' : 'Added to My Sports on the Home screen');
          buildButtons();
          updateFocus();
        }));
      }
      buttons.forEach(function (b) { actions.appendChild(b); });
      actions.hidden = !buttons.length;
      if (buttonIndex >= buttons.length) buttonIndex = Math.max(0, buttons.length - 1);
    }
    function chooseFeed() {
      var options = item.streams.map(function (s, i) { return (i + 1) + '. ' + (s.label || 'Stream') + ' · ' + Live.languageName(s.language); });
      shell.choose({ title: item.title, body: 'Choose a stream', choices: options }).then(function (index) {
        if (index !== false) data.playLive(item, { index: index });
      });
    }
    function playClip(clip) {
      var video = clip && clip.video ? clip.video : clip;
      if (video && video.url) data.playClip(video, item.title);
    }

    // ---- Sections ----
    function show(key, visible) { find(key).el.hidden = !visible; }
    function fill(key, node) { var s = find(key); s.body.textContent = ''; s.body.appendChild(node); }
    function div(className, text) { return kit.el('div', className, text); }
    var EVENT_LABEL = { goal: 'Goal', 'own-goal': 'Own goal', yellow: 'Yellow card', red: 'Red card', sub: 'Substitution', miss: 'Penalty missed' };

    function paintTimeline(m) {
      // Home events on the left, away on the right, minutes down the middle; substitutions only after the rest.
      var rows = div('match-timeline');
      m.events.forEach(function (e) {
        var row = div('match-tl-row match-tl-' + (e.side === 1 ? 'away' : 'home'));
        var text = div('match-tl-text');
        var head = div('match-tl-player');
        head.appendChild(kit.el('span', 'match-tl-icon match-icon-' + e.kind));
        head.appendChild(kit.el('span', '', e.player));
        text.appendChild(head);
        text.appendChild(div('match-tl-detail', [EVENT_LABEL[e.kind], e.detail].filter(Boolean).join(' · ')));
        row.appendChild(text);
        row.appendChild(div('match-tl-minute', e.minute));
        rows.appendChild(row);
      });
      fill('timeline', rows);
      show('timeline', m.events.length > 0);
    }
    function paintStats(m) {
      var box = div('match-stats');
      m.stats.forEach(function (s) {
        var total = s.home + s.away, share = total ? s.home / total : .5;
        var row = div('match-stat');
        var line = div('match-stat-line');
        line.appendChild(div('match-stat-value', s.home + s.unit));
        line.appendChild(div('match-stat-label', s.label));
        line.appendChild(div('match-stat-value', s.away + s.unit));
        row.appendChild(line);
        var bar = div('match-stat-bar');
        var home = div('match-stat-home'), away = div('match-stat-away');
        home.style.width = Math.round(share * 100) + '%';
        away.style.width = Math.round((1 - share) * 100) + '%';
        if (s.home > s.away) home.classList.add('lead');
        if (s.away > s.home) away.classList.add('lead');
        bar.appendChild(home);
        bar.appendChild(away);
        row.appendChild(bar);
        box.appendChild(row);
      });
      fill('stats', box);
      show('stats', m.stats.length > 0);
    }
    function paintLineups(m) {
      var box = div('match-columns');
      m.lineups.forEach(function (l) {
        var col = div('match-column');
        col.appendChild(div('match-column-head', l.team + (l.formation ? '  ·  ' + l.formation : '')));
        l.starters.forEach(function (p) {
          var row = div('match-player' + (p.off ? ' off' : ''));
          row.appendChild(div('match-player-number', p.number));
          row.appendChild(div('match-player-name', p.name));
          row.appendChild(div('match-player-pos', p.position));
          col.appendChild(row);
        });
        var subs = l.bench.filter(function (p) { return p.on; });
        if (subs.length) col.appendChild(div('match-player-bench', 'Came on: ' + subs.map(function (p) { return p.name; }).join(', ')));
        box.appendChild(col);
      });
      fill('lineups', box);
      show('lineups', m.lineups.length > 0);
    }
    function paintForm(m) {
      var box = div('match-columns');
      m.form.forEach(function (t) {
        var col = div('match-column');
        col.appendChild(div('match-column-head', t.team));
        var pills = div('match-form-pills');
        t.games.forEach(function (g) { pills.appendChild(div('match-form-pill result-' + (g.result || '-').toLowerCase(), g.result || '–')); });
        col.appendChild(pills);
        t.games.forEach(function (g) {
          var row = div('match-form-game');
          row.appendChild(div('match-form-result result-' + (g.result || '-').toLowerCase(), g.result || '–'));
          row.appendChild(div('match-form-opponent', (g.home ? 'vs ' : 'at ') + g.opponent));
          row.appendChild(div('match-form-score', g.score));
          col.appendChild(row);
        });
        box.appendChild(col);
      });
      fill('form', box);
      show('form', m.form.length > 0);
    }
    function paintTable(m) {
      var t = m.table;
      show('table', !!t);
      if (!t) return;
      var box = div('match-table');
      var head = div('match-table-row match-table-head');
      ['#', 'Team', 'P', 'W', 'D', 'L', 'GD', 'Pts'].forEach(function (h) { head.appendChild(div('', h)); });
      box.appendChild(head);
      var last = 0;
      t.rows.forEach(function (r) {
        if (last && r.rank > last + 1) box.appendChild(div('match-table-gap', '···'));
        last = r.rank;
        var row = div('match-table-row' + (r.mine ? ' mine' : ''));
        [r.rank, r.team, r.played, r.won, r.drawn, r.lost, r.diff, r.points].forEach(function (v) { row.appendChild(div('', String(v))); });
        box.appendChild(row);
      });
      find('table').el.querySelector('.details-section-title').textContent = t.title;
      fill('table', box);
    }
    function paintScorecard(m) {
      var box = div('match-columns');
      m.scorecards.forEach(function (card) {
        var col = div('match-column match-card');
        col.appendChild(div('match-column-head', card.team + ' · ' + (card.kind === 'batting' ? 'Batting' : 'Bowling') + (card.total ? '  ·  ' + card.total : '')));
        var head = div('match-card-row match-card-head');
        (card.kind === 'batting' ? ['Batter', 'R', 'B', '4s', '6s'] : ['Bowler', 'O', 'M', 'R', 'W']).forEach(function (h) { head.appendChild(div('', h)); });
        col.appendChild(head);
        card.rows.forEach(function (r) {
          var row = div('match-card-row');
          var name = div('match-card-name');
          name.appendChild(kit.el('span', '', r.name));
          if (r.out) name.appendChild(kit.el('span', 'match-card-out', r.out));
          row.appendChild(name);
          (card.kind === 'batting' ? [r.runs, r.balls, r.fours, r.sixes] : [r.overs, r.maidens, r.runs, r.wickets]).forEach(function (v) { row.appendChild(div('', v)); });
          col.appendChild(row);
        });
        if (card.didNotBat && card.didNotBat.length) col.appendChild(div('match-player-bench', 'Did not bat: ' + card.didNotBat.join(', ')));
        if (card.extras) col.appendChild(div('match-player-bench', 'Extras ' + card.extras));
        box.appendChild(col);
      });
      fill('scorecard', box);
      show('scorecard', m.scorecards.length > 0);
    }
    function paintNotes(m) {
      var box = div('match-notes');
      m.notes.forEach(function (n) { box.appendChild(div('match-note', n)); });
      fill('notes', box);
      show('notes', m.notes.length > 0);
    }
    function paintClips(m) {
      clips.setItems(m.videos.map(function (v) {
        var mins = Math.floor(v.duration / 60), secs = v.duration % 60;
        return { id: v.id, title: v.title, thumb: v.thumb, video: v, meta: v.duration ? mins + ':' + (secs < 10 ? '0' : '') + secs : 'ESPN' };
      }));
      show('clips', m.videos.length > 0);
    }
    function paintSections() {
      var m = match;
      if (!m) { sections.forEach(function (s) { s.el.hidden = true; }); return; }
      paintClips(m);
      paintTimeline(m);
      paintStats(m);
      paintScorecard(m);
      paintLineups(m);
      paintForm(m);
      paintTable(m);
      paintNotes(m);
    }

    // ---- Loading ----
    function load(quiet) {
      var request = ++token, ref = Espn.ref(item.espn);
      if (!ref) {
        loadState.textContent = item.kind === 'channel' ? '' : 'No match details for this listing.';
        return;
      }
      if (!quiet) loadState.textContent = 'Loading match details…';
      Espn.match(ref).then(function (m) {
        if (request !== token) return;
        match = m;
        loadState.textContent = '';
        paintHero();
        buildButtons();
        paintSections();
        if (zones().indexOf(zone) < 0) zone = 'buttons';
        updateFocus();
        clearInterval(timer);
        if (m.state === 'in') timer = setInterval(function () { if (!el.hidden) load(true); }, 60000);
      }, function () {
        if (request !== token || quiet) return;
        loadState.textContent = 'Couldn’t load match details. Press OK on Retry.';
        buttons.push(button('restart', 'Retry', function () { load(false); }));
        actions.appendChild(buttons[buttons.length - 1]);
        actions.hidden = false;
        updateFocus();
      });
    }

    // ---- Focus and scrolling ----
    function zones() {
      return ['buttons'].concat(sections.filter(function (s) { return !s.el.hidden; }).map(function (s) { return s.key; }))
        .filter(function (z) { return z !== 'buttons' || buttons.length; });
    }
    function updateFocus() {
      buttons.forEach(function (b, i) { b.classList.toggle('focused', focused && zone === 'buttons' && i === buttonIndex); });
      if (focused && zone === 'clips') clips.focus(); else clips.blur();
      var target = zone === 'buttons' ? null : find(zone).el;
      if (!target) scrollY = 0;
      else {
        var top = target.offsetTop;
        var maxScroll = Math.max(0, track.scrollHeight - 1080);
        scrollY = Math.min(maxScroll, Math.max(0, top - 120));
        // The heading's middle, where it will be once the page has moved (offsetTop is from the screen: sections
        // aren't positioned).
        var heading = target.firstChild;
        marker.style.transform = 'translate3d(0,' + (heading.offsetTop + heading.offsetHeight / 2 - 18 - scrollY) + 'px,0)';
      }
      marker.classList.toggle('on', !!(focused && target));
      track.style.transform = 'translate3d(0,' + -scrollY + 'px,0)';
    }
    function moveZone(step) {
      var all = zones(), next = all[all.indexOf(zone) + step];
      if (!next) return step > 0;
      zone = next;
      updateFocus();
      return true;
    }
    function handleKey(code) {
      if (code === 10009) return false;
      if (code === 38 || code === 40) {
        if (zone === 'buttons' && code === 38) return false;
        return moveZone(code === 38 ? -1 : 1);
      }
      if ((code === 10252 || code === 415) && watchable()) { data.playLive(item, { direct: true }); return true; }
      if (zone === 'buttons') {
        if (code === 37 || code === 39) {
          if (code === 37 && buttonIndex === 0) return false;
          buttonIndex = Math.max(0, Math.min(buttons.length - 1, buttonIndex + (code === 39 ? 1 : -1)));
          updateFocus();
          return true;
        }
        if (code === 13 && buttons[buttonIndex]) { buttons[buttonIndex]._action(); return true; }
        return true;
      }
      if (zone === 'clips') { if (clips.handleKey(code)) return true; return code !== 37; }
      return code !== 37;
    }

    return {
      el: el,
      show: function (params, returning) {
        el.hidden = false;
        if (returning) { buildButtons(); updateFocus(); return; }
        item = params.item;
        match = null;
        zone = 'buttons';
        buttonIndex = 0;
        scrollY = 0;
        clearInterval(timer);
        paintHero();
        buildButtons();
        paintSections();
        updateFocus();
        load(false);
      },
      hide: function () { clearInterval(timer); focused = false; updateFocus(); el.hidden = true; },
      focus: function () { focused = true; updateFocus(); },
      hideFocus: function () { focused = false; updateFocus(); },
      handleKey: handleKey
    };
  });
})();
