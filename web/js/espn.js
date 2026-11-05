// Match details and results from ESPN's public APIs (no key; CORS open), for the match page and Sports › Results.
// ESPN's own field names stay in here; screens get the plain shapes below.
(function (root) {
  'use strict';
  var SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
  var HEADER = 'https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=';
  // Football results come from these competitions only (a day lists ~75 games worldwide); cricket lists them all.
  var FOOTBALL = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
    'eng.fa', 'eng.league_cup', 'esp.copa_del_rey', 'ind.1', 'fifa.world', 'fifa.worldq.afc', 'fifa.worldq.uefa',
    'uefa.nations', 'uefa.euro', 'conmebol.america', 'afc.asian.cup', 'usa.1', 'ksa.1', 'por.1', 'ned.1'];

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

  // ---- Results: finished games of the last few days, newest first, as Sports cards ----
  function resultCard(espnSport, league, e) {
    var teams = list(e.competitors);
    var status = e.fullStatus || {};
    // Postponed and cancelled games are "post" too, but never finished.
    if (e.status !== 'post' || teams.length !== 2 || (status.type && status.type.completed === false)) return null;
    var football = espnSport === 'soccer';
    var ordered = football
      ? teams.slice().sort(function (a, b) { return (a.homeAway === 'home' ? 0 : 1) - (b.homeAway === 'home' ? 0 : 1); })
      : teams.slice().sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
    var line = football
      ? str(ordered[0].abbreviation) + ' ' + str(ordered[0].score) + ' – ' + str(ordered[1].score) + ' ' + str(ordered[1].abbreviation)
      : ordered.filter(function (t) { return str(t.score); }).map(function (t) { return str(t.abbreviation) + ' ' + str(t.score); }).join(' · ');
    return {
      id: 'espn:' + e.id, kind: 'result', title: str(ordered[0].displayName) + ' vs ' + str(ordered[1].displayName),
      sport: sportName(espnSport), startsAt: Date.parse(e.date) || 0, endsAt: 0, streams: [],
      competition: str(league.name), crests: ordered.map(function (t) { return sized(t.logo, 160, 160); }),
      score: { state: 'post', line: line, summary: str(status.summary) || str(e.summary), crests: [] },
      espn: { sport: espnSport, league: str(league.slug), event: str(e.id) }
    };
  }
  function resultsFor(espnSport, day) {
    return getJson(HEADER + espnSport + '&dates=' + ymd(day)).then(function (d) {
      var out = [];
      list(d.sports).forEach(function (s) {
        list(s.leagues).forEach(function (league) {
          if (espnSport === 'soccer' && FOOTBALL.indexOf(league.slug) < 0) return;
          list(league.events).forEach(function (e) {
            var card = resultCard(espnSport, league, e);
            if (card && card.espn.league) out.push(card);
          });
        });
      });
      return out;
    });
  }
  // days: how many days back, today included. A board that fails is left out; all failing rejects.
  function results(now, days) {
    var asks = [];
    for (var i = 0; i < (days || 3); i++) {
      var day = new Date(now - i * 86400000);
      asks.push(resultsFor('soccer', day), resultsFor('cricket', day));
    }
    return Promise.all(asks.map(function (p) { return p.then(function (r) { return { ok: true, r: r }; }, function () { return { ok: false }; }); }))
      .then(function (all) {
        if (!all.some(function (a) { return a.ok; })) throw new Error('Results unavailable');
        var seen = {}, out = [];
        all.forEach(function (a) {
          (a.r || []).forEach(function (card) { if (!seen[card.id]) { seen[card.id] = true; out.push(card); } });
        });
        return out.sort(function (a, b) { return b.startsAt - a.startsAt; });
      });
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
    return { id: str(t.id), name: str(t.displayName), short: str(t.abbreviation), color: /^[0-9a-f]{6}$/i.test(str(t.color)) ? '#' + t.color : '',
      logo: sized(logos.length ? logos[0].href : t.logo, 200, 200), score: str(c.score), winner: c.winner === true || c.winner === 'true',
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

  var api = { ref: ref, sized: sized, results: results, match: match, normalize: normalize, resultCard: resultCard };
  root.Espn = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
