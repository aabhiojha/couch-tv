(function () {
  'use strict';
  Shell.register('browse', function (ctx) {
    var data = ctx.data,
      kit = ctx.kit,
      shell = ctx.shell;
    var el = kit.el('main', 'browse-screen'),
      pageTrack = kit.el('div', 'browse-track'),
      header = kit.el('div', 'browse-header');
    var title = kit.el('h1', 'screen-title');
    header.appendChild(title);
    pageTrack.appendChild(header);
    var emptyMessage = kit.el(
      'div',
      'browse-empty',
      'Your list is empty. On any film or series, choose My List to save it here.'
    );
    emptyMessage.hidden = true;
    pageTrack.appendChild(emptyMessage);
    el.appendChild(pageTrack);
    var filterWrap = kit.el('div', 'browse-tabs-wrap'),
      sortWrap = kit.el('div', 'browse-tabs-wrap');
    pageTrack.appendChild(filterWrap);
    pageTrack.appendChild(sortWrap);
    var grid,
      filters,
      sorts,
      mode = 'movies',
      level = 2,
      focused = false,
      page = 1,
      total = Infinity,
      count = 0,
      loading = false,
      token = 0,
      initialized = false,
      isEmpty = false;
    function select(item) {
      shell.go('details', { id: item.id, item: item });
    }
    function load() {
      if (loading || count >= total || mode === 'mylist') return;
      loading = true;
      grid.setLoading(true);
      var request = ++token,
        requestedPage = page;
      data.browse(mode, filters.value, sorts.value, requestedPage).then(
        function (result) {
          if (request !== token) return;
          loading = false;
          page++;
          total = result.total;
          var items = result.items || [];
          count += items.length;
          grid.setLoading(false);
          if (requestedPage === 1) grid.setItems(items);
          else grid.appendItems(items);
          if (!items.length && requestedPage === 1)
            grid.setEmpty('Nothing to watch here yet. Try another filter.');
          if (!items.length) total = count;
          updateFocus();
        },
        function () {
          if (request !== token) return;
          loading = false;
          grid.setError(function () {
            load();
          });
          updateFocus();
        }
      );
    }
    function resetLoad() {
      token++;
      page = 1;
      total = Infinity;
      count = 0;
      loading = false;
      grid.setItems([]);
      load();
    }
    function build(params) {
      mode = params.mylist ? 'mylist' : params.section || 'movies';
      var section = null;
      for (var i = 0; i < data.sections.length; i++)
        if (data.sections[i].key === mode) section = data.sections[i];
      title.textContent = mode === 'mylist' ? 'My List' : section ? section.title : mode;
      filterWrap.textContent = '';
      sortWrap.textContent = '';
      filters =
        mode === 'mylist'
          ? null
          : kit.Tabs({ items: section ? section.filters : [], onChange: resetLoad });
      sorts = mode === 'mylist' ? null : kit.Tabs({ items: data.sorts, onChange: resetLoad });
      if (filters) {
        filterWrap.appendChild(kit.el('div', 'tabs-label', 'Collection'));
        filterWrap.appendChild(filters.el);
      }
      if (sorts) {
        sortWrap.appendChild(kit.el('div', 'tabs-label', 'Sort by'));
        sortWrap.appendChild(sorts.el);
      }
      filterWrap.hidden = !filters;
      sortWrap.hidden = !sorts;
      grid = kit.Grid({ columns: 4, peek: true, onSelect: select, onNeedMore: load });
      pageTrack.appendChild(grid.el);
      initialized = true;
      level = 0;
      if (mode === 'mylist') refreshList();
      else resetLoad();
    }
    function refreshList() {
      if (mode !== 'mylist' || !grid) return;
      var index = grid.index,
        list = data.myList();
      grid.setItems(list);
      isEmpty = !list.length;
      emptyMessage.hidden = !isEmpty;
      grid.el.hidden = isEmpty;
      if (!isEmpty) grid.focus(index);
      updateFocus();
    }
    function updateFocus() {
      var gridActive = !isEmpty && (level === 2 || mode === 'mylist');
      el.classList.toggle('grid-active', gridActive);
      var shift = gridActive && grid ? Math.max(0, grid.el.offsetTop - 90) : 0;
      pageTrack.style.transform = 'translate3d(0,' + -shift + 'px,0)';
      if (focused) shell.tuck(shift > 0);
      if (filters) {
        if (focused && level === 0) filters.focus();
        else filters.blur();
      }
      if (sorts) {
        if (focused && level === 1) sorts.focus();
        else sorts.blur();
      }
      if (grid) {
        if (focused && !isEmpty && level === (mode === 'mylist' ? 0 : 2)) grid.focus();
        else grid.blur();
      }
    }
    function show(params, returning) {
      if (!initialized) build(params);
      else if (!returning && mode === 'mylist') refreshList();
      grid.setNearby(true);
      updateFocus();
    }
    function hide() {
      focused = false;
      updateFocus();
      if (grid) grid.setNearby(false);
      el.hidden = true;
    }
    function focus() {
      focused = true;
      updateFocus();
    }
    function hideFocus() {
      focused = false;
      updateFocus();
    }
    function refresh() {
      if (mode === 'mylist') refreshList();
    }
    function handleKey(code) {
      if (code === 10009) return false;
      if (code === 38) {
        if (level === (mode === 'mylist' ? 0 : 2) && grid && grid.handleKey(code)) return true;
        if (level === 0) return false; // the tab bar
        level--;
        updateFocus();
        return true;
      }
      if (code === 40) {
        if (level === 0 && mode !== 'mylist') {
          level = 1;
          updateFocus();
          return true;
        }
        if (level === 1) {
          level = 2;
          updateFocus();
          return true;
        }
        if (grid) return grid.handleKey(code);
        return true;
      }
      var component = level === 0 && mode !== 'mylist' ? filters : level === 1 ? sorts : grid;
      return component ? component.handleKey(code) : false;
    }
    return {
      el: el,
      show: show,
      hide: hide,
      focus: focus,
      hideFocus: hideFocus,
      refresh: refresh,
      handleKey: handleKey
    };
  });
})();
