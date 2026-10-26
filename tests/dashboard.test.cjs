'use strict';
// FireTime Pro: source-level dashboard regressions. No live backend, secrets or customer data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const begin = html.indexOf('function ftHomeDate_(');
const end = html.indexOf('function profileFields(', begin);
assert.ok(begin !== -1 && end > begin, 'Dashboard functions must be present');
const dashboardSource = html.slice(begin, end);

function fixture(role = 'STAFF', shifts = [], workShifts = []) {
  const me = { id: 'u1', role, name: 'Mitarbeiter 1', leaveBalance: 11, leaveEntitlement: 25 };
  const users = [me, { id: 'u2', role: 'STAFF', name: 'Mitarbeiter 2' }];
  const ST = {
    month: '2026-10',
    h: {
      me, company: { id: 'companyA', name: 'Testfirma' }, users,
      shifts, workShifts, companies: [],
      modules: ['STANDBY', 'WORKPLAN', 'LEAVE', 'TIME', 'REPORTS'],
      reports: { u1: { target: 25, worked: 20, saldo: -5, standby: 60 } }
    }
  };
  const sandbox = {
    ST, Date, FT_DASHBOARD_LOADING: false,
    me: () => ST.h.me,
    firm: () => ST.h.company,
    isAdmin: () => ST.h.me.role !== 'STAFF',
    has: module => ST.h.modules.includes(module),
    who: id => users.find(u => u.id === id) || { name: 'Unbekannt' },
    E: value => String(value ?? '').replace(/[&<>"']/g, x => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[x])),
    N: value => String(Number(value || 0)),
    hint: value => value,
    ftPdfMonthLabel: () => 'Oktober 2026',
    ftViennaParts: stamp => {
      const d = new Date(stamp);
      return Number.isFinite(d.getTime()) ? {
        day: String(d.getUTCDate()).padStart(2, '0'),
        month: String(d.getUTCMonth() + 1).padStart(2, '0'),
        hour: String(d.getUTCHours()).padStart(2, '0'),
        minute: String(d.getUTCMinutes()).padStart(2, '0')
      } : null;
    }
  };
  const api = vm.runInNewContext(dashboardSource +
    '\n({ ftHomeUpcoming_, ftHomeSchedule_, dashboard })', sandbox);
  return { api, ST };
}
const day = n => new Date(Date.now() + n * 86400000).toISOString();
const shift = (id, start, end, userId = 'u1', status = 'PUBLISHED') =>
  ({ id, start: day(start), end: day(end), userId, status });

test('entire inline application JavaScript remains syntactically valid', () => {
  const start = html.indexOf('<script>');
  const endScript = html.lastIndexOf('</script>');
  assert.ok(start >= 0 && endScript > start);
  assert.doesNotThrow(() => new vm.Script(html.slice(start + 8, endScript)));
});

test('employee sees only own next 3 published duties, ordered by start', () => {
  const entries = [
    shift('old', -6, -5),
    shift('five', 5, 6),
    shift('three', 3, 4),
    shift('one', 1, 2),
    shift('two', 2, 3),
    shift('otherPerson', .5, 1, 'u2'),
    shift('draft', .25, 1, 'u1', 'DRAFT')
  ];
  const { api } = fixture('STAFF', entries);
  assert.equal(api.ftHomeUpcoming_(entries, 'STANDBY', 3).map(s => s.id).join(','),
    'one,two,three');
  const output = api.dashboard();
  assert.equal((output.match(/class="ft-home-shift-row"/g) || []).length, 3);
  assert.match(output, /data-act="homeOpenStandby"/);
  assert.doesNotMatch(output, /Mitarbeiter 2/);
});

test('running duty remains visible with a clear status', () => {
  const { api } = fixture('STAFF', [shift('ongoing', -.1, .1)]);
  assert.match(api.ftHomeSchedule_('STANDBY'), /Läuft gerade/);
});

test('admin sees company-wide next duties and company metrics, not personal hours', () => {
  const entries = [
    shift('later', 2, 3),
    shift('first', .5, 1, 'u2'),
    shift('second', 1, 2),
    shift('draft', .1, 1, 'u2', 'DRAFT')
  ];
  const { api } = fixture('ADMIN', entries);
  assert.equal(api.ftHomeUpcoming_(entries, 'STANDBY', 3).map(s => s.id).join(','),
    'first,second,later');
  const output = api.dashboard();
  assert.match(output, /Nächste Bereitschaften der Firma/);
  assert.match(output, /Mitarbeiter 2/);
  assert.match(output, /Bereitschaften im Monat \\(geplant\\)/);
  assert.match(output, /Personal & laufende Dienste/);
  assert.doesNotMatch(output, /Monatssoll/);
  assert.doesNotMatch(output, /Plus\/Minus/);
});

test('staff gets personal monthly hours, not admin statistics', () => {
  const { api } = fixture();
  const output = api.dashboard();
  assert.match(output, /Monatssoll/);
  assert.match(output, /Bereitschaft netto/);
  assert.doesNotMatch(output, /Bereitschaften im Monat \\(geplant\\)/);
});

test('empty state stays concise with full-plan navigation', () => {
  const { api } = fixture();
  const output = api.ftHomeSchedule_('STANDBY');
  assert.match(output, /noch keine Bereitschaften veröffentlicht/);
  assert.match(output, /Plan öffnen/);
  assert.doesNotMatch(output, /class="ft-home-shift-row"/);
});
