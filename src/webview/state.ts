/**
 * What the page in a tab shows and remembers, and what it says to the extension.
 *
 * A tab has a history, like a browser tab: the home page with its form, the plan drawn from it,
 * the home page again, and so on. The Back and Forward buttons move along it.
 */
import { computed, reactive } from 'vue';

export type Theme = 'dark' | 'light';

/** A plan to draw. */
export interface Shown {
  title: string;
  source: string;
  query: string;
  comment: string;
}

/** The fields of the form on the home page. */
export interface Form {
  name: string;
  plan: string;
  query: string;
  comment: string;
}

export interface SavedSummary {
  id: string;
  name: string;
  created: string;
}

/** One step of the history: a plan with the form it came from, or (with neither) the home page. */
interface Page {
  plan?: Shown;
  form?: Form;
  /** Which of the saved plans this one is, once the Save Plan button has been used on it. */
  savedId?: string;
}

const vscode = acquireVsCodeApi();
const HOME_TITLE = 'Explain Visualizer';
const emptyForm = (): Form => ({ name: '', plan: '', query: '', comment: '' });

export const state = reactive({
  /** False until the extension has said what to start with. */
  loaded: false,
  // The extension writes the look to start with into the page: dark, unless light was chosen before.
  theme: (document.documentElement.dataset.bsTheme === 'light' ? 'light' : 'dark') as Theme,
  pages: [{}] as Page[],
  /** Which of the pages is on screen. */
  at: 0,
  form: emptyForm(),
  /** The form was submitted with text that isn't a plan. */
  invalid: false,
  saved: [] as SavedSummary[],
  /** The saved plan that is in the form to be changed, after its pencil was used. */
  editing: undefined as { id: string; name: string } | undefined,
});
/** What the form held before a saved plan was put into it; Cancel brings it back. */
let formBeforeEditing: Form | undefined;

export const page = computed(() => state.pages[state.at]);
export const canGoBack = computed(() => state.at > 0);
export const canGoForward = computed(() => state.at < state.pages.length - 1);
/** Whether the plan on screen is among the saved plans (and hasn't been deleted from them since). */
export const isSaved = computed(() => {
  const id = page.value.savedId;
  return id !== undefined && state.saved.some((saved) => saved.id === id);
});

/** After every move along the history. */
function arrive(): void {
  const { plan, form } = page.value;
  if (form) {
    // The form holds the plan that was last on screen, to change and submit again.
    state.form = { ...form };
  }
  state.invalid = false;
  state.editing = undefined;
  // The visualizer opens the tab named in the address (#grid, ...). Every plan starts on its Plan tab.
  if (window.location.hash) {
    window.location.hash = '';
  }
  vscode.postMessage({ type: 'title', title: plan ? plan.title : HOME_TITLE });
}

/** Goes to a new page. As in a browser, that drops the pages that Forward would have gone to. */
function visit(next: Page): void {
  state.pages.splice(state.at + 1);
  state.pages.push(next);
  state.at = state.pages.length - 1;
  arrive();
}

export function goBack(): void {
  if (canGoBack.value) {
    state.at--;
    arrive();
  }
}

export function goForward(): void {
  if (canGoForward.value) {
    state.at++;
    arrive();
  }
}

/** The home page with an empty form. (Back returns to the form as it was.) */
export function newPlan(): void {
  visit({});
  state.form = emptyForm();
}

export function submit(): void {
  vscode.postMessage({ type: 'submit', form: { ...state.form } });
}

/** Keeps the plan on screen. Nothing is saved without this. */
export function savePlan(): void {
  const { plan, form } = page.value;
  if (plan && form) {
    vscode.postMessage({ type: 'save', page: state.at, form: { ...form }, title: plan.title });
  }
}

export function openSaved(id: string): void {
  vscode.postMessage({ type: 'open', id });
}

/** The pencil: the saved plan goes into the form, to be changed and saved back. */
export function editSaved(id: string): void {
  vscode.postMessage({ type: 'edit', id });
}

export function saveChanges(): void {
  if (state.editing) {
    vscode.postMessage({ type: 'update', id: state.editing.id, form: { ...state.form } });
  }
}

export function cancelEditing(): void {
  state.editing = undefined;
  state.form = formBeforeEditing ?? emptyForm();
  state.invalid = false;
}

export function deleteSaved(id: string): void {
  vscode.postMessage({ type: 'delete', id });
}

function show(look: Theme): void {
  state.theme = look;
  document.documentElement.dataset.bsTheme = look;
}

export function toggleTheme(): void {
  show(state.theme === 'dark' ? 'light' : 'dark');
  // The extension remembers the choice and passes it on to the other open tabs.
  vscode.postMessage({ type: 'theme', theme: state.theme });
}

/** Starts listening to the extension and tells it that the page is ready. */
export function connect(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data;
    switch (message?.type) {
      case 'init':
        // A tab opened on a plan has the home page behind it.
        state.pages = message.plan ? [{}, { plan: message.plan, form: message.form }] : [{}];
        state.at = state.pages.length - 1;
        state.saved = message.saved ?? [];
        state.loaded = true;
        arrive();
        break;
      case 'plan':
        // The form was a plan, or a saved plan was opened.
        visit({ plan: message.plan, form: message.form, savedId: message.savedId });
        break;
      case 'kept': {
        // The plan on that page of the history has been saved.
        const kept = state.pages[message.page];
        if (kept?.plan) {
          kept.savedId = message.id;
        }
        break;
      }
      case 'invalid':
        state.invalid = true;
        break;
      case 'form':
        // A saved plan that can't be drawn any more.
        state.form = { ...message.form };
        state.invalid = Boolean(message.invalid);
        break;
      case 'edit':
        if (!state.editing) {
          formBeforeEditing = { ...state.form };
        }
        state.form = { ...message.form };
        state.editing = { id: message.id, name: message.form.name };
        state.invalid = false;
        break;
      case 'updated':
        // The changes are saved. The form keeps them, to draw the plan with Submit.
        if (state.editing?.id === message.id) {
          state.editing = undefined;
          state.form = { ...message.form };
        }
        break;
      case 'saved': {
        const saved: SavedSummary[] = message.saved ?? [];
        state.saved = saved;
        if (state.editing && !saved.some((plan) => plan.id === state.editing?.id)) {
          state.editing = undefined; // it was deleted while in the form
        }
        break;
      }
      case 'theme':
        show(message.theme === 'light' ? 'light' : 'dark');
        break;
    }
  });
  vscode.postMessage({ type: 'ready' });
}
