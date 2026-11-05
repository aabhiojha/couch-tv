// Espn: fixtures, tables and match normalization from trimmed ESPN payloads.
const assert = require('assert');
const Espn = require('../web/js/espn.js');

// A football summary, cut down to what normalize reads.
const football = {
  header: { league: { name: 'UEFA Champions League' }, competitions: [{ date: '2026-10-21T16:45Z', description: '',
    status: { type: { state: 'post', shortDetail: 'FT' } },
    competitors: [
      { homeAway: 'away', winner: false, score: '1', team: { id: '360', displayName: 'Manchester United', abbreviation: 'MAN', color: 'da020e', logos: [{ href: 'https://a/mu.png' }] } },
      { homeAway: 'home', winner: true, score: '4', team: { id: '2572', displayName: 'Como', abbreviation: 'COMO', color: '4169E1', logos: [{ href: 'https://a/como.png' }] } }] }] },
  gameInfo: { venue: { fullName: 'Giuseppe Sinigaglia', address: { city: 'Como' } }, attendance: 10875 },
  keyEvents: [
    { type: { text: 'Kickoff' } },
    { type: { text: 'Goal' }, clock: { displayValue: "2'" }, team: { id: '2572' }, participants: [{ athlete: { displayName: 'Nico Paz' } }, { athlete: { displayName: 'Lucas Da Cunha' } }] },
    { type: { text: 'Substitution' }, clock: { displayValue: "45'" }, team: { id: '360' }, participants: [{ athlete: { displayName: 'Amad Diallo' } }, { athlete: { displayName: 'Matheus Cunha' } }] }],
  boxscore: { teams: [
    { team: { id: '360' }, statistics: [{ name: 'possessionPct', displayValue: '45.2' }, { name: 'totalShots', displayValue: '13' }, { name: 'redCards', displayValue: '0' }] },
    { team: { id: '2572' }, statistics: [{ name: 'possessionPct', displayValue: '54.8' }, { name: 'totalShots', displayValue: '11' }, { name: 'redCards', displayValue: '0' }] }] },
  rosters: [{ team: { id: '2572', displayName: 'Como' }, formation: '4-2-3-1', roster: [
    { starter: true, jersey: '10', formationPlace: '10', athlete: { displayName: 'Nico Paz' }, position: { abbreviation: 'AM' } },
    { starter: true, jersey: '1', formationPlace: '1', athlete: { displayName: 'Jean Butez' }, position: { abbreviation: 'G' } },
    { starter: false, subbedIn: true, jersey: '19', athlete: { displayName: 'Kaiki' } }] }],
  lastFiveGames: [{ team: { displayName: 'Como' }, events: [{ gameResult: 'W', score: '2-1', atVs: 'vs', opponent: { displayName: 'Parma' } }] }],
  standings: { groups: [{ header: 'Table', standings: { entries: [
    { team: 'Como', stats: [{ abbreviation: 'R', displayValue: '2' }, { abbreviation: 'P', displayValue: '6' }] },
    { team: 'PSG', stats: [{ abbreviation: 'R', displayValue: '1' }, { abbreviation: 'P', displayValue: '12' }] }] } }] },
  videos: [{ id: 5, headline: 'Highlights', thumbnail: 'https://a/t.jpg', duration: 81, links: { source: { HD: { href: 'https://a/v.mp4' } } } },
    { id: 6, headline: 'No source', links: { source: {} } }]
};

const m = Espn.normalize(football, { sport: 'soccer', league: 'uefa.champions', event: '401915395' });
assert.deepStrictEqual(m.teams.map(t => [t.name, t.score, t.home, t.winner, t.color]),
  [['Como', '4', true, true, '#4169E1'], ['Manchester United', '1', false, false, '#da020e']]); // home team first
assert.strictEqual(m.venue, 'Giuseppe Sinigaglia, Como');
assert.deepStrictEqual(m.events.map(e => [e.minute, e.kind, e.side, e.player, e.detail]),
  [["2'", 'goal', 0, 'Nico Paz', 'Assist: Lucas Da Cunha'], ["45'", 'sub', 1, 'Amad Diallo', 'for Matheus Cunha']]); // kickoff dropped
assert.deepStrictEqual(m.stats, [{ label: 'Possession', home: 54.8, away: 45.2, unit: '%' }, { label: 'Shots', home: 11, away: 13, unit: '' }]); // 0–0 rows dropped
assert.deepStrictEqual(m.lineups[0].starters.map(p => p.name), ['Jean Butez', 'Nico Paz']); // by formation place
assert.strictEqual(m.lineups[0].bench[0].on, true);
assert.deepStrictEqual(m.table.rows.map(r => [r.rank, r.team, r.mine]), [[1, 'PSG', false], [2, 'Como', true]]);
assert.deepStrictEqual(m.videos.map(v => v.url), ['https://a/v.mp4']);

// A cricket summary: innings per side, batters who didn't bat grouped, notes kept.
const cricket = {
  header: { league: { name: 'India tour of New Zealand' }, competitions: [{ description: '1st ODI', date: '2026-11-04T01:00Z',
    status: { summary: 'India won by 5 wkts', type: { state: 'post', detail: 'Final' } },
    competitors: [
      { order: 2, winner: true, score: '143/5', team: { displayName: 'India' }, linescores: [{ runs: 0, wickets: 0 }, { runs: 143, wickets: 5, overs: 22.4 }] },
      { order: 1, winner: false, score: '185', team: { displayName: 'New Zealand' }, linescores: [{ runs: 185, wickets: 10, overs: 40.2 }] }] }] },
  matchcards: [{ headline: 'Batting', teamName: 'India', runs: '143', total: '(5 wkts)', playerDetails: [
    { playerName: 'V Kohli', runs: '74', ballsFaced: '51', dismissal: 'caught' }, { playerName: 'Arshdeep Singh', runs: '', ballsFaced: '' }] },
    { headline: 'Partnerships', playerDetails: [] }],
  notes: [{ type: 'toss', text: 'India, elected to field first' }, { type: 'matchnote', text: 'Powerplay 1' }]
};
const c = Espn.normalize(cricket, { sport: 'cricket', league: '24000', event: '1539437' });
assert.deepStrictEqual(c.teams.map(t => [t.name, t.innings]), [['New Zealand', [{ runs: 185, wickets: 10, overs: '40.2' }]],
  ['India', [{ runs: 143, wickets: 5, overs: '22.4' }]]]); // batting order; the empty innings dropped
assert.strictEqual(c.summary, 'India won by 5 wkts');
assert.deepStrictEqual(c.scorecards.map(s => [s.kind, s.rows.map(r => r.name), s.didNotBat]), [['batting', ['V Kohli'], ['Arshdeep Singh']]]);
assert.deepStrictEqual(c.notes, ['Toss: India, elected to field first']);

// Fixtures: a board's games in our competitions; football home side first, postponed games marked off.
const team = (side, name, abbr, score, extra) => Object.assign({ homeAway: side, displayName: name, abbreviation: abbr, score: score,
  logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/1.png', logoDark: 'https://a.espncdn.com/i/teamlogos/soccer/500-dark/1.png' }, extra);
const board = { sports: [{ leagues: [
  { slug: 'eng.1', name: 'English Premier League', abbreviation: 'Premier League', events: [
    { id: '9', status: 'post', date: '2026-11-01T16:30Z', location: 'Anfield', broadcast: 'Peacock', fullStatus: { type: { completed: true, shortDetail: 'FT' } },
      competitors: [team('away', 'Arsenal', 'ARS', '2', { winner: true }), team('home', 'Liverpool', 'LIV', '1')] },
    { id: '10', status: 'post', date: '2026-11-01T19:00Z', fullStatus: { type: { completed: false, description: 'Postponed' } },
      competitors: [team('home', 'Everton', 'EVE', ''), team('away', 'Fulham', 'FUL', '')] }] },
  { slug: 'xyz.9', name: 'Somewhere Else', events: [{ id: '11', status: 'pre', date: '2026-11-01T12:00Z', competitors: [team('home', 'A', 'A', ''), team('away', 'B', 'B', '')] }] }] }] };
const games = Espn.parseBoard('soccer', board);
assert.deepStrictEqual(games.map(g => g.id), ['espn:9', 'espn:10']);
assert.strictEqual(games[0].title, 'Liverpool vs Arsenal');
assert.strictEqual(games[0].competition, 'Premier League');
assert.strictEqual(games[0].state, 'post');
assert.strictEqual(games[0].teams[1].winner, true);
assert.ok(/500-dark/.test(decodeURIComponent(games[0].teams[0].logo)), 'dark-background crests');
assert.deepStrictEqual(games[0].espn, { sport: 'soccer', league: 'eng.1', event: '9' });
assert.strictEqual(games[1].state, 'off');
assert.strictEqual(games[1].detail, 'Postponed');

// Cricket: domestic first-class competitions are left out; Nepal's league and tours stay; "(NPL)" suffixes go.
const cricketBoard = { sports: [{ leagues: [
  { id: '23081', slug: '23081', name: 'Nepal Premier League', events: [{ id: '1', status: 'pre', date: '2026-11-05T06:45Z', title: '14th Match',
    competitors: [{ displayName: 'Janakpur Bolts (NPL)', abbreviation: 'JAB', order: 1 }, { displayName: 'Lumbini Lions (NPL)', abbreviation: 'LUL', order: 2 }] }] },
  { id: '8050', slug: '8050', name: 'Ranji Trophy', events: [{ id: '2', status: 'in', date: '2026-11-05T04:00Z',
    competitors: [{ displayName: 'Delhi' }, { displayName: 'Assam' }] }] },
  { id: '24707', slug: '24707', name: 'Sri Lanka tour of Pakistan 2026/27', events: [{ id: '3', status: 'in', date: '2026-11-04T05:00Z',
    fullStatus: { summary: 'PCB XI trail by 180 runs' }, competitors: [{ displayName: 'Sri Lanka', score: '223/7d', order: 1 }, { displayName: 'PCB XI', score: '43/2 (15 ov)', order: 2 }] }] }] }] };
const npl = Espn.parseBoard('cricket', cricketBoard);
assert.deepStrictEqual(npl.map(g => g.id), ['espn:1', 'espn:3']);
assert.strictEqual(npl[0].title, 'Janakpur Bolts vs Lumbini Lions');
assert.strictEqual(npl[0].round, '14th Match');
assert.strictEqual(npl[1].competition, 'Sri Lanka tour of Pakistan');
assert.strictEqual(npl[1].summary, 'PCB XI trail by 180 runs');

// Tables: rows in rank order with the right columns per sport.
const table = Espn.readStandings('cricket', { name: 'Nepal Premier League', children: [{ name: '', standings: { entries: [
  { team: { id: '2', displayName: 'Biratnagar Kings (NPL)' }, stats: [{ abbreviation: 'R', displayValue: '2' }, { abbreviation: 'M', displayValue: '4' }, { abbreviation: 'PT', displayValue: '4' }, { abbreviation: 'NRR', displayValue: '0.408' }] },
  { team: { id: '1', displayName: 'Lumbini Lions (NPL)' }, stats: [{ abbreviation: 'R', displayValue: '1' }, { abbreviation: 'M', displayValue: '3' }, { abbreviation: 'PT', displayValue: '5' }] }] } }] });
assert.deepStrictEqual(table.groups[0].rows.map(r => [r.rank, r.team, r.points]), [[1, 'Lumbini Lions', '5'], [2, 'Biratnagar Kings', '4']]);
assert.strictEqual(table.groups[0].rows[1].diff, '0.408');
assert.strictEqual(table.columns[4], 'NRR');
assert.throws(() => Espn.readStandings('soccer', { children: [] }));
assert.strictEqual(Espn.ref({ sport: 'soccer', league: 'eng.1', event: 'x' }), null);
console.log('ok (espn)');
