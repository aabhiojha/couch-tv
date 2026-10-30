// Stremio add-on streams for Couch TV.
(function (root) {
  'use strict';
  function parse(raw, addonName) {
    if (!raw || typeof raw !== 'object') return null;
    var infoHash = typeof raw.infoHash === 'string' ? raw.infoHash : '';
    var url = typeof raw.url === 'string' ? raw.url : '';
    if (!infoHash && !url) return null;
    var release = raw.description || raw.title || (raw.behaviorHints && raw.behaviorHints.filename) || raw.name || '';
    var text = [raw.name, raw.title, raw.description, raw.behaviorHints && raw.behaviorHints.filename]
      .filter(function (part) { return typeof part === 'string' && part; }).join('\n');
    var title = String(release).split('\n')[0];
    var words = title.replace(/[._-]/g, ' ');
    var has = function (pattern) { return pattern.test(words); };
    var tags = {
      hevc: has(/\b(?:x265|h\s?265|hevc)\b/i), tenBit: has(/\b(?:10\s?bit|hi10p?)\b/i),
      hdr: has(/\b(?:hdr(?:10\+?)?)\b/i), dv: has(/\b(?:dv|dovi|dolby vision)\b/i),
      dts: has(/\bdts\b/i), truehd: has(/\btruehd\b/i), atmos: has(/\batmos\b/i),
      cam: has(/\b(?:cam|hdcam|ts|telesync|hdts)\b/i)
    };
    var qualityText = String(release).toLowerCase();
    if (!/\b(?:2160p?|4k|uhd|1080p?|720p?|480p?)\b/.test(qualityText)) qualityText = text.toLowerCase();
    var quality = /\b(?:2160p?|4k|uhd)\b/.test(qualityText) ? 2160 : /\b1080p?\b/.test(qualityText) ? 1080
      : /\b720p?\b/.test(qualityText) ? 720 : /\b480p?\b/.test(qualityText) ? 480 : 0;
    var seeders = text.match(/👤\s*([\d,]+)/);
    var size = text.match(/💾\s*([\d,.]+)\s*(GB|MB)\b/i);
    var index = Number(raw.fileIdx);
    return {
      kind: infoHash ? 'torrent' : 'http', infoHash: infoHash,
      fileIdx: raw.fileIdx !== null && raw.fileIdx !== undefined && Number.isInteger(index) && index >= 0 ? index : null,
      trackers: (Array.isArray(raw.sources) ? raw.sources : []).filter(function (source) {
        return typeof source === 'string' && source.indexOf('tracker:') === 0 && source.length > 8;
      }).map(function (source) { return source.slice(8); }),
      url: url, addon: addonName || '', title: title, text: text, quality: quality,
      seeders: seeders ? Number(seeders[1].replace(/,/g, '')) : 0,
      sizeBytes: size ? Math.round(Number(size[1].replace(/,/g, '')) * (size[2].toUpperCase() === 'GB' ? 1073741824 : 1048576)) : 0,
      tags: tags, playable: !tags.cam && !(tags.tenBit && !tags.hevc) && !(tags.dv && !tags.hdr),
      needsTranscode: tags.dts || tags.truehd, score: 0
    };
  }
  function rank(streams, quality) {
    var wanted = quality === 'best' || !quality ? 1080 : Number(quality);
    var order = wanted === 2160 ? [2160, 1080, 720, 480, 0]
      : wanted === 1080 ? [1080, 2160, 720, 480, 0]
      : wanted === 720 ? [720, 480, 1080, 2160, 0]
        : [480, 720, 1080, 2160, 0];
    return (streams || []).map(function (stream) {
      var place = order.indexOf(stream.quality);
      // Quality wins; logarithmic peers limit large swarms, then audio cost and HTTP break close ties.
      stream.score = (5 - (place < 0 ? 4 : place)) * 1000
        + (stream.kind === 'http' ? 200 : stream.seeders ? Math.log(1 + stream.seeders) * 10 : -100)
        - (stream.needsTranscode ? 25 : 0);
      return stream;
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function torrentUrl(serverBase, stream) {
    // -1 lets the streaming server pick the main video file (docs/torrent-server.md).
    var query = (stream.trackers || []).map(function (tracker) { return 'tr=' + encodeURIComponent(tracker); }).join('&');
    return serverBase.replace(/\/+$/, '') + '/' + stream.infoHash + '/' + (stream.fileIdx === null ? -1 : stream.fileIdx)
      + (query ? '?' + query : '');
  }
  function streams(addonUrls, type, id) {
    return Promise.all((Array.isArray(addonUrls) ? addonUrls : []).map(function (addonUrl) {
      var base = String(addonUrl).replace(/\/manifest\.json\/?$/i, '').replace(/\/+$/, '');
      var controller = new AbortController();
      var timer;
      var request = Promise.resolve().then(function () {
        return fetch(base + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json', { signal: controller.signal });
      }).then(function (response) {
        if (!response.ok) return [];
        return response.json();
      }).then(function (body) {
        return body && Array.isArray(body.streams) ? body.streams.map(function (raw) { return parse(raw, base); }).filter(Boolean) : [];
      }).catch(function () { return []; });
      var timeout = new Promise(function (resolve) {
        timer = setTimeout(function () { controller.abort(); resolve([]); }, 8000);
      });
      return Promise.race([request, timeout]).then(function (result) { clearTimeout(timer); return result; });
    })).then(function (groups) {
      var seen = Object.create(null), merged = [];
      groups.forEach(function (group) { group.forEach(function (stream) {
        var key = stream.kind === 'torrent' ? 't:' + stream.infoHash.toLowerCase() + ':' + stream.fileIdx : 'u:' + stream.url;
        if (!seen[key]) { seen[key] = true; merged.push(stream); }
      }); });
      return merged;
    }).catch(function () { return []; });
  }
  var api = { streams: streams, parse: parse, rank: rank, torrentUrl: torrentUrl };
  root.Addons = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
