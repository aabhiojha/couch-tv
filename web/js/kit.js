(function () {
  'use strict';
  function el(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }
  var paths = {
    search:
      'M11 3a8 8 0 1 0 5.3 14l4.4 4.4-1.4 1.4-4.4-4.4A8 8 0 0 0 11 3zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12',
    home: 'M3 11 12 3l9 8v10h-7v-7h-4v7H3z',
    film: 'M3 4h18v16H3zm4 0v16m10-16v16M3 9h18M3 15h18',
    tv: 'M3 5h18v14H3zm6 16h6m-3-2v2',
    list: 'M4 6h3m3 0h10M4 12h3m3 0h10M4 18h3m3 0h10',
    settings:
      'M19.14 12.94a7.14 7.14 0 0 0 .06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
    play: 'M7 4v16l13-8z',
    plus: 'M12 3v18M3 12h18',
    check: 'M4 12l5 5L20 6',
    restart: 'M4 11a8 8 0 1 1 2 6M4 5v6h6',
    star: 'M12 2l3 7 7 .6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.6 9 9z',
    back: 'M19 12H5m7-7-7 7 7 7',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 7v6m0-9v.5',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l4 2',
    live: 'M12 11v.5M8.5 7.5a5 5 0 0 0 0 8M15.5 7.5a5 5 0 0 1 0 8M5.6 4.6a9 9 0 0 0 0 13.8M18.4 4.6a9 9 0 0 1 0 13.8'
  };
  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('kit-icon');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name] || paths.star);
    path.setAttribute(
      'fill',
      name === 'play' || name === 'star' || name === 'home' || name === 'search' || name === 'settings'
        ? 'currentColor'
        : 'none'
    );
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }
  function card(item, options) {
    options = options || {};
    var node = el('div', 'poster-card' + (options.wide ? ' poster-card-wide' : ''));
    var art = el('div', 'poster-art');
    // item.fallback: what the card shows without artwork, when the title is already printed under it.
    art.appendChild(el('div', 'poster-fallback', item.fallback || item.title || 'Untitled'));
    if (item.thumb) {
      art.classList.add('image-pending');
      var img = el('img', 'poster-image');
      img.alt = '';
      img.decoding = 'async'; // a row of new artwork decoding on the main thread dropped frames while moving
      img.onload = function () {
        art.classList.remove('image-pending', 'image-loading');
        art.classList.add('has-image');
      };
      img.onerror = function () {
        art.classList.remove('image-pending', 'image-loading');
        art.classList.remove('has-image');
        img.removeAttribute('src');
      };
      art.appendChild(img);
      var logo = null;
      if (item.logo) {
        art.classList.add('has-logo');
        art.appendChild(el('div', 'poster-scrim'));
        logo = el('img', 'poster-logo');
        logo.alt = '';
        logo.onerror = function () {
          art.classList.remove('has-logo');
        };
        art.appendChild(logo);
      }
      // Shimmer (base.css .image-loading) only while a request is out: dozens of deferred, off-screen cards
      // shimmering at once cost the TV most of its frames (tools/frames.js).
      var load = function () {
        art.classList.add('image-loading');
        img.src = item.thumb;
        if (logo) logo.src = item.logo;
      };
      if (options.deferImage) node._loadImage = load;
      else load();
    }
    if (typeof options.progress === 'number' && options.progress > 0) {
      var bar = el('div', 'poster-progress');
      bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, options.progress)) + ')';
      art.appendChild(bar);
    }
    art.appendChild(el('div', 'poster-caption', item.title || 'Untitled'));
    if (item.crests && item.crests.length === 2 && !item.thumb) {
      // A match without a poster: both teams' crests, home and away.
      var crests = el('div', 'poster-crests');
      item.crests.forEach(function (url, i) {
        if (i) crests.appendChild(el('span', 'poster-crests-v', 'v'));
        var crest = el('img', 'poster-crest');
        crest.alt = '';
        crest.onerror = function () { crest.style.visibility = 'hidden'; };
        crest.src = url;
        crests.appendChild(crest);
      });
      art.appendChild(crests);
      art.classList.add('has-crests');
    }
    if (item.badge) art.appendChild(el('div', 'poster-badge' + (item.live ? ' poster-badge-live' : ''), item.badge));
    node.appendChild(art);
    node.appendChild(el('div', 'poster-title', item.title || 'Untitled'));
    var meta = [];
    if (item.year) meta.push(item.year);
    if (Number(item.rating) > 0) meta.push('TMDB ' + Number(item.rating).toFixed(1));
    node.appendChild(el('div', 'poster-meta', item.meta || meta.join(' · ')));
    return node;
  }
  function skeleton() {
    var n = el('div', 'poster-card skeleton-card');
    n.appendChild(el('div', 'poster-art skeleton-block'));
    n.appendChild(el('div', 'skeleton-line skeleton-block'));
    return n;
  }
  function collection(config, grid) {
    var root = el('div', grid ? 'kit-grid' : 'kit-row' + (config.wide ? ' kit-row-wide' : ''));
    var heading = !grid && config.title ? el('h2', 'row-heading', config.title) : null;
    if (heading) root.appendChild(heading);
    var viewport = el('div', grid ? 'grid-viewport' : 'row-viewport');
    var track = el('div', grid ? 'grid-track' : 'row-track');
    viewport.appendChild(track);
    root.appendChild(viewport);
    var state = el('div', 'collection-state');
    root.appendChild(state);
    var items = [],
      cards = [],
      index = 0,
      active = false,
      loading = false,
      needMoreArmed = true,
      errorRetry = null;
    var columns = grid ? Math.max(1, config.columns || 5) : 1;
    function renderState() {
      state.textContent = '';
      if (loading && !items.length) {
        for (var i = 0; i < (grid ? columns * 2 : 4); i++) track.appendChild(skeleton());
      }
      if (errorRetry) {
        var retry = el('div', 'collection-retry', "Couldn't load. Press OK to retry");
        state.appendChild(retry);
      }
    }
    function clearSkeletons() {
      var nodes = track.querySelectorAll('.skeleton-card');
      for (var i = 0; i < nodes.length; i++) track.removeChild(nodes[i]);
    }
    // Runs on every key press, so it touches only the cards whose focus changed and measures the
    // layout once (cached); reading layout after class writes would force a reflow per row.
    var focusedCard = null,
      imagesLoaded = 0,
      aheadTimer = null,
      stepX = 0,
      rowStep = 0,
      rowWidth = 0,
      lastTransform = '',
      // Rows off screen (Home) wait to be told they are nearby before loading any images.
      nearby = config.nearby !== false;
    function update() {
      var target = active ? cards[index] || null : null;
      if (target !== focusedCard) {
        if (focusedCard) focusedCard.classList.remove('focused');
        if (target) target.classList.add('focused');
        focusedCard = target;
        if (target && config.onFocus) config.onFocus(items[index], index);
      }
      state.classList.toggle(
        'focused',
        active && ((!cards.length && !loading) || (errorRetry && index === cards.length))
      );
      if (!cards.length) {
        var firstSkeleton = track.querySelector('.skeleton-card');
        if (firstSkeleton) firstSkeleton.classList.toggle('focused', active);
        return;
      }
      loadImages();
      // Layout is read only once scrolling is possible (a row past its 3rd card, a grid past its first
      // line): measuring right after cards are inserted forces a full page layout, which made building
      // Home's rows the biggest start-up cost on the TV.
      var last = Math.min(index, cards.length - 1),
        shift = 0;
      if (grid && last >= columns) {
        if (!rowStep) rowStep = parseFloat(window.getComputedStyle(track).getPropertyValue('--grid-row-step')) || 286;
        if (config.peek) {
          // Past the first row the focused row stays second from the top, so the next row always shows below it.
          shift = Math.max(0, Math.floor(last / columns) - 1) * rowStep;
        } else {
          var visible = Math.max(1, Math.round(viewport.clientHeight / rowStep));
          shift = Math.max(0, Math.floor(last / columns) - visible + 1) * rowStep;
        }
      } else if (!grid && last >= 3) {
        if (!stepX && cards[0].offsetWidth) stepX = cards[0].offsetWidth + 46;
        if (!rowWidth) rowWidth = viewport.clientWidth; // rows never resize
        shift = Math.max(0, (last + 1) * (stepX || 338) - (rowWidth || 1650) + 36);
      }
      var transform = grid ? 'translate3d(0,' + -shift + 'px,0)' : 'translate3d(' + -shift + 'px,0,0)';
      if (transform !== lastTransform) {
        track.style.transform = transform;
        lastTransform = transform;
      }
      if (
        active &&
        items.length &&
        config.onNeedMore &&
        index >= items.length - 5 &&
        needMoreArmed
      ) {
        needMoreArmed = false;
        config.onNeedMore();
      }
    }
    // Images for what is on screen plus a little ahead (about 5 cards show per row).
    // Only what is on screen starts now; the look-ahead waits for the remote to rest, so image loads and
    // decodes don't land in the middle of a scroll (a burst of them cost frames on the TV).
    function startImages(end) {
      for (; imagesLoaded < Math.min(cards.length, end); imagesLoaded++) {
        if (cards[imagesLoaded]._loadImage) {
          cards[imagesLoaded]._loadImage();
          cards[imagesLoaded]._loadImage = null;
        }
      }
    }
    // Artwork is requested once the move has settled: decoding a row's pictures during the 300 ms scroll dropped
    // frames on the TV (tools/frames.js). Cards already loaded stay; the shimmer covers the short wait.
    function loadImages() {
      clearTimeout(aheadTimer);
      if (!nearby) return;
      aheadTimer = setTimeout(function () {
        if (!nearby) return;
        startImages(index + (grid ? columns * 2 : 4));
        aheadTimer = setTimeout(function () {
          if (nearby) startImages(index + (grid ? columns * 3 : 5));
        }, 400);
      }, 350);
    }
    function setNearby(value) {
      nearby = !!value;
      loadImages();
    }
    // Done while idle so the first scroll of a row neither waits for images nor forces a layout.
    function warm() {
      nearby = true;
      loadImages();
      if (!grid && cards.length && !stepX && cards[0].offsetWidth) {
        stepX = cards[0].offsetWidth + 46;
        rowWidth = viewport.clientWidth;
      }
    }
    function append(incoming) {
      clearSkeletons();
      errorRetry = null;
      loading = false;
      state.textContent = '';
      if (index >= cards.length && cards.length) index = cards.length - 1;
      incoming = incoming || [];
      for (var i = 0; i < incoming.length; i++) {
        items.push(incoming[i]);
        var opts = config.cardOptions ? config.cardOptions(incoming[i]) : {};
        opts = opts || {};
        cards.push(
          card(incoming[i], { progress: opts.progress, wide: opts.wide, deferImage: true })
        );
        track.appendChild(cards[cards.length - 1]);
      }
      if (incoming.length) needMoreArmed = true;
      update();
    }
    function setItems(incoming) {
      items = [];
      cards = [];
      index = 0;
      focusedCard = null;
      imagesLoaded = 0;
      track.textContent = '';
      track.style.transform = '';
      lastTransform = '';
      append(incoming);
    }
    function setLoading(value) {
      loading = !!value;
      if (loading) errorRetry = null;
      clearSkeletons();
      renderState();
      update();
    }
    function setError(onRetry) {
      loading = false;
      clearSkeletons();
      errorRetry = onRetry;
      renderState();
      update();
    }
    function focus(next) {
      if (typeof next === 'number')
        index = Math.max(0, Math.min(next, cards.length - 1 + (errorRetry ? 1 : 0)));
      active = true;
      update();
    }
    function blur() {
      if (!active) return;
      active = false;
      update();
    }
    function handleKey(code) {
      if (code === 10009 || (code === 38 && (!grid || index < columns))) return false;
      if (code === 13) {
        if (cards[index]) {
          if (config.onSelect) config.onSelect(items[index], index);
        } else if (errorRetry) errorRetry();
        return true;
      }
      // The remote's Play key on a card plays the title: details opens and starts it once loaded.
      if ((code === 10252 || code === 415) && items[index]) {
        if (config.onPlay) config.onPlay(items[index], index);
        else Shell.go('details', { id: items[index].id, item: items[index], autoplay: true });
        return true;
      }
      var next = index;
      if (code === 37) next--;
      else if (code === 39) next++;
      else if (grid && code === 38) next -= columns;
      else if (grid && code === 40) next += columns;
      else return false;
      if (grid && code === 37 && index % columns === 0) return false;
      if (
        grid &&
        code === 39 &&
        index % columns === columns - 1 &&
        !(errorRetry && next === cards.length)
      )
        return false;
      if (next < 0 || next >= cards.length + (errorRetry ? 1 : 0)) return false;
      index = next;
      update();
      return true;
    }
    function setEmpty(value) {
      track.textContent = '';
      items = [];
      cards = [];
      index = 0;
      focusedCard = null;
      imagesLoaded = 0;
      loading = false;
      errorRetry = null;
      state.textContent = value || '';
      update();
    }
    function getIndex() {
      return index;
    }
    var api = {
      el: root,
      setItems: setItems,
      appendItems: append,
      setLoading: setLoading,
      setError: setError,
      focus: focus,
      blur: blur,
      handleKey: handleKey,
      setNearby: setNearby,
      warm: warm
    };
    if (grid) api.setEmpty = setEmpty;
    Object.defineProperty(api, 'index', { get: getIndex });
    return api;
  }
  // The white focus pill that slides between the items of a row (the tab bar, Tabs), as on tvOS. It's two round
  // caps and a middle strip that only translate and scale, so it neither repaints nor squashes its round ends.
  // move(item) puts it under item at the focused scale; move(null) fades it out.
  function Pill(parent) {
    var node = el('div', 'kit-pill'), parts = [el('div', 'kit-pill-cap'), el('div', 'kit-pill-mid'), el('div', 'kit-pill-cap')];
    parts.forEach(function (part) { node.appendChild(part); });
    parent.insertBefore(node, parent.firstChild);
    var shown = false, height = 0;
    function move(item, scale) {
      if (!item || !item.offsetWidth) {
        node.classList.remove('on');
        shown = false;
        return;
      }
      var s = scale || 1.08, h = item.offsetHeight, r = h / 2, w = item.offsetWidth * s;
      var x = item.offsetLeft + (item.offsetWidth - w) / 2, y = item.offsetTop + (h - h * s) / 2;
      if (h !== height) {
        height = h;
        parts[0].style.width = parts[2].style.width = r + 'px';
        parts[1].style.width = '1px';
        parts.forEach(function (part) { part.style.height = h + 'px'; });
      }
      var at = [
        'translate(' + x + 'px,' + y + 'px) scale(' + s + ')',
        'translate(' + (x + r * s - 1) + 'px,' + y + 'px) scale(' + (w - 2 * r * s + 2) + ',' + s + ')',
        'translate(' + (x + w - r * s) + 'px,' + y + 'px) scale(' + s + ')'
      ];
      // Appearing: start on the item instead of sliding in from where it was last.
      parts.forEach(function (part, i) {
        if (!shown) part.style.transition = 'none';
        part.style.transform = at[i];
      });
      if (!shown) {
        window.getComputedStyle(parts[0]).transform;
        parts.forEach(function (part) { part.style.transition = ''; });
        node.classList.add('on');
        shown = true;
      }
    }
    return { move: move };
  }
  function Tabs(config) {
    var root = el('div', 'kit-tabs'),
      track = el('div', 'kit-tabs-track'),
      shift = 0,
      buttons = [],
      items = config.items || [],
      index = Math.max(0, Math.min(items.length - 1, config.index || 0)),
      active = false;
    for (var i = 0; i < items.length; i++) {
      var button = el('div', 'kit-tab', items[i].title);
      track.appendChild(button);
      buttons.push(button);
    }
    root.appendChild(track);
    var pill = Pill(track);
    function update() {
      for (var j = 0; j < buttons.length; j++) {
        buttons[j].classList.toggle('selected', j === index);
        buttons[j].classList.toggle('focused', active && j === index);
      }
      pill.move(active ? buttons[index] : null);
      // Long tab sets (a show with 28 seasons) slide so the selected tab stays on screen.
      var button = buttons[index];
      if (!button || !root.clientWidth) return;
      var left = button.offsetLeft, right = left + button.offsetWidth, width = root.clientWidth;
      if (left - shift < 40) shift = Math.max(0, left - 40);
      else if (right - shift > width - 40) shift = right - width + 40;
      track.style.transform = 'translate3d(' + -shift + 'px,0,0)';
    }
    function focus() {
      active = true;
      update();
    }
    function blur() {
      active = false;
      update();
    }
    function handleKey(code) {
      if (code === 13) return true;
      if (code !== 37 && code !== 39) return false;
      var next = index + (code === 39 ? 1 : -1);
      if (next < 0 || next >= items.length) return false;
      index = next;
      update();
      if (config.onChange) config.onChange(items[index].key);
      return true;
    }
    function getValue() {
      return items[index] ? items[index].key : null;
    }
    var api = { el: root, focus: focus, blur: blur, handleKey: handleKey };
    Object.defineProperty(api, 'value', { get: getValue });
    update();
    return api;
  }
  // The Couch TV loader (css/loader.css); label is optional and can be changed via .loader-label.
  function loader(label) {
    var node = el('div', 'loader');
    var mark = el('div', 'loader-mark', 'couch ');
    mark.appendChild(el('span', '', 'tv'));
    node.appendChild(mark);
    var track = el('div', 'loader-track');
    track.appendChild(el('div', 'loader-bar'));
    node.appendChild(track);
    node.appendChild(el('div', 'loader-label', label || ''));
    return node;
  }
  function Row(config) {
    return collection(config, false);
  }
  function Grid(config) {
    return collection(config, true);
  }
  window.Kit = {
    el: el,
    icon: icon,
    card: card,
    loader: loader,
    Row: Row,
    Grid: Grid,
    Pill: Pill,
    Tabs: Tabs
  };
})();
