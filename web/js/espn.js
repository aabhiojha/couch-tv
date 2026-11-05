// Match details and results from ESPN's public APIs (no key; CORS open), for the match page and the Sports guide.
// ESPN's own field names stay in here; screens get the plain shapes below.
(function (root) {
  'use strict';
  var SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
  var HEADER = 'https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=';
  // Football fixtures come from these competitions only (a day lists ~75 games worldwide); cricket lists them all.
  var FOOTBALL = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
    'eng.fa', 'eng.league_cup', 'esp.copa_del_rey', 'ind.1', 'fifa.world', 'fifa.worldq.afc', 'fifa.worldq.uefa',
    'uefa.nations', 'uefa.euro', 'conmebol.america', 'afc.asian.cup', 'usa.1', 'ksa.1', 'por.1', 'ned.1', 'mex.1', 'bel.1',
    'sco.1', 'tur.1', 'eng.2', 'swe.1', 'den.1', 'bra.1', 'arg.1', 'fifa.cwc', 'afc.champions'];

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('ESPN HTTP ' + r.status);
      return r.json();
    });
  }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function https(url) { return /^https:\/\//.test(str(url)) ? str(url) : ''; }
  // ESPN's images at the size they're shown (crests are 500 px, clip stills 1920×1080): its resizer takes the
  // full URL. Decoding the full-size ones cost the TV 165-236 ms each (tools/frames.js, match page).
  function sized(url, w, h) {
    url = https(url);
    return /^https:\/\/([\w-]+\.)*(espncdn\.com|espnmedia-cdn\.akamaized\.net)\//.test(url)
      ? 'https://a.espncdn.com/combiner/i?img=' + encodeURIComponent(url) + '&w=' + w + '&h=' + h : url;
  }
  function sportName(espnSport) { return espnSport === 'cricket' ? 'Cricket' : 'Football'; }
  function ymd(date) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate());
  }
  // A listing's link to its ESPN match ({ sport, league, event }), or null.
  function ref(value) {
    return value && /^(soccer|cricket)$/.test(value.sport) && /^[\w.]+$/.test(str(value.league)) && /^\d+$/.test(str(value.event))
      ? { sport: value.sport, league: str(value.league), event: str(value.event) } : null;
  }

  // ---- Fixtures: every game of a day, for the Sports guide ----
  // ESPN's boards run on US Eastern days, so a local day spans one or two of them; each board is fetched once
  // and kept (a minute while it can change, longer for days that are settled). Cricket lists every first-class
  // and domestic competition too: those are left out, internationals, T20 leagues and Nepal's are kept.
  var CRICKET_SKIP = /ranji|quaid|plunket|sheffield|shield|county|duleep|vijay hazare|mushtaq|deodhar|pro50|division|\d-day|first.class|domestic|major league tournament|national t20 cup|super smash|marsh cup|ford trophy|logan cup/i;
  // "Janakpur Bolts (NPL)": ESPN tags franchise teams with their league.
  var SUFFIX = /\s*\((?:NPL|[A-Z]{2,5})\)$/;
  var NEPAL_LEAGUE = '23081'; // ESPNcricinfo's Nepal Premier League
  var EASTERN = 5 * 3600000;
  function side(t, football) {
    return { name: str(t.displayName).replace(SUFFIX, ''), short: str(t.abbreviation),
      logo: sized(t.logoDark || t.logo, 96, 96), score: str(t.score), winner: t.winner === true, home: t.homeAway === 'home',
      order: Number(t.order) || 0, football: football };
  }
  function fixture(espnSport, league, e) {
    var football = espnSport === 'soccer';
    var teams = list(e.competitors).map(function (t) { return side(t, football); });
    if (teams.length !== 2 || !/^(pre|in|post)$/.test(e.status)) return null;
    teams.sort(football ? function (a, b) { return (a.home ? 0 : 1) - (b.home ? 0 : 1); } : function (a, b) { return a.order - b.order; });
    var status = e.fullStatus || {}, type = status.type || {};
    // Postponed, abandoned and cancelled games are "post" without being completed.
    var off = e.status === 'post' && type.completed === false;
    return {
      id: 'espn:' + e.id, kind: 'event', fixture: true, sport: sportName(espnSport),
      title: teams[0].name + ' vs ' + teams[1].name, teams: teams,
      competition: str(football ? league.abbreviation || league.name : league.name).replace(/^\d{4}(?:\/\d{2,4})?\s+|\s+\d{4}(?:\/\d{2,4})?$/g, ''),
      league: str(league.slug || league.id), round: football ? '' : str(e.title),
      startsAt: Date.parse(e.date) || 0, endsAt: 0,
      state: off ? 'off' : e.status, clock: e.status === 'in' && football ? str(status.displayClock) : '',
      detail: off ? str(type.description) || 'Postponed' : str(type.shortDetail),
      summary: football || e.status === 'pre' ? '' : str(status.summary || e.summary), venue: str(e.location), broadcast: str(e.broadcast),
      streams: [], espn: { sport: espnSport, league: str(league.slug || league.id), event: str(e.id) }
    };
  }
  function keep(espnSport, league) {
    if (espnSport === 'soccer') return FOOTBALL.indexOf(league.slug) >= 0;
    return str(league.id) === NEPAL_LEAGUE || !CRICKET_SKIP.test(str(league.name));
  }
  function parseBoard(espnSport, d) {
    var out = [];
    list(d && d.sports).forEach(function (s) {
      list(s.leagues).forEach(function (league) {
        if (!keep(espnSport, league)) return;
        list(league.events).forEach(function (e) {
          var f = fixture(espnSport, league, e);
          if (f && f.league && f.startsAt) out.push(f);
        });
      });
    });
    return out;
  }
  // On the TV the boards come trimmed from its own service (/sports/board, ~5% of ESPN's size, parsed there rather
  // than on the UI thread); ESPN is asked directly when there is no service or it fails.
  var boards = {}, service = '';
  function useService(base) { service = /^https?:\/\//.test(str(base)) ? str(base).replace(/\/$/, '') : ''; }
  function boardJson(espnSport, day) {
    var direct = function () { return getJson(HEADER + espnSport + '&dates=' + day); };
    return service ? getJson(service + '/sports/board?sport=' + espnSport + '&date=' + day).catch(direct) : direct();
  }
  function board(espnSport, day, now) {
    var key = espnSport + ':' + day, cached = boards[key];
    if (cached && now - cached.at < cached.ttl) return cached.promise;
    var promise = boardJson(espnSport, day).then(function (d) {
      var games = parseBoard(espnSport, d);
      // Settled days (all finished, or all days away) change rarely; a day with games on changes every minute.
      var moving = games.some(function (g) { return g.state === 'in' || (g.state === 'pre' && g.startsAt - now < 3600000); });
      boards[key].ttl = moving ? 60000 : 15 * 60000;
      return games;
    });
    boards[key] = { at: now, ttl: 60000, promise: promise };
    promise.catch(function () { delete boards[key]; });
    return promise;
  }
  // The games starting in [from, to) (local midnight to midnight), cricket and football, by kick-off.
  // A board that fails is left out; all failing rejects.
  function fixtures(from, to, now) {
    var days = [ymd(new Date(from - EASTERN))];
    if (ymd(new Date(to - 1 - EASTERN)) !== days[0]) days.push(ymd(new Date(to - 1 - EASTERN)));
    var asks = [];
    days.forEach(function (day) { asks.push(board('soccer', day, now), board('cricket', day, now)); });
    return Promise.all(asks.map(function (p) { return p.then(function (r) { return { ok: true, r: r }; }, function () { return { ok: false }; }); }))
      .then(function (all) {
        if (!all.some(function (a) { return a.ok; })) throw new Error('Fixtures unavailable');
        var seen = {}, out = [];
        all.forEach(function (a) {
          (a.r || []).forEach(function (g) {
            // A Test that began on an earlier day stays listed on today's list while it is being played.
            var carried = g.state === 'in' && now >= from && now < to;
            if (seen[g.id] || (g.startsAt < from && !carried) || g.startsAt >= to) return;
            seen[g.id] = true;
            out.push(g);
          });
        });
        return out.sort(function (a, b) { return a.startsAt - b.startsAt || a.competition.localeCompare(b.competition); });
      });
  }

  // ---- A competition's table ----
  function standings(espnSport, league) {
    if (!/^(soccer|cricket)$/.test(espnSport) || !/^[\w.]+$/.test(str(league))) return Promise.reject(new Error('No table'));
    return getJson('https://site.web.api.espn.com/apis/v2/sports/' + espnSport + '/' + league + '/standings').then(function (d) {
      return readStandings(espnSport, d);
    });
  }
  // Crests drawn for a dark background where ESPN has them (Juventus' black zebra otherwise disappears).
  function darkLogo(logos) {
    var all = list(logos), dark = all.filter(function (l) { return list(l.rel).indexOf('dark') >= 0; })[0];
    return str((dark || all[0] || {}).href);
  }
  function readStandings(espnSport, d) {
    var football = espnSport === 'soccer';
    var groups = list(d && d.children).map(function (child) {
      var rows = list(child.standings && child.standings.entries).map(function (e) {
        var s = {}, t = e.team || {};
        list(e.stats).forEach(function (x) { s[x.abbreviation || x.name] = str(x.displayValue); });
        return { id: str(t.id), rank: Number(s.R) || (e.note && Number(e.note.rank)) || 0, team: str(t.displayName).replace(SUFFIX, ''),
          short: str(t.abbreviation), logo: sized(darkLogo(t.logos), 64, 64),
          played: football ? s.GP || '' : s.M || '', won: s.W || '', drawn: football ? s.D || '' : s['N/R'] || '', lost: s.L || '',
          diff: football ? s.GD || '' : s.NRR || '', points: football ? s.P || '' : s.PT || '',
          note: e.note && /^#[0-9a-f]{6}$/i.test(str(e.note.color)) ? { color: e.note.color, text: str(e.note.description) } : null };
      }).sort(function (a, b) { return a.rank - b.rank; });
      return { title: str(child.name), rows: rows };
    }).filter(function (g) { return g.rows.length; });
    if (!groups.length) throw new Error('No table');
    return { title: str(d.name), football: football, groups: groups,
      columns: football ? ['P', 'W', 'D', 'L', 'GD', 'Pts'] : ['M', 'W', 'NR', 'L', 'NRR', 'Pts'] };
  }

  // ---- One match: header, timeline, stats, lineups, form, table, videos (football) or innings and scorecards (cricket) ----
  var EVENT_KINDS = { 'Goal': 'goal', 'Goal - Header': 'goal', 'Goal - Free-kick': 'goal', 'Penalty - Scored': 'goal',
    'Own Goal': 'own-goal', 'Yellow Card': 'yellow', 'Red Card': 'red', 'Substitution': 'sub', 'Penalty - Missed': 'miss',
    'Penalty - Saved': 'miss' };
  var STATS = [['possessionPct', 'Possession', '%'], ['totalShots', 'Shots'], ['shotsOnTarget', 'On target'],
    ['wonCorners', 'Corners'], ['foulsCommitted', 'Fouls'], ['yellowCards', 'Yellow cards'], ['offsides', 'Offsides'],
    ['saves', 'Saves'], ['accuratePasses', 'Accurate passes']];

  function team(c, football) {
    var t = c.team || {};
    var logos = list(t.logos);
    return { id: str(t.id), name: str(t.displayName).replace(SUFFIX, ''), short: str(t.abbreviation), color: /^[0-9a-f]{6}$/i.test(str(t.color)) ? '#' + t.color : '',
      logo: sized(darkLogo(logos) || t.logo, 200, 200), score: str(c.score), winner: c.winner === true || c.winner === 'true',
      home: c.homeAway === 'home', order: Number(c.order) || 0,
      innings: football ? [] : list(c.linescores).filter(function (l) { return Number(l.runs) > 0 || Number(l.wickets) > 0; }).map(function (l) {
        return { runs: Number(l.runs) || 0, wickets: Number(l.wickets) || 0, overs: str(l.overs) };
      }) };
  }
  function timeline(d, teams) {
    return list(d.keyEvents).map(function (k) {
      var kind = EVENT_KINDS[k.type && k.type.text];
      if (!kind) return null;
      var people = list(k.participants).map(function (p) { return p.athlete ? str(p.athlete.displayName) : ''; }).filter(Boolean);
      var side = k.team && teams.length === 2 ? (str(k.team.id) === teams[0].id ? 0 : str(k.team.id) === teams[1].id ? 1 : -1) : -1;
      return { minute: str(k.clock && k.clock.displayValue), kind: kind, side: side,
        // A substitution lists who came on first, then who went off.
        player: people[0] || str(k.shortText), detail: kind === 'sub' ? (people[1] ? 'for ' + people[1] : '') :
          kind === 'goal' && people[1] ? 'Assist: ' + people[1] : '' };
    }).filter(Boolean);
  }
  function stats(d, teams) {
    var boxes = list(d.boxscore && d.boxscore.teams);
    if (boxes.length !== 2 || teams.length !== 2) return [];
    var byTeam = boxes.map(function (b) {
      var values = {};
      list(b.statistics).forEach(function (s) { values[s.name] = Number(s.displayValue); });
      return { id: str(b.team && b.team.id), values: values };
    });
    if (byTeam[0].id !== teams[0].id) byTeam.reverse();
    return STATS.map(function (s) {
      var a = byTeam[0].values[s[0]], b = byTeam[1].values[s[0]];
      if (!isFinite(a) || !isFinite(b) || (a === 0 && b === 0 && s[0] !== 'possessionPct')) return null;
      return { label: s[1], home: a, away: b, unit: s[2] || '' };
    }).filter(Boolean);
  }
  function lineups(d, teams) {
    return list(d.rosters).map(function (r) {
      var players = list(r.roster).map(function (p) {
        return { number: str(p.jersey), name: str(p.athlete && p.athlete.displayName), position: str(p.position && p.position.abbreviation),
          starter: !!p.starter, place: Number(p.formationPlace) || 99, off: !!p.subbedOut, on: !!p.subbedIn };
      }).filter(function (p) { return p.name; });
      return { team: str(r.team && r.team.displayName), id: str(r.team && r.team.id), formation: str(r.formation),
        starters: players.filter(function (p) { return p.starter; }).sort(function (a, b) { return a.place - b.place; }),
        bench: players.filter(function (p) { return !p.starter; }) };
    }).filter(function (l) { return l.starters.length; }).sort(function (a, b) {
      return (a.id === (teams[0] || {}).id ? 0 : 1) - (b.id === (teams[0] || {}).id ? 0 : 1);
    });
  }
  function form(d) {
    return list(d.lastFiveGames).map(function (t) {
      return { team: str(t.team && t.team.displayName), logo: https(t.team && t.team.logo), games: list(t.events).slice(0, 5).map(function (e) {
        return { result: str(e.gameResult), score: str(e.score), opponent: str(e.opponent && e.opponent.displayName),
          home: e.atVs === 'vs', date: Date.parse(e.gameDate) || 0, competition: str(e.leagueName || e.leagueAbbreviation) };
      }) };
    }).filter(function (t) { return t.games.length; });
  }
  function table(d, teams) {
    var groups = list(d.standings && d.standings.groups);
    var names = teams.map(function (t) { return t.name; });
    // The group both teams are in, else the first.
    var group = groups.filter(function (g) {
      return list(g.standings && g.standings.entries).some(function (e) { return names.indexOf(str(e.team)) >= 0; });
    })[0] || groups[0];
    if (!group) return null;
    var rows = list(group.standings && group.standings.entries).map(function (e) {
      var s = {};
      list(e.stats).forEach(function (x) { s[x.abbreviation || x.name] = str(x.displayValue); });
      return { rank: Number(s.R) || 0, team: str(e.team), played: s.GP || '', won: s.W || '', drawn: s.D || '', lost: s.L || '',
        diff: s.GD || '', points: s.P || '', mine: names.indexOf(str(e.team)) >= 0 };
    }).sort(function (a, b) { return a.rank - b.rank; });
    if (!rows.length) return null;
    // Long tables (36-team league phases) show the top and the rows around both teams.
    if (rows.length > 12) rows = rows.filter(function (r, i) {
      return i < 4 || rows.some(function (m, j) { return m.mine && Math.abs(i - j) <= 1; });
    });
    return { title: str(group.header) || str(d.standings.header) || 'Table', rows: rows };
  }
  function videos(d) {
    return list(d.videos).map(function (v) {
      var src = (v.links && v.links.source) || {};
      var url = https((src.HD && src.HD.href) || (src.mezzanine && src.mezzanine.href) || src.href);
      return url ? { id: 'espn-video:' + v.id, title: str(v.headline), thumb: sized(v.thumbnail, 480, 270), url: url,
        duration: Number(v.duration) || 0 } : null;
    }).filter(Boolean);
  }
  function scorecards(d) {
    return list(d.matchcards).map(function (m) {
      var bat = m.headline === 'Batting', bowl = m.headline === 'Bowling';
      if (!bat && !bowl) return null;
      return { kind: bat ? 'batting' : 'bowling', team: str(m.teamName), innings: Number(m.inningsNumber) || 0,
        total: bat ? str(m.runs) + ' ' + str(m.total) : '', extras: bat ? str(m.extras) : '',
        rows: list(m.playerDetails).map(function (p) {
          return bat ? { name: str(p.playerName), out: str(p.dismissal), runs: str(p.runs), balls: str(p.ballsFaced), fours: str(p.fours), sixes: str(p.sixes) }
            : { name: str(p.playerName), overs: str(p.overs), maidens: str(p.maidens), runs: str(p.conceded), wickets: str(p.wickets), economy: str(p.economyRate) };
        }).filter(function (r) { return r.name; }) };
    }).filter(Boolean).map(function (card) {
      // Batters with no runs and no balls didn't bat: one line under the card, not empty rows.
      if (card.kind !== 'batting') return card;
      card.didNotBat = card.rows.filter(function (r) { return !r.runs && !r.balls; }).map(function (r) { return r.name; });
      card.rows = card.rows.filter(function (r) { return r.runs || r.balls; });
      return card;
    });
  }
  function normalize(d, r) {
    var football = r.sport === 'soccer';
    var comp = list(d.header && d.header.competitions)[0] || {};
    var type = (comp.status && comp.status.type) || {};
    var teams = list(comp.competitors).map(function (c) { return team(c, football); });
    teams.sort(football ? function (a, b) { return (a.home ? 0 : 1) - (b.home ? 0 : 1); } : function (a, b) { return a.order - b.order; });
    var venue = (d.gameInfo && d.gameInfo.venue) || {};
    var address = venue.address || {};
    var notes = list(d.notes).filter(function (n) { return /^(toss|points|matchdays|player of the match|series)$/i.test(str(n.type)) || /player of the match/i.test(str(n.text)); });
    return {
      ref: r, sport: sportName(r.sport), football: football,
      competition: str(d.header && d.header.league && d.header.league.name) || str(comp.description),
      round: str(comp.description) || str(list(comp.notes)[0] && list(comp.notes)[0].headline),
      state: str(type.state) || 'pre', detail: str(type.shortDetail) || str(type.detail),
      clock: type.state === 'in' ? str(comp.status && comp.status.displayClock) : '',
      summary: str(comp.status && comp.status.summary) || '',
      startsAt: Date.parse(comp.date) || 0,
      venue: str(venue.fullName) + (address.city && str(venue.fullName).indexOf(address.city) < 0 ? ', ' + address.city : ''),
      attendance: Number(d.gameInfo && d.gameInfo.attendance) || 0,
      teams: teams, events: football ? timeline(d, teams) : [], stats: football ? stats(d, teams) : [],
      lineups: football ? lineups(d, teams) : [], form: form(d), table: table(d, teams), videos: videos(d),
      scorecards: football ? [] : scorecards(d),
      notes: notes.map(function (n) { return (str(n.type) ? str(n.type).replace(/^\w/, function (c) { return c.toUpperCase(); }) + ': ' : '') + str(n.text); })
    };
  }
  function match(value) {
    var r = ref(value);
    if (!r) return Promise.reject(new Error('No match details for this listing'));
    return getJson(SITE + r.sport + '/' + encodeURIComponent(r.league) + '/summary?event=' + r.event).then(function (d) {
      if (!d || !d.header) throw new Error('No match details');
      return normalize(d, r);
    });
  }

  // A team's next (or current) game: football from the team's schedule, cricket from its league's season board.
  function teamNext(espnSport, league, teamId, now) {
    if (!/^(soccer|cricket)$/.test(espnSport) || !/^[\w.]+$/.test(str(league)) || !/^\d+$/.test(str(teamId))) return Promise.reject(new Error('No team'));
    var url = SITE + espnSport + '/' + league + (espnSport === 'soccer' ? '/teams/' + teamId + '/schedule?fixture=true'
      : '/scoreboard?dates=' + new Date(now).getUTCFullYear());
    return getJson(url).then(function (d) {
      var next = list(d.events).map(function (e) {
        var c = list(e.competitions)[0] || {}, type = ((c.status || e.status || {}).type) || {};
        var teams = list(c.competitors).map(function (t) {
          var team = t.team || {};
          return { id: str(team.id), displayName: team.displayName, abbreviation: team.abbreviation, homeAway: t.homeAway, order: t.order,
            logo: darkLogo(team.logos) || team.logo, score: '' };
        });
        if (!teams.some(function (t) { return t.id === str(teamId); })) return null;
        return fixture(espnSport, { slug: league, name: str(d.leagues && d.leagues[0] && d.leagues[0].name), abbreviation: '' },
          { id: e.id, date: e.date, status: type.state, competitors: teams, fullStatus: { type: type }, location: str(c.venue && c.venue.fullName), title: str(c.description) });
      }).filter(function (f) { return f && (f.state === 'pre' || f.state === 'in'); }).sort(function (a, b) { return a.startsAt - b.startsAt; })[0];
      return next || null;
    });
  }

  var api = { ref: ref, teamNext: teamNext, useService: useService, sized: sized, fixtures: fixtures, parseBoard: parseBoard, standings: standings, readStandings: readStandings,
    match: match, normalize: normalize, NEPAL_LEAGUE: NEPAL_LEAGUE, FOOTBALL: FOOTBALL };
  root.Espn = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
