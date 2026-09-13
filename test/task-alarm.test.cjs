/** Deterministic tests for the Thunderbird task alarm adapter. */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiSource = fs.readFileSync(
  path.resolve(__dirname, '../extension/mcp_server/api.js'), 'utf8'
);
const start = apiSource.indexOf('// BEGIN TASK ALARM HELPERS');
const end = apiSource.indexOf('// END TASK ALARM HELPERS', start);
assert.ok(start >= 0 && end > start, 'task alarm helper markers missing');

class FakeAlarm {
  constructor() {
    this.action = null;
    this.related = null;
    this.offset = null;
    this.alarmDate = null;
  }
}

function loadHelpers() {
  const sandbox = {
    CalAlarm: FakeAlarm,
    Ci: { calIAlarm: { ALARM_RELATED_START: 0, ALARM_RELATED_END: 1, ALARM_RELATED_ABSOLUTE: 2 } },
    cal: {
      createDuration(icalString) {
        const sign = icalString.startsWith('-') ? -1 : 1;
        const minutes = Number(icalString.replace(/^-?PT|M$/g, ''));
        return { icalString, inSeconds: sign * minutes * 60 };
      },
      dtz: {
        defaultTimezone: 'Europe/Rome',
        jsDateToDateTime(date) {
          return { nativeTime: date.getTime() * 1000, icalString: date.toISOString() };
        },
      },
    },
    calDateToISO(date) {
      return new Date(date.nativeTime / 1000).toISOString();
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(apiSource.slice(start, end), sandbox);
  return sandbox;
}

function fakeItem(dueDate = { nativeTime: Date.parse('2026-09-03T10:00:00Z') * 1000 }) {
  return {
    dueDate,
    alarms: [],
    clearAlarms() { this.alarms = []; },
    addAlarm(alarm) { this.alarms.push(alarm); },
    getAlarms() { return this.alarms; },
  };
}

describe('Task alarm adapter', () => {
  it('creates a DISPLAY alarm relative to the task due date', () => {
    const helpers = loadHelpers();
    const item = fakeItem();
    assert.equal(helpers.configureTaskAlarm(item, { minutesBefore: 30 }), null);
    assert.equal(item.alarms.length, 1);
    assert.equal(item.alarms[0].action, 'DISPLAY');
    assert.equal(item.alarms[0].related, 1);
    assert.equal(item.alarms[0].offset.inSeconds, -1800);
  });

  it('creates an absolute alarm and clears existing alarms when replaced', () => {
    const helpers = loadHelpers();
    const item = fakeItem();
    item.alarms.push({ old: true });
    assert.equal(helpers.configureTaskAlarm(item, { dateTime: '2026-09-03T09:45:00Z' }), null);
    assert.equal(item.alarms.length, 1);
    assert.equal(item.alarms[0].related, 2);
    assert.equal(item.alarms[0].alarmDate.nativeTime, Date.parse('2026-09-03T09:45:00Z') * 1000);
    assert.equal(JSON.stringify(helpers.formatTaskAlarm(item)), JSON.stringify({ dateTime: '2026-09-03T09:45:00.000Z' }));
  });

  it('clears alarms with null and rejects relative alarms without a due date', () => {
    const helpers = loadHelpers();
    const item = fakeItem();
    item.alarms.push({ old: true });
    assert.equal(helpers.configureTaskAlarm(item, null), null);
    assert.equal(item.alarms.length, 0);
    assert.match(helpers.configureTaskAlarm(fakeItem(null), { minutesBefore: 1 }), /requires a task dueDate/);
  });
});
