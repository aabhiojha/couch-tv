#!/usr/bin/env python3
"""Live sports relay for Couch TV.

Serves PPV and Streamed schedules at /sports.json and the legacy PPV playlist at /live.m3u. A channel is
resolved when it is played: headless Chrome opens its embed page (tools/live-sniff.mjs) and the HLS
playlist it requests is relayed with the Referer its CDN requires, which the TV's player can't send.
Python, not Node: the CDN rejects Node's TLS handshake (403) and accepts OpenSSL's.

Usage: python3 tools/live-relay.py [port]        (default 8790)
Then in secrets.js: playlists: ['http://192.168.1.34:8790/live.m3u']
"""
import base64
import concurrent.futures
import hashlib
import http.client
import ipaddress
import json
import os
import queue
import re
import socket
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
API = 'https://api.ppv.st/api/streams'
STREAMED = 'https://streamed.pk'
SNIFF = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live-sniff.mjs')
# ponytail: this machine and the home network only (an open relay otherwise); change it when hosting elsewhere.
ALLOWED = re.compile(r'^(127\.0\.0\.1|192\.168\.1\.\d+)$')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
streams = {}   # PPV stream id -> stream (its embed page is 'iframe'), refreshed with every playlist load
resolved = {}  # PPV stream id -> (time, {url, referer, origin}) from the sniffer
lock = threading.Lock()
catalog_lock = threading.Lock()
catalogs = {}
segments = {}
segment_lock = threading.Lock()


def language(value):
    name = str(value or '').strip().lower().replace('_', '-').split('-')[0]
    return {'english': 'en', 'hindi': 'hi', 'nepali': 'ne', 'eng': 'en', 'hin': 'hi', 'nep': 'ne'}.get(name, name)


SPORTS = ('Cricket', 'Football')  # association football; the household watches only these


def sport_name(value):
    name = str(value or 'Other').replace('-', ' ').strip().title()
    return {'Soccer': 'Football', 'Motor Sports': 'Motorsport', 'Fight': 'Combat sports'}.get(name, name)


def web_url(value):
    try:
        url = urllib.parse.urlsplit(str(value or ''))
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.hostname == 'localhost':
            return ''
        try:
            if not ipaddress.ip_address(url.hostname).is_global:
                return ''
        except ValueError:
            if url.hostname.endswith(('.local', '.localhost')):
                return ''
        return str(value)
    except ValueError:
        return ''


def normalize_ppv(data):
    if not isinstance(data, dict) or not isinstance(data.get('streams'), list):
        raise ValueError('Invalid PPV schedule')
    items, refs = [], {}
    for category in data['streams']:
        if not isinstance(category, dict) or not isinstance(category.get('streams'), list):
            raise ValueError('Invalid PPV category')
        for item in category['streams']:
            if not isinstance(item, dict) or not item.get('name'):
                continue
            feeds = []
            for feed in [item] + (item.get('substreams') or []):
                if not isinstance(feed, dict):
                    continue
                sid = str(feed.get('id', ''))
                if not sid.isdigit() or not web_url(feed.get('iframe')):
                    continue
                refs[sid] = dict(feed, provider='PPV')
                feeds.append({'id': sid, 'label': 'PPV · ' + str(feed.get('source_tag') or 'Main'),
                              'language': language(feed.get('locale'))})
            if not feeds:
                continue
            channel = item.get('always_live') in (True, 1, '1')
            try:
                start, end = float(item.get('starts_at') or 0), float(item.get('ends_at') or 0)
            except (ValueError, TypeError):
                continue
            if not channel and not (0 < start < end < 1e11):
                continue
            items.append({'id': 'ppv:' + str(item.get('id')), 'title': str(item['name']),
                          'kind': 'channel' if channel else 'event', 'sport': sport_name(category.get('category')),
                          'thumb': web_url(item.get('poster')), 'startsAt': 0 if channel else start * 1000,
                          'endsAt': 0 if channel else end * 1000, 'streams': feeds})
    return items, refs


def normalize_streamed(data):
    if not isinstance(data, list):
        raise ValueError('Invalid Streamed schedule')
    items, refs = [], {}
    for item in data:
        if not isinstance(item, dict) or not item.get('id') or not item.get('title'):
            continue
        feeds = []
        for source in item.get('sources') or []:
            if not isinstance(source, dict) or not source.get('source') or not source.get('id'):
                continue
            name, match = str(source['source']), str(source['id'])
            sid = 's-' + hashlib.sha256((name + ':' + match).encode()).hexdigest()[:20]
            refs[sid] = {'provider': 'Streamed', 'source': name, 'match': match}
            feeds.append({'id': sid, 'label': 'Streamed · ' + name.title(), 'language': ''})
        try:
            start = float(item.get('date') or 0)
        except (ValueError, TypeError):
            continue
        if not feeds or not 0 <= start < 1e14:
            continue
        # Streamed uses date=0 for its always-on catalog; positive dates are event starts, not end times.
        thumb = str(item.get('poster') or '')
        if thumb.startswith('/'):
            thumb = STREAMED + thumb
        items.append({'id': 'streamed:' + str(item['id']), 'title': str(item['title']),
                      'kind': 'event' if start else 'channel',
                      'sport': 'Ice Hockey' if item.get('category') == 'hockey' else sport_name(item.get('category')),
                      'thumb': web_url(thumb), 'startsAt': start, 'endsAt': 0, 'streams': feeds})
    return items, refs


# Club-type words that one provider writes and another drops ("IF Elfsborg" / "Elfsborg").
FILLER = {'fc', 'cf', 'sc', 'if', 'bk', 'ac', 'as', 'afc', 'cd', 'sk', 'club', 'the'}


def title_sides(title):
    sides = re.split(r'\s+(?:vs?\.?|versus|at|@)\s+', title.lower())
    return [frozenset(re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', side).encode('ascii', 'ignore')
                             .decode()).split()) - FILLER for side in sides]


def same_side(a, b):
    return bool(a and b) and (a <= b or b <= a)


def same_event(a, b):
    """Two providers' listings of one match: same sport, starts within 5 minutes, and matching opponents
    ("Caykur Rizespor vs. Trabzonspor" / "Rizespor vs Trabzonspor") or the same specific single title."""
    if not (a['kind'] == b['kind'] == 'event' and a['sport'] == b['sport']
            and a['id'].split(':')[0] != b['id'].split(':')[0] and abs(a['startsAt'] - b['startsAt']) <= 5 * 60000):
        return False
    left, right = title_sides(a['title']), title_sides(b['title'])
    if len(left) == len(right) == 2:
        return (same_side(left[0], right[0]) and same_side(left[1], right[1])) or \
            (same_side(left[0], right[1]) and same_side(left[1], right[0]))
    # A single title must name the event itself; "Cricket tournament" is too generic to identify one.
    return len(left) == len(right) == 1 and left == right and len(left[0] - {a['sport'].lower()}) >= 2 and \
        not left[0] <= {'cricket', 'football', 'soccer', 'tournament', 'match', 'live', 'league', 'cup'}


def merge_events(items):
    result = []
    for item in items:
        found = next((old for old in result if same_event(item, old)), None)
        if found:
            known = {feed['id'] for feed in found['streams']}
            found['streams'].extend(feed for feed in item['streams'] if feed['id'] not in known)
            found['thumb'] = found['thumb'] or item['thumb']
            found['endsAt'] = found['endsAt'] or item['endsAt']
        else:
            result.append(dict(item, streams=list(item['streams'])))
    return result


def sports_catalog(host):
    now = time.time()
    loaders = [('PPV', API, normalize_ppv), ('Streamed', STREAMED + '/api/matches/all', normalize_streamed)]
    with catalog_lock:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [(name, pool.submit(lambda url=url, normalize=normalize: normalize(json.load(get(url)))))
                    for name, url, normalize in loaders if now - catalogs.get(name, {}).get('attempted', 0) >= 60]
            for name, job in jobs:
                old = catalogs.get(name, {})
                try:
                    items, refs = job.result()
                    streams.update(refs)
                    catalogs[name] = {'items': items, 'updatedAt': now * 1000, 'attempted': now, 'error': False}
                except Exception:
                    catalogs[name] = dict(old, attempted=now, error=True)
        items, providers = [], []
        for name, url, normalize in loaders:
            entry = catalogs.get(name, {})
            usable = 'items' in entry and now * 1000 - entry['updatedAt'] <= 6 * 3600000
            if usable:
                items.extend(entry['items'])
            providers.append({'name': name, 'updatedAt': entry.get('updatedAt', 0),
                              'status': 'unavailable' if not usable else 'stale' if entry.get('error') else 'ok'})
        if all(provider['status'] == 'unavailable' for provider in providers):
            raise LookupError('Sports schedules unavailable')
        merged = merge_events([item for item in items if item['sport'] in SPORTS])
        return {'items': [dict(item, streams=[dict(feed, url='http://%s/play/%s.m3u8' % (host, feed['id']))
                                             for feed in item['streams']]) for item in merged], 'providers': providers}


def get(url, headers=None, timeout=15):
    if not web_url(url):
        raise ValueError('Invalid upstream URL')
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})}), timeout=timeout)


class Media:
    def __init__(self, body, url):
        self.body, self.url = body, url

    def read(self):
        return self.body

    def geturl(self):
        return self.url


# The media hosts drop many new connections' SYNs, so a fresh TCP connect often takes 4 or 11 s, longer than a
# segment lasts. Media requests therefore reuse kept-alive connections per host, and a new connection races six
# staggered connects, keeping the first to complete, rather than waiting out the kernel's SYN retries.
idle = {}  # (scheme, host, port) -> idle HTTP(S) connections
idle_lock = threading.Lock()


def race_connect(address, timeout=None, source_address=None, tries=6):
    results = queue.Queue()

    def attempt(delay):
        time.sleep(delay)
        try:
            results.put(socket.create_connection(address, 12))
        except OSError as e:
            results.put(e)

    def close_losers(left):
        for _ in range(left):
            loser = results.get()
            if isinstance(loser, socket.socket):
                loser.close()
    for i in range(tries):
        threading.Thread(target=attempt, args=(i * 0.2,), daemon=True).start()
    error = None
    for i in range(tries):
        result = results.get()
        if isinstance(result, socket.socket):
            threading.Thread(target=close_losers, args=(tries - i - 1,), daemon=True).start()
            result.settimeout(timeout)
            return result
        error = result
    raise error


def connection(parts):
    key = (parts.scheme, parts.hostname, parts.port)
    with idle_lock:
        if idle.get(key):
            return key, idle[key].pop(), True
    kind = http.client.HTTPSConnection if parts.scheme == 'https' else http.client.HTTPConnection
    conn = kind(parts.hostname, parts.port, timeout=15)
    conn._create_connection = race_connect
    try:
        conn.connect()
    except OSError:
        conn.close()
        raise
    return key, conn, False


def get_media(url, info, redirects=3):
    """A playlist or segment request with the stream's headers, over a kept-alive connection."""
    headers = {'User-Agent': UA, 'Referer': info['referer'], 'Origin': info['origin']}
    for hop in range(redirects + 1):
        if not web_url(url):
            raise ValueError('Invalid upstream URL')
        parts = urllib.parse.urlsplit(url)
        path = (parts.path or '/') + ('?' + parts.query if parts.query else '')
        for retry in (True, False):
            key, conn, reused = connection(parts)
            try:
                conn.request('GET', path, headers=headers)
                res = conn.getresponse()
                body = res.read()
                break
            except (http.client.HTTPException, OSError):
                conn.close()
                if not (reused and retry):  # a kept-alive connection the server has since closed: once more
                    raise
        if res.will_close:
            conn.close()
        else:
            with idle_lock:
                if len(idle.setdefault(key, [])) < 8:
                    idle[key].append(conn)
                else:
                    conn.close()
        if res.status in (301, 302, 303, 307, 308) and res.getheader('Location'):
            url = urllib.parse.urljoin(url, res.getheader('Location'))
            continue
        if res.status >= 400:
            raise urllib.error.HTTPError(url, res.status, res.reason, res.headers, None)
        return Media(body, url)
    raise LookupError('Too many redirects')


def playlist(host):
    """Events from 15 minutes before their start until their end, and the always-on channels."""
    now, lines = time.time(), ['#EXTM3U']
    for category in json.load(get(API))['streams']:
        if sport_name(category.get('category')) not in SPORTS:
            continue
        for s in category['streams']:
            if not (s['always_live'] or s['starts_at'] - 900 <= now <= s['ends_at']):
                continue
            # Alternate feeds (another broadcaster, the away feed) share the name; the app lists them as streams.
            for feed in [s] + s.get('substreams', []):
                streams[str(feed['id'])] = feed
                lines.append('#EXTINF:-1 tvg-logo="%s" group-title="%s" couch-source="PPV · %s",%s' % (
                    s['poster'], category['category'], feed.get('source_tag') or 'Main', s['name']))
                lines.append('http://%s/play/%s.m3u8' % (host, feed['id']))
    return '\n'.join(lines) + '\n'


def resolve(sid, fresh=False):
    asked = time.time()
    hit = resolved.get(sid)
    if hit and not fresh and asked - hit[0] < 1800:
        return hit[1]
    # One sniff at a time; a request that waited reuses a sniff of its channel that finished meanwhile.
    with lock:
        hit = resolved.get(sid)
        if hit and hit[0] >= asked:
            return hit[1]
        if sid not in streams:  # the relay restarted since the TV loaded the playlist
            sports_catalog('localhost:%d' % PORT)
        feed = streams.get(sid)
        if not feed:
            raise LookupError('Source no longer listed; refresh Sports')
        embed, referer = feed.get('iframe'), 'https://ppv.st/'
        if feed.get('provider') == 'Streamed':
            path = '/api/stream/%s/%s' % tuple(urllib.parse.quote(feed[key], safe='') for key in ('source', 'match'))
            choices = json.load(get(STREAMED + path))
            if not isinstance(choices, list):
                raise LookupError('Invalid source response')
            choices = [choice for choice in choices if isinstance(choice, dict) and web_url(choice.get('embedUrl'))
                       and language(choice.get('language')) in ('en', 'hi', 'ne', '')]
            choices.sort(key=lambda choice: ('en', 'hi', 'ne', '').index(language(choice.get('language'))))
            embed = choices[0]['embedUrl'] if choices else ''
            referer = STREAMED + '/'
        if not web_url(embed):
            raise LookupError('No English, Hindi, Nepali or unspecified feed listed')
        out = subprocess.run(['node', SNIFF, embed, referer],
                             capture_output=True, text=True, timeout=40)
        if out.returncode:
            raise LookupError('No stream found for ' + sid)
        resolved[sid] = (time.time(), json.loads(out.stdout))
        return resolved[sid][1]


def rewrite(text, base, sid):
    """Points every URI in a playlist (segments, variants, keys, audio tracks) back at this relay.
    Players pick a parser by extension: a media playlist lists segments (.ts), a master lists playlists.
    The upstream URL goes in the path, since AVPlay drops the query string when it retries."""
    ext = 'ts' if '#EXTINF' in text else 'm3u8'
    urls = []

    def relayed(uri):
        target = urllib.parse.urljoin(base, uri)
        if not web_url(target):
            raise ValueError('Invalid media URL')
        urls.append(target)
        return '/seg/%s/%s.%s' % (sid, base64.urlsafe_b64encode(target.encode()).decode(), ext)
    result = '\n'.join(relayed(line) if line and not line.startswith('#') else
                       re.sub(r'URI="([^"]+)"', lambda m: 'URI="%s"' % relayed(m.group(1)), line)
                       for line in text.splitlines()) + '\n'
    # Only URLs actually advertised by this source may be fetched through the relay.
    now = time.time()
    with segment_lock:
        segments[sid] = {url: expiry for url, expiry in segments.get(sid, {}).items() if expiry > now}
        segments[sid].update((url, now + 3600) for url in urls)
    return result


def unwrap_ts(body):
    """PPV hides TS segments inside image files (a WebP's EXIF chunk on TikTok's CDN); cut the packets out."""
    i = body.find(b'G')
    while 0 <= i < 4096:
        if body[i + 188:i + 189] == b'G' and body[i + 376:i + 377] == b'G':
            return body[i:i + (len(body) - i) // 188 * 188]
        i = body.find(b'G', i + 1)
    return body


# The CDN sometimes takes 5-12 s to start answering a segment request, longer than a segment lasts. When a
# media playlist is served, its newest segments are fetched in the background, so the player's request for
# them is answered from memory. Each body is kept until it is served or for a minute.
prefetched = {}  # segment URL -> (time, future of the TS body)
prefetch_lock = threading.Lock()
prefetch_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)


def fetch_segment(url, info):
    return unwrap_ts(get_media(url, info).read())


def prefetch(text, base, info, count=3):
    urls = [urllib.parse.urljoin(base, line) for line in text.splitlines() if line and not line.startswith('#')]
    now = time.time()
    with prefetch_lock:
        for url in [url for url, (at, job) in prefetched.items() if now - at > 60]:
            del prefetched[url]
        for url in urls[-count:]:
            if url not in prefetched and web_url(url):
                prefetched[url] = (now, prefetch_pool.submit(fetch_segment, url, info))


def prefetched_segment(url):
    with prefetch_lock:
        hit = prefetched.pop(url, None)
    try:
        return hit[1].result(timeout=20) if hit else None
    except Exception:
        return None  # fetch it again in the request


class Relay(BaseHTTPRequestHandler):
    def do_GET(self):
        if not ALLOWED.match(self.client_address[0]):
            return self.send_error(403)
        path = self.path.partition('?')[0]
        try:
            if path == '/live.m3u':
                return self.reply(playlist(self.headers['Host']).encode(), 'audio/x-mpegurl')
            if path == '/sports.json':
                return self.reply(json.dumps(sports_catalog(self.headers['Host'])).encode(), 'application/json')
            m = re.fullmatch(r'/play/(\d+|s-[a-f0-9]{20})\.m3u8()', path) or re.fullmatch(r'/seg/(\d+|s-[a-f0-9]{20})/([\w=-]+)\.(?:ts|m3u8)', path)
            if not m:
                return self.send_error(404)
            self.relay(m[1], m[2] and base64.urlsafe_b64decode(m[2]).decode())
        except (BrokenPipeError, ConnectionResetError):
            pass  # the player stopped or switched channel mid-reply
        except PermissionError:
            self.send_error(403, 'Media URL is not listed by this source')
        except Exception as e:
            # The status or reason helps tell a dead feed from a slow CDN; URLs stay out of the log (signed paths).
            detail = getattr(e, 'code', None) or getattr(e, 'reason', None) or ''
            self.log_error('Live request failed: %s %s', type(e).__name__, str(detail)[:80])
            self.send_error(502, 'Could not load this feed. Try another source.')

    def relay(self, sid, url):
        if url:
            with segment_lock:
                if segments.get(sid, {}).get(url, 0) <= time.time():
                    raise PermissionError('Unlisted media URL')
        # Segments and sub-playlists only need the headers, never a fresh sniff (that would stall playback).
        info = resolved[sid][1] if url and sid in resolved else resolve(sid)
        body = url and prefetched_segment(url)
        if body:
            return self.reply(body, 'video/mp2t')
        try:
            res = get_media(url or info['url'], info)
        except urllib.error.HTTPError as e:
            if url or e.code not in (403, 404):
                raise
            info = resolve(sid, fresh=True)  # the playlist token expired: sniff a new one
            res = get_media(info['url'], info)
        body = res.read()
        if body.lstrip()[:7] == b'#EXTM3U':
            text = body.decode()
            self.reply(rewrite(text, res.geturl(), sid).encode(), 'application/vnd.apple.mpegurl')
            if '#EXTINF' in text:
                prefetch(text, res.geturl(), info)
        else:
            if not url:
                raise LookupError('Source did not return an HLS playlist')
            self.reply(unwrap_ts(body), 'video/mp2t')

    def log_request(self, code='-', size='-'):
        path = '/seg/[media]' if self.path.startswith('/seg/') else self.path.partition('?')[0]
        self.log_message('"%s %s" %s %s', self.command, path, code, size)

    def reply(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print('Live relay on port %d' % PORT, flush=True)
    ThreadingHTTPServer(('', PORT), Relay).serve_forever()
