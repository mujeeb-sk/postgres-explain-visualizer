/**
 * What the extension makes of the text it is pointed at, before the visualizer gets it. The
 * fixtures are psql output from PostgreSQL 18.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, test } from 'vitest';

import { findPlan, formatDuration, splitSession } from '../../planText';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../fixtures', name), 'utf8');

const STATEMENT = `EXPLAIN (ANALYZE, BUFFERS)
SELECT c.name, count(*) AS orders, sum(o.total) AS spent
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.created_at >= date '2026-06-01'
  AND c.country = 'IN'
GROUP BY c.name
ORDER BY spent DESC
LIMIT 10;`;

const BARE = `Aggregate  (cost=12.50..12.51 rows=1 width=8)
  ->  Seq Scan on employees  (cost=0.00..10.00 rows=1000 width=0)`;

describe('a psql session', () => {
  const found = findPlan(fixture('session.txt'));

  test('the statement is taken from above the plan, without the prompts', () => {
    expect(found?.query).toBe(STATEMENT);
  });

  test('the plan runs from the header to the row count', () => {
    const lines = found!.source.split('\n');
    expect(lines[0].trim()).toBe('QUERY PLAN');
    expect(lines.at(-1)).toBe('(32 rows)');
    expect(found!.source).not.toContain('Time: 47.906 ms');
    expect(found!.source).not.toContain('shop=#');
  });

  test('the title names the top node and the execution time', () => {
    expect(found?.title).toBe('Plan: Limit (36.8 ms)');
  });

  test('prompts inside a transaction and inside parentheses', () => {
    const session = `shop=*# EXPLAIN SELECT count(*) FROM (\nshop(*# SELECT 1\nshop(*# ) s;\n   QUERY PLAN\n---\n ${BARE.replace(/\n/g, '\n ')}\n(2 rows)\n`;
    expect(splitSession(session).query).toBe('EXPLAIN SELECT count(*) FROM (\nSELECT 1\n) s;');
  });

  test('a prompt for a role that is not a superuser', () => {
    expect(splitSession(`app=> explain select 1;\n QUERY PLAN\n---\n Result\n`).query).toBe('explain select 1;');
  });

  test('without prompts, as in the output of psql -a or -e', () => {
    const session = `EXPLAIN\nSELECT a->b FROM t\nWHERE a->>'k' = '1';\n   QUERY PLAN\n---\n ${BARE.replace(/\n/g, '\n ')}\n`;
    expect(splitSession(session).query).toBe("EXPLAIN\nSELECT a->b FROM t\nWHERE a->>'k' = '1';");
  });

  test('of several statements, the one right above the plan', () => {
    const session = `shop=# EXPLAIN SELECT 1;\nERROR:  nope\nshop=# EXPLAIN SELECT 2;\n QUERY PLAN\n---\n Result  (cost=0.00..0.01 rows=1 width=4)\n(1 row)\n`;
    const found = findPlan(session);
    expect(found?.query).toBe('EXPLAIN SELECT 2;');
    expect(found?.title).toBe('Plan: Result');
  });

  test('no statement above the plan', () => {
    const session = fixture('session.txt');
    expect(findPlan(session.slice(session.indexOf('QUERY PLAN') - 40))?.query).toBe('');
  });
});

describe('other shapes of EXPLAIN output', () => {
  test('just the plan lines', () => {
    expect(findPlan(BARE)).toEqual({ source: BARE, query: '', title: 'Plan: Aggregate' });
  });

  test('the JSON format, as psql prints it', () => {
    expect(findPlan(fixture('json.txt'))?.title).toBe('Plan: Limit');
  });

  test('the JSON format on its own', () => {
    const json = JSON.stringify([{ Plan: { 'Node Type': 'Result', 'Total Cost': 0.01 }, 'Execution Time': 1234.5 }]);
    expect(findPlan(json)).toEqual({ source: json, query: '', title: 'Plan: Result (1.23 s)' });
  });

  test('with a border around it (\\pset border 2)', () => {
    const found = findPlan(fixture('border2.txt'));
    expect(found?.title).toBe('Plan: Limit');
    expect(found?.source).toMatch(/^\|\s+QUERY PLAN\s+\|$/m);
  });
});

describe('text that is not a plan', () => {
  test.each([
    ['nothing', ''],
    ['prose', 'hello world\nthis is not a plan'],
    ['a statement', 'SELECT * FROM orders WHERE total > 100;'],
    ['code', "import * as vscode from 'vscode';\nexport function activate(): void {\n  run(1);\n}\n"],
    ['other JSON', '{"name": "postgres-explain-visualizer"}'],
    ['a header with nothing under it', 'shop=# EXPLAIN SELECT 1;\n QUERY PLAN\n------------\n'],
  ])('%s', (_name, text) => {
    expect(findPlan(text)).toBeUndefined();
  });
});

test('durations', () => {
  expect(formatDuration(0.15)).toBe('0.15 ms');
  expect(formatDuration(36.764)).toBe('36.8 ms');
  expect(formatDuration(1234.5)).toBe('1.23 s');
  expect(formatDuration(125_000)).toBe('2 min 5 s');
});
