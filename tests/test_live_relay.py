import base64
import importlib.util
import os
import io
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('relay', os.path.join(os.path.dirname(__file__), '../tools/live-relay.py'))
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)

# TS packets hidden in a WebP's EXIF chunk, with trailing bytes: only whole packets come back.
ts = b''.join(b'G' + bytes([i]) * 187 for i in range(3))
assert relay.unwrap_ts(b'RIFF\x00\x00WEBPVP8L.G.EXIF' + ts + b'tail') == ts
assert relay.unwrap_ts(ts) == ts
assert relay.unwrap_ts(b'not a segment') == b'not a segment'

def relayed(sid, url, ext):
    return '/seg/%s/%s.%s' % (sid, base64.urlsafe_b64encode(url.encode()).decode(), ext)


master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="a/en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv1/mono.m3u8\n'
assert relay.rewrite(master, 'https://cdn.example/s/index.m3u8', '7') == (
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="%s"\n#EXT-X-STREAM-INF:BANDWIDTH=1\n%s\n'
    % (relayed('7', 'https://cdn.example/s/a/en.m3u8', 'm3u8'), relayed('7', 'https://cdn.example/s/v1/mono.m3u8', 'm3u8')))
media = relay.rewrite('#EXTM3U\n#EXTINF:5,\nhttps://img.example/x.image?a=1\n', 'https://cdn.example/', '7')
assert media.splitlines()[2] == relayed('7', 'https://img.example/x.image?a=1', 'ts')

ppv = {'streams': [{'category': 'Basketball', 'streams': [
    {'id': 21, 'name': 'Lakers vs Celtics', 'starts_at': 100000, 'ends_at': 110000, 'iframe': 'https://embed.example/21'}]},
    {'category': 'Cricket', 'streams': [
    {'id': 11, 'name': 'Nepal vs India', 'poster': 'https://image.example/match.jpg',
     'starts_at': 100000, 'ends_at': 110000, 'always_live': 0, 'iframe': 'https://embed.example/11',
     'source_tag': 'Main', 'locale': 'en', 'substreams': [
         {'id': 12, 'iframe': 'https://embed.example/12', 'locale': 'hi', 'source_tag': 'Hindi'}]},
    {'id': 13, 'name': 'Sports channel', 'always_live': 1, 'iframe': 'https://embed.example/13', 'locale': 'ne'},
    {'id': 14, 'name': 'Invalid dates', 'starts_at': 'bad', 'iframe': 'https://embed.example/14'}
]}]}
items, refs = relay.normalize_ppv(ppv)
assert items[0]['sport'] == 'Basketball'  # normalized here, dropped from the catalog
items = items[1:]
assert len(items) == 2
assert items[0]['startsAt'] == 100000000
assert [s['language'] for s in items[0]['streams']] == ['en', 'hi']
assert items[1]['kind'] == 'channel' and items[1]['startsAt'] == 0
assert refs['12']['iframe'] == 'https://embed.example/12'

source_data = [{'id': 'match', 'title': 'India at Nepal', 'category': 'cricket', 'date': 100000000,
                'sources': [{'source': 'alpha', 'id': 'abc'}]},
               {'id': 'bad', 'title': 'Bad', 'date': 'no', 'sources': []}]
other, other_refs = relay.normalize_streamed(source_data)
assert other[0]['endsAt'] == 0
assert other[0]['streams'][0]['language'] == ''
assert other[0]['streams'][0]['id'] in other_refs
merged = relay.merge_events(items + other)
assert len(merged) == 2 and len(merged[0]['streams']) == 3
assert len(items[0]['streams']) == 2  # merging must not mutate cached provider records
later = dict(other[0], startsAt=other[0]['startsAt'] + 86400000)
assert len(relay.merge_events([items[0], later])) == 2
generic = dict(other[0], title='Cricket tournament')
assert len(relay.merge_events([generic, dict(generic)])) == 2
accented = dict(items[0], title='Beşiktaş vs İstanbul Başakşehir')
ascii_name = dict(other[0], title='Besiktas vs. Istanbul Basaksehir')
assert len(relay.merge_events([accented, ascii_name])) == 1
nepali = dict(items[0], title='नेपाल vs भारत')
assert len(relay.merge_events([nepali, dict(other[0], title='भुटान vs चीन')])) == 2
assert len(relay.merge_events([items[0], dict(items[0], id='ppv:99')])) == 2
# Real cross-provider duplicates: club words dropped, a shorter team name, a named single-title event.
def pair(a, b, sport='Football', single=False):
    base = {'kind': 'event', 'sport': sport, 'startsAt': 100000000, 'endsAt': 0, 'thumb': '', 'streams': []}
    return relay.merge_events([dict(base, id='ppv:1', title=a, streams=[{'id': '1'}]),
                               dict(base, id='streamed:2', title=b, streams=[{'id': '2'}])])
assert len(pair('Caykur Rizespor vs. Trabzonspor', 'Rizespor vs Trabzonspor')) == 1
assert len(pair('AIK vs. IF Elfsborg', 'AIK vs Elfsborg')) == 1
assert len(pair('AS Roma vs. Cagliari', 'Roma vs Cagliari')) == 1
assert len(pair('Trabzonspor vs Rizespor', 'Caykur Rizespor vs. Trabzonspor')) == 1
assert len(pair("2026 Ballon d'Or Ceremony", "2026 Ballon d'Or Ceremony")) == 1
assert len(pair('Manchester United vs Liverpool', 'Manchester City vs Liverpool')) == 2
assert len(pair('Cricket tournament', 'Cricket tournament', 'Cricket')) == 2
assert len(pair('Roma vs Cagliari', 'Roma vs Cagliari', 'Cricket')) == 1
assert len(pair('Roma vs Cagliari', 'Roma vs Genoa')) == 2
# Only cricket and football reach the catalog.
assert relay.SPORTS == ('Cricket', 'Football')
assert relay.web_url('javascript:alert(1)') == ''
assert relay.web_url('http://127.0.0.1/private') == ''
assert relay.web_url('http://192.168.1.1/private') == ''
assert relay.web_url('file:///etc/passwd') == ''
handler = object.__new__(relay.Relay)
with patch.object(relay, 'get') as fetch, patch.object(relay, 'get_media') as media:
    try:
        handler.relay('7', 'https://unlisted.example/private')
        raise AssertionError('Unlisted upstream URL accepted')
    except PermissionError:
        pass
    fetch.assert_not_called()
    media.assert_not_called()
assert relay.language('en-US') == 'en'
assert relay.language('Nepali') == 'ne'
session = {'url': 'https://media.example/main.m3u8', 'referer': 'https://embed.example/',
           'origin': 'https://embed.example', 'cookie': 'session=test', 'userAgent': 'Browser'}
response = io.BytesIO(b'#EXTM3U\n#EXTINF:5,\na.ts\n')
response.geturl = lambda: session['url']
handler.reply = lambda *args: None
with patch.object(relay, 'resolve', return_value=session), patch.object(relay, 'get_media', return_value=response) as fetch, \
     patch.object(relay, 'prefetch') as ahead:
    handler.relay('check', None)
    assert fetch.call_args.args == (session['url'], session)
    ahead.assert_called_once()
for normalize, invalid in [(relay.normalize_ppv, {}), (relay.normalize_streamed, {})]:
    try:
        normalize(invalid)
        raise AssertionError('Invalid provider response accepted')
    except ValueError:
        pass

clock = [200000.0]
failed = set()
calls = []
def fake_get(url, headers=None):
    calls.append(url)
    provider = 'PPV' if url == relay.API else 'Streamed'
    if provider in failed:
        raise OSError('offline')
    return io.BytesIO(json.dumps(ppv if provider == 'PPV' else source_data).encode())

relay.catalogs.clear()
with patch.object(relay, 'get', fake_get), patch.object(relay.time, 'time', lambda: clock[0]):
    catalog = relay.sports_catalog('relay:8790')
    assert {item['sport'] for item in catalog['items']} <= {'Cricket', 'Football'}
    assert len(calls) == 2 and all(p['status'] == 'ok' for p in catalog['providers'])
    assert catalog['items'][0]['streams'][0]['url'] == 'http://relay:8790/play/11.m3u8'
    relay.sports_catalog('other:8790')
    assert len(calls) == 2
    clock[0] += 61
    failed.add('PPV')
    stale = relay.sports_catalog('relay:8790')
    assert [p['status'] for p in stale['providers']] == ['stale', 'ok']
    clock[0] += 6 * 3600
    expired = relay.sports_catalog('relay:8790')
    assert [p['status'] for p in expired['providers']] == ['unavailable', 'ok']
    clock[0] += 61
    failed.add('Streamed')
    assert relay.sports_catalog('relay:8790')['providers'][1]['status'] == 'stale'
    clock[0] += 6 * 3600
    try:
        relay.sports_catalog('relay:8790')
        raise AssertionError('Expired schedules were retained')
    except LookupError:
        pass

# Streamed source metadata is resolved only on play, and a preferred language wins over another feed.
sid = other[0]['streams'][0]['id']
choices = [{'embedUrl': 'https://embed.example/es', 'language': 'Spanish'},
           {'embedUrl': 'https://embed.example/hi', 'language': 'Hindi'},
           {'embedUrl': 'https://embed.example/en', 'language': 'English'}]
class Result:
    returncode = 0
    stdout = '{"url":"https://media.example/live.m3u8","referer":"https://embed.example/","origin":"https://embed.example"}'
with patch.object(relay, 'get', lambda *args: io.BytesIO(json.dumps(choices).encode())), \
     patch.object(relay.subprocess, 'run', return_value=Result()) as run:
    relay.resolve(sid, fresh=True)
    assert run.call_args.args[0][2] == 'https://embed.example/en'
# Segments of a served media playlist are fetched ahead and handed out once; failures fall back to a fetch.
relay.prefetched.clear()
fetched = []
def fake_segment(url, info):
    fetched.append(url)
    if url.endswith('bad.ts'):
        raise OSError('slow CDN')
    return io.BytesIO(b'G' + b'\0' * 187 + b'G' + b'\0' * 187 + b'G' + b'\0' * 187)
with patch.object(relay, 'get_media', lambda url, info: fake_segment(url, info)):
    relay.prefetch('#EXTM3U\n#EXTINF:6,\na.ts\n#EXTINF:6,\nb.ts\n#EXTINF:6,\nc.ts\n#EXTINF:6,\nbad.ts\n',
                   'https://cdn.example/live/', {'referer': 'https://embed.example/', 'origin': 'https://embed.example'})
    assert relay.prefetched_segment('https://cdn.example/live/a.ts') is None  # only the newest three
    assert len(relay.prefetched_segment('https://cdn.example/live/c.ts')) == 564
    assert relay.prefetched_segment('https://cdn.example/live/c.ts') is None  # served once
    assert relay.prefetched_segment('https://cdn.example/live/bad.ts') is None
# Media requests keep connections alive per host, follow redirects, and turn HTTP errors into HTTPError.
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ports = []
class Origin(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def do_GET(self):
        ports.append(self.client_address[1])
        assert self.headers['Referer'] == 'https://embed.example/' and 'Cookie' not in self.headers
        if self.path == '/moved':
            self.send_response(302); self.send_header('Location', '/live.m3u8'); self.send_header('Content-Length', '0')
            self.end_headers(); return
        body = b'#EXTM3U\n' if self.path.startswith('/live.m3u8') else b''
        self.send_response(200 if body else 404); self.send_header('Content-Length', str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
origin = ThreadingHTTPServer(('127.0.0.1', 0), Origin)
threading.Thread(target=origin.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:%d' % origin.server_address[1]
headers = {'referer': 'https://embed.example/', 'origin': 'https://embed.example'}
with patch.object(relay, 'web_url', lambda url: url):
    first = relay.get_media(base + '/live.m3u8?token=1', headers)
    assert first.read() == b'#EXTM3U\n' and first.geturl() == base + '/live.m3u8?token=1'
    relay.get_media(base + '/live.m3u8', headers)
    assert len(set(ports)) == 1  # one kept-alive connection
    assert relay.get_media(base + '/moved', headers).geturl() == base + '/live.m3u8'
    try:
        relay.get_media(base + '/gone.ts', headers)
        raise AssertionError('404 accepted')
    except relay.urllib.error.HTTPError as e:
        assert e.code == 404
origin.shutdown()
# A new connection races staggered connects and keeps the first that completes.
listener = relay.socket.socket()
listener.bind(('127.0.0.1', 0))
listener.listen(8)
raced = relay.race_connect(listener.getsockname(), 5)
assert raced.getpeername() == listener.getsockname() and raced.gettimeout() == 5
raced.close()
listener.close()
try:
    relay.race_connect(('127.0.0.1', 1), 1)
    raise AssertionError('Refused connection accepted')
except OSError:
    pass
print('ok test_live_relay (catalog, languages, matching, outages, expiry, resolution, prefetch, kept-alive media)')
