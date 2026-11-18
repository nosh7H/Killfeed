import { h, clear } from '../ui.js';

/**
 * Sortable table.
 * columns: [{ key, label, tip, get(row), fmt(value,row), num, bar, cls, render(row) }]
 */
export function sortTable(columns, rows, { sort = null, desc = true, empty = 'No data yet', onRow = null } = {}) {
  let sortKey = sort, sortDesc = desc;
  const wrap = h('div', { class: 'table-wrap' });
  const val = (c, r) => (c.get ? c.get(r) : r[c.key]);

  const render = () => {
    clear(wrap);
    if (!rows.length) { wrap.append(h('div', { class: 'empty-sm' }, empty)); return; }
    const sorted = [...rows];
    const col = columns.find(c => c.key === sortKey);
    if (col) sorted.sort((a, b) => {
      const va = val(col, a), vb = val(col, b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sortDesc ? -cmp : cmp;
    });
    const maxes = Object.fromEntries(columns.filter(c => c.bar).map(c => [c.key, Math.max(0, ...rows.map(r => Number(val(c, r)) || 0))]));
    wrap.append(h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, columns.map(c => h('th', {
        class: [c.num ? 'num' : '', sortKey === c.key ? 'sorted' : ''].join(' '),
        'data-tip': c.tip || null, tabindex: 0, role: 'button', 'aria-sort': sortKey === c.key ? (sortDesc ? 'descending' : 'ascending') : 'none',
        onclick: () => { if (sortKey === c.key) sortDesc = !sortDesc; else { sortKey = c.key; sortDesc = !!c.num; } render(); },
        onkeydown: e => { if (e.key === 'Enter') e.target.click(); },
      }, c.label, sortKey === c.key ? (sortDesc ? ' ▾' : ' ▴') : '')))),
      h('tbody', {}, sorted.map(r => h('tr', { class: onRow ? 'clickable' : '', onclick: onRow ? () => onRow(r) : null },
        columns.map(c => {
          const v = val(c, r);
          const content = c.render ? c.render(r) : (c.fmt ? c.fmt(v, r) : (v ?? '–'));
          if (c.bar && v != null) {
            const pct = maxes[c.key] ? Math.max(2, (Number(v) / maxes[c.key]) * 100) : 0;
            return h('td', { class: 'num bar-cell' },
              h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { width: `${pct}%` } })),
              h('span', { class: 'bar-val' }, content));
          }
          return h('td', { class: [c.num ? 'num' : '', c.cls || ''].join(' ') }, content);
        }))))));
  };
  render();
  return wrap;
}
