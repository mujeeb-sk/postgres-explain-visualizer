/** The list of saved plans, and the sample plans offered on the home page. */
import { describe, expect, test } from 'vitest';

import { findPlan } from '../../planText';
import { findSame, parseSaved, type SavedPlan, summaries, withChanges, withoutPlan, withPlan } from '../../savedPlans';
import samples from '../../webview/samples';

const saved = (id: string, changes: Partial<SavedPlan> = {}): SavedPlan => ({
  id,
  name: `plan ${id}`,
  plan: 'Result  (cost=0.00..0.01 rows=1 width=4)',
  query: 'select 1',
  comment: '',
  created: '2026-11-12T10:00:00.000Z',
  ...changes,
});

describe('the file of saved plans', () => {
  test('is read back as it was written', () => {
    const plans = [saved('a'), saved('b', { comment: 'slow on Mondays' })];
    expect(parseSaved(JSON.stringify(plans))).toEqual(plans);
  });

  test.each([
    ['empty', ''],
    ['cut short', '[{"id": "a", "name": '],
    ['not a list', '{"id": "a"}'],
  ])('%s: no plans', (_name, text) => {
    expect(parseSaved(text)).toEqual([]);
  });

  test('entries that are not saved plans are left out', () => {
    const { query: _query, ...withoutQuery } = saved('b');
    expect(parseSaved(JSON.stringify([saved('a'), null, 'text', withoutQuery, { ...saved('c'), name: 3 }, saved('d')]))).toEqual([
      saved('a'),
      saved('d'),
    ]);
  });
});

describe('saving and deleting', () => {
  test('a new plan goes first', () => {
    expect(withPlan([saved('a'), saved('b')], saved('c')).map((plan) => plan.id)).toEqual(['c', 'a', 'b']);
  });

  test('a plan that is saved already is found, whenever it was saved', () => {
    const again = saved('new', { name: 'plan a', created: '2026-11-13T09:00:00.000Z' });
    expect(findSame([saved('b'), saved('a')], again)).toEqual(saved('a'));
  });

  test.each(['name', 'plan', 'query', 'comment'] as const)('a different %s makes it another plan', (field) => {
    const other = saved('new', { name: 'plan a', [field]: 'something else' });
    expect(findSame([saved('a')], other)).toBeUndefined();
  });

  test('editing changes that plan where it is, and nothing else about it', () => {
    const fields = { name: 'renamed', plan: 'Result', query: '', comment: 'fast on Tuesdays' };
    expect(withChanges([saved('a'), saved('b'), saved('c')], 'b', fields)).toEqual([saved('a'), saved('b', fields), saved('c')]);
    expect(withChanges([saved('a')], 'gone', fields)).toEqual([saved('a')]);
  });

  test('deleting takes out that plan only', () => {
    expect(withoutPlan([saved('a'), saved('b'), saved('c')], 'b').map((plan) => plan.id)).toEqual(['a', 'c']);
    expect(withoutPlan([saved('a')], 'gone')).toEqual([saved('a')]);
  });

  test('the home page is given the names and dates, not the plans', () => {
    expect(summaries([saved('a')])).toEqual([{ id: 'a', name: 'plan a', created: '2026-11-12T10:00:00.000Z' }]);
  });
});

describe('the sample plans', () => {
  test('there are some', () => {
    expect(samples.length).toBeGreaterThan(5);
  });

  test.each(samples.map((sample) => [sample[0], sample[1]]))('%s can be drawn', (_name, plan) => {
    expect(findPlan(plan)?.title).toMatch(/^Plan: \S/);
  });
});
