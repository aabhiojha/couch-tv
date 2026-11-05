// Espn: results cards and match normalization from trimmed ESPN payloads.
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

// Results: finished games only; postponed ones are "post" but not completed.
const league = { name: 'English Premier League', slug: 'eng.1' };
const game = (status, completed) => ({ id: '9', status: status, date: '2026-11-01T16:30Z', fullStatus: { type: { completed: completed } },
  competitors: [{ homeAway: 'away', displayName: 'Arsenal', abbreviation: 'ARS', score: '2', logo: 'https://a/ars.png' },
    { homeAway: 'home', displayName: 'Liverpool', abbreviation: 'LIV', score: '1', logo: 'http://insecure' }] });
const card = Espn.resultCard('soccer', league, game('post', true));
assert.strictEqual(card.title, 'Liverpool vs Arsenal');
assert.strictEqual(card.score.line, 'LIV 1 – 2 ARS');
assert.deepStrictEqual(card.crests, ['', 'https://a/ars.png']);
assert.deepStrictEqual(card.espn, { sport: 'soccer', league: 'eng.1', event: '9' });
assert.strictEqual(Espn.resultCard('soccer', league, game('post', false)), null);
assert.strictEqual(Espn.resultCard('soccer', league, game('in', false)), null);
assert.strictEqual(Espn.ref({ sport: 'soccer', league: 'eng.1', event: 'x' }), null);
console.log('ok (espn)');
