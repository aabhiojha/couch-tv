(function () {
  'use strict';

  Shell.register('search', function (ctx) {
    var kit = ctx.kit;
    var data = ctx.data;
    var shell = ctx.shell;
    var el = kit.el('main', 'search-screen');
    var left = kit.el('section', 'search-left');
    var right = kit.el('section', 'search-right');
    left.appendChild(kit.el('h1', 'search-title', 'Search'));
    left.appendChild(kit.el('div', 'search-hint', 'Find your next good story'));

    var queryLine = kit.el('div', 'search-query');
    var queryText = kit.el('span', 'search-query-text');
    var caret = kit.el('span', 'search-caret');
    queryLine.appendChild(queryText);
    queryLine.appendChild(caret);
    left.appendChild(queryLine);
    left.appendChild(kit.el('div', 'search-keyboard-label', 'USE THE REMOTE TO TYPE'));

    // QWERTY, rows centred like a real keyboard. Widths are in key units (a row is 10 units wide);
    // each key's centre decides which key Up/Down lands on.
    var keyboard = kit.el('div', 'search-keyboard');
    var rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'].map(function (letters) {
      return letters.split('').map(function (value) { return { value: value, width: 1 }; });
    }).concat([[{ value: 'Space', width: 4 }, { value: 'Delete', width: 3 }, { value: 'Clear', width: 3 }]]);
    var keys = [];
    rows.forEach(function (row) {
      var line = kit.el('div', 'search-key-row');
      var x = (10 - row.reduce(function (sum, key) { return sum + key.width; }, 0)) / 2;
      var nodes = [];
      row.forEach(function (key) {
        key.center = x + key.width / 2;
        x += key.width;
        var node = kit.el('div', 'search-key' + (key.width > 1 ? ' search-key-wide search-key-w' + key.width : ''), key.value);
        line.appendChild(node);
        nodes.push(node);
      });
      keyboard.appendChild(line);
      keys.push(nodes);
    });
    left.appendChild(keyboard);

    function nearestKey(row, center) {
      var best = 0;
      rows[row].forEach(function (key, index) {
        if (Math.abs(key.center - center) < Math.abs(rows[row][best].center - center)) best = index;
      });
      return best;
    }

    var rightHeader = kit.el('div', 'search-right-header');
    var rightTitle = kit.el('h2', 'search-right-title');
    var count = kit.el('div', 'search-count');
    rightHeader.appendChild(rightTitle);
    rightHeader.appendChild(count);
    right.appendChild(rightHeader);

    var emptyPanel = kit.el('div', 'search-empty-panel');
    var recentHeading = kit.el('h3', 'search-section-heading', 'Recent searches');
    var recentList = kit.el('div', 'search-recent-list');
    var popularHeading = kit.el('h3', 'search-section-heading search-popular-heading', 'Popular right now');
    emptyPanel.appendChild(recentHeading);
    emptyPanel.appendChild(recentList);
    emptyPanel.appendChild(popularHeading);

    var popular = kit.Grid({ columns: 2, onSelect: openItem });
    var results = kit.Grid({ columns: 2, onSelect: openItem, onNeedMore: loadMore });
    results.el.classList.add('search-results-grid');
    results.el.hidden = true;
    emptyPanel.appendChild(popular.el);
    right.appendChild(emptyPanel);
    right.appendChild(results.el);
    el.appendChild(left);
    el.appendChild(right);

    var query = '';
    var area = 'keyboard';
    var keyRow = 0;
    var keyCol = 0;
    var recentIndex = 0;
    var recents = [];
    var focused = false;
    var timer = null;
    var revision = 0;
    var page = 1;
    var total = Infinity;
    var loaded = 0;
    var loading = false;
    var popularLoaded = false;

    function openItem(item) {
      if (query.trim()) data.addRecentSearch(query.trim());
      shell.go('details', { id: item.id, item: item });
    }

    function renderRecent() {
      recents = data.recentSearches();
      recentList.textContent = '';
      recentHeading.hidden = !recents.length;
      recentList.hidden = !recents.length;
      if (recentIndex >= recents.length) recentIndex = Math.max(0, recents.length - 1);
      recents.forEach(function (value) {
        recentList.appendChild(kit.el('div', 'search-recent', value));
      });
    }

    function retryPopular() {
      popularLoaded = false;
      loadPopular();
    }

    function loadPopular() {
      if (popularLoaded) return;
      popularLoaded = true;
      popular.setLoading(true);
      data.loadRow(data.rows[0].key, 1).then(function (result) {
        popular.setLoading(false);
        popular.setItems((result.items || []).slice(0, 8));
        updateFocus();
      }, function () {
        popular.setError(retryPopular);
        updateFocus();
      });
    }

    function loadMore() {
      if (!query.trim() || loading || loaded >= total) return;
      loading = true;
      results.setLoading(true);
      var request = revision;
      var requestedQuery = query.trim();
      var requestedPage = page;
      data.search(requestedQuery, requestedPage).then(function (result) {
        if (request !== revision) return;
        loading = false;
        page++;
        total = result.total;
        var items = result.items || [];
        loaded += items.length;
        results.setLoading(false);
        results.el.classList.remove('is-stale');
        if (requestedPage === 1) results.setItems(items);
        else results.appendItems(items);
        if (!items.length && requestedPage === 1) {
          results.setEmpty('No results for “' + requestedQuery + '”. Check the spelling, or try fewer words.');
        }
        if (!items.length) total = loaded;
        count.textContent = total + (total === 1 ? ' result' : ' results');
        updateFocus();
      }, function () {
        if (request !== revision) return;
        loading = false;
        results.setError(loadMore);
        updateFocus();
      });
    }

    function queryChanged() {
      revision++;
      clearTimeout(timer);
      loading = false;
      page = 1;
      total = Infinity;
      loaded = 0;
      queryText.textContent = query || 'Search films and series';
      queryLine.classList.toggle('is-empty', !query);
      var searching = !!query.trim();
      // Rebuilding the results grid on every letter made the next move on the keyboard stutter;
      // the old results stay (dimmed) until the new ones replace them in one go.
      if (emptyPanel.hidden !== searching) {
        emptyPanel.hidden = searching;
        results.el.hidden = !searching;
        if (!searching) {
          renderRecent();
          results.setItems([]);
        }
      }
      results.el.classList.toggle('is-stale', searching);
      if (!searching && area === 'results') area = recents.length ? 'recent' : 'popular';
      if (searching && area !== 'keyboard') area = 'results';
      rightTitle.textContent = searching ? 'Results' : 'Explore';
      count.textContent = searching ? 'Searching…' : '';
      updateFocus();
      if (searching) timer = setTimeout(loadMore, 400);
    }

    function type(value) {
      if (value === 'Delete') query = query.slice(0, -1);
      else if (value === 'Clear') query = '';
      else if (value === 'Space') query += ' ';
      else query += value;
      queryChanged();
    }

    function rightArea() {
      if (query.trim()) return 'results';
      return recents.length ? 'recent' : 'popular';
    }

    var focusedKey = null;
    function updateFocus() {
      var key = focused && area === 'keyboard' ? keys[keyRow][keyCol] : null;
      if (key !== focusedKey) {
        if (focusedKey) focusedKey.classList.remove('focused');
        if (key) key.classList.add('focused');
        focusedKey = key;
      }
      var recentNodes = recentList.children;
      for (var i = 0; i < recentNodes.length; i++) {
        recentNodes[i].classList.toggle('focused', focused && area === 'recent' && i === recentIndex);
      }
      if (focused && area === 'popular') popular.focus();
      else popular.blur();
      if (focused && area === 'results') results.focus();
      else results.blur();
    }

    function moveKeyboard(code) {
      if (code === 13) {
        type(rows[keyRow][keyCol].value);
        return true;
      }
      if (code === 37 || code === 39) {
        if (code === 37 && keyCol === 0) return false;
        if (code === 39 && keyCol === rows[keyRow].length - 1) {
          area = rightArea();
          updateFocus();
          return true;
        }
        keyCol = (keyCol + (code === 39 ? 1 : -1) + rows[keyRow].length) % rows[keyRow].length;
      } else if (code === 38 || code === 40) {
        if (code === 38 && keyRow === 0) return false; // the tab bar
        if (code === 40 && keyRow === rows.length - 1) return true;
        var center = rows[keyRow][keyCol].center;
        keyRow += code === 40 ? 1 : -1;
        keyCol = nearestKey(keyRow, center);
      } else {
        return false;
      }
      updateFocus();
      return true;
    }

    function handleRecentKey(code) {
      if (code === 13) {
        query = recents[recentIndex] || '';
        queryChanged();
        area = 'results';
        updateFocus();
        return true;
      }
      if (code === 37) {
        area = 'keyboard';
        updateFocus();
        return true;
      }
      if (code === 38 || code === 40) {
        var next = recentIndex + (code === 40 ? 1 : -1);
        if (next < 0) return true;
        if (next >= recents.length) area = 'popular';
        else recentIndex = next;
        updateFocus();
        return true;
      }
      if (code === 39) {
        area = 'popular';
        updateFocus();
      }
      return true;
    }

    function handleGridKey(code) {
      var grid = area === 'results' ? results : popular;
      if (grid.handleKey(code)) return true;
      if (code === 37) {
        area = 'keyboard';
        updateFocus();
        return true;
      }
      if (code === 38 && area === 'popular' && recents.length) {
        area = 'recent';
        updateFocus();
        return true;
      }
      return false;
    }

    function handleKey(code) {
      if (code === 10009) {
        if (!query.length) return false;
        type('Delete');
        return true;
      }
      if (code >= 65 && code <= 90) {
        type(String.fromCharCode(code + 32));
        return true;
      }
      if (code >= 48 && code <= 57) {
        type(String.fromCharCode(code));
        return true;
      }
      if (area === 'keyboard') return moveKeyboard(code);
      if (area === 'recent') return handleRecentKey(code);
      return handleGridKey(code);
    }

    queryChanged();
    return {
      el: el,
      show: function (params, returning) {
        if (!returning) {
          area = 'keyboard';
          keyRow = 0;
          keyCol = 0;
        }
        renderRecent();
        loadPopular();
        updateFocus();
      },
      hide: function () {
        focused = false;
        updateFocus();
      },
      focus: function () {
        focused = true;
        updateFocus();
      },
      hideFocus: function () {
        focused = false;
        updateFocus();
      },
      handleKey: handleKey
    };
  });
})();
