/**
 * Finds the EXPLAIN plan in text the user pointed at (a selection, a file, the clipboard, the
 * terminal). The text may be a psql session: the statement above the plan, a prompt below it.
 */
import type { IPlanContent } from '@/interfaces';
import { PlanService } from '@/services/plan-service';

export interface FoundPlan {
  /** What EXPLAIN printed, in the text or JSON format, with psql's header and borders if any. */
  source: string;
  /** The statement that was explained, when it stands above the plan; otherwise ''. */
  query: string;
  /** For the tab: the top node and, when the plan was run with ANALYZE, how long it took. */
  title: string;
}

/** Returns undefined when the text holds no plan that the visualizer can read. */
export function findPlan(text: string): FoundPlan | undefined {
  const { source, query } = splitSession(text);
  let content: IPlanContent;
  try {
    content = new PlanService().fromSource(source) as IPlanContent;
  } catch {
    return undefined;
  }
  // EXPLAIN (VERBOSE, FORMAT JSON) carries the statement in the plan itself; the visualizer prefers that one.
  return { source, query, title: titleOf(content) };
}

// psql's column header, with or without a border.
const HEADER = /^[ \t]*[|│║]?[ \t]*QUERY PLAN[ \t]*[|│║]?[ \t]*$/m;
// psql's row count, "(12 rows)", whatever the language.
const ROW_COUNT = /^[ \t]*\(\d+ [^\s()]+\)[ \t]*$/m;

/**
 * Cuts a psql session into the statement and the plan. Text without psql's "QUERY PLAN" header
 * is taken to be just a plan.
 */
export function splitSession(text: string): { source: string; query: string } {
  const header = HEADER.exec(text);
  if (!header) {
    return { source: text, query: '' };
  }
  let source = text.slice(header.index);
  // Whatever follows the row count (\timing's "Time:", the next prompt) is not the plan.
  const rowCount = ROW_COUNT.exec(source);
  if (rowCount) {
    source = source.slice(0, rowCount.index + rowCount[0].length);
  }
  return { source, query: statementIn(text.slice(0, header.index)) };
}

/** The last EXPLAIN statement in the text above a plan, without psql's prompts. */
function statementIn(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    // "mydb=# EXPLAIN ..." (also "mydb=> ", and "mydb=*# " inside a transaction), or no prompt.
    const first = /^[ \t]*(?:(\S*)[=^!][*!?]?[#>] ?)?(EXPLAIN\b.*)$/i.exec(lines[i]);
    if (!first) {
      continue;
    }
    const statement = [first[2]];
    if (first[1] !== undefined) {
      // The prompt of the lines that follow: "mydb-# ", or "mydb(# " inside parentheses.
      const database = first[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const continuation = new RegExp(`^[ \\t]*${database}[-*'"$(][*!?]?[#>] ?`);
      statement.push(...lines.slice(i + 1).map((line) => line.replace(continuation, '')));
    } else {
      statement.push(...lines.slice(i + 1));
    }
    return statement.join('\n').trim();
  }
  return '';
}

function titleOf(content: IPlanContent): string {
  const type = String(content.Plan['Node Type']);
  const ms = content['Execution Time'] ?? content['Total Runtime'];
  return typeof ms === 'number' ? `Plan: ${type} (${formatDuration(ms)})` : `Plan: ${type}`;
}

/** 0.15 -> "0.15 ms", 1234 -> "1.23 s", 125000 -> "2 min 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Number(ms.toPrecision(3))} ms`;
  }
  if (ms < 60_000) {
    return `${Number((ms / 1000).toPrecision(3))} s`;
  }
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
