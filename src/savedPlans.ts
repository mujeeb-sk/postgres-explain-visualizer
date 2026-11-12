/**
 * The plans kept with the Save Plan button. (Nothing is saved without it.) They are in one JSON
 * file in the extension's storage folder, newest first; these functions are what happens to
 * that list.
 */
export interface SavedPlan {
  id: string;
  name: string;
  /** The Plan, Query and Comments fields of the form, as they were typed. */
  plan: string;
  query: string;
  comment: string;
  /** When it was saved, as an ISO date. */
  created: string;
}

/** What the home page lists; the plans themselves stay with the extension until one is opened. */
export type SavedSummary = Pick<SavedPlan, 'id' | 'name' | 'created'>;

const FIELDS = ['id', 'name', 'plan', 'query', 'comment', 'created'] as const;

/** Reads the file's text. Anything in it that isn't a saved plan is left out. */
export function parseSaved(json: string): SavedPlan[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter(
    (entry): entry is SavedPlan =>
      typeof entry === 'object' && entry !== null && FIELDS.every((field) => typeof entry[field] === 'string'),
  );
}

/** The saved plan with this name, plan, query and comment, if it is there already. */
export function findSame(saved: SavedPlan[], fields: Pick<SavedPlan, 'name' | 'plan' | 'query' | 'comment'>): SavedPlan | undefined {
  return saved.find(
    (other) =>
      other.name === fields.name && other.plan === fields.plan && other.query === fields.query && other.comment === fields.comment,
  );
}

export function withPlan(saved: SavedPlan[], plan: SavedPlan): SavedPlan[] {
  return [plan, ...saved];
}

/** The list after that plan was edited: its place and the day it was saved stay as they are. */
export function withChanges(
  saved: SavedPlan[],
  id: string,
  fields: Pick<SavedPlan, 'name' | 'plan' | 'query' | 'comment'>,
): SavedPlan[] {
  return saved.map((plan) => (plan.id === id ? { ...plan, ...fields } : plan));
}

export function withoutPlan(saved: SavedPlan[], id: string): SavedPlan[] {
  return saved.filter((plan) => plan.id !== id);
}

export function summaries(saved: SavedPlan[]): SavedSummary[] {
  return saved.map(({ id, name, created }) => ({ id, name, created }));
}
