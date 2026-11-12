import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { findPlan, type FoundPlan } from './planText';
import { findSame, parseSaved, type SavedPlan, summaries, withChanges, withoutPlan, withPlan } from './savedPlans';

/** Opens a tab: on the plan, or on the home page when there is none. */
type Open = (plan: FoundPlan | undefined, column: vscode.ViewColumn) => void;

export function activate(context: vscode.ExtensionContext): unknown {
  const didOpenPanel = new vscode.EventEmitter<vscode.WebviewPanel>();
  const open: Open = (plan, column) => didOpenPanel.fire(openPanel(context, plan, column));
  context.subscriptions.push(
    didOpenPanel,
    vscode.commands.registerCommand('explainVisualizer.open', () => open(undefined, vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('explainVisualizer.visualize', () => visualize(open)),
    vscode.commands.registerCommand('explainVisualizer.visualizeTerminalSelection', () => visualizeTerminalSelection(open)),
  );
  // The integration tests look into the panels; nothing is exported otherwise.
  return context.extensionMode === vscode.ExtensionMode.Test ? { onDidOpenPanel: didOpenPanel.event } : undefined;
}

export function deactivate(): void {}

const NOTHING_FOUND =
  "No EXPLAIN plan found. Select EXPLAIN's output in an editor (or copy it to the clipboard) and run the command again, or paste it on the visualizer's home page.";
const OPEN_HOME = 'Open Visualizer';
const NOT_A_PLAN =
  "The selection isn't an EXPLAIN plan that can be shown. Select all of EXPLAIN's output, in the text or JSON format, and run the command again.";

/** The selection, else the whole editor when it holds a plan, else the clipboard. */
async function visualize(open: Open): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selected = editor.selections.filter((s) => !s.isEmpty);
    if (selected.length > 0) {
      const plan = findPlan(selected.map((s) => editor.document.getText(s)).join('\n'));
      if (plan) {
        open(plan, vscode.ViewColumn.Beside);
      } else {
        void vscode.window.showWarningMessage(NOT_A_PLAN);
      }
      return;
    }
    const plan = findPlan(editor.document.getText());
    if (plan) {
      open(plan, vscode.ViewColumn.Beside);
      return;
    }
  }
  const plan = findPlan(await vscode.env.clipboard.readText());
  if (plan) {
    open(plan, vscode.ViewColumn.Active);
  } else {
    void vscode.window.showWarningMessage(NOTHING_FOUND, OPEN_HOME).then((choice) => {
      if (choice === OPEN_HOME) {
        open(undefined, vscode.ViewColumn.Active);
      }
    });
  }
}

async function visualizeTerminalSelection(open: Open): Promise<void> {
  // The terminal API doesn't expose the selection; copying it is what ⌘C / Ctrl+C would do anyway.
  await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
  const plan = findPlan(await vscode.env.clipboard.readText());
  if (plan) {
    open(plan, vscode.ViewColumn.Active);
  } else {
    void vscode.window.showWarningMessage(NOT_A_PLAN);
  }
}

// What the extension and the page in a tab say to each other. The page keeps the tab's history
// (home page, plan, home page, ...); the extension reads the plans and keeps the ones that
// the Save Plan button is used on.

/** The fields of the form on the home page. */
interface Form {
  name: string;
  plan: string;
  query: string;
  comment: string;
}

/** A plan for the page to draw. */
interface Shown {
  title: string;
  source: string;
  query: string;
  comment: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function formOf(value: unknown): Form {
  const fields = (value ?? {}) as Record<string, unknown>;
  return { name: text(fields.name), plan: text(fields.plan), query: text(fields.query), comment: text(fields.comment) };
}

function shown(found: FoundPlan, form: Form, title: string): Shown {
  // A statement typed into the form wins over one found above the plan.
  return { title, source: found.source, query: form.query.trim() || found.query, comment: form.comment.trim() };
}

type Theme = 'dark' | 'light';
const THEME = 'theme';
const HOME_TITLE = 'Explain Visualizer';
/** The open tabs. Each command opens another one. */
const panels = new Set<vscode.WebviewPanel>();

const savedFile = (context: vscode.ExtensionContext) => vscode.Uri.joinPath(context.globalStorageUri, 'plans.json');

async function readSaved(context: vscode.ExtensionContext): Promise<SavedPlan[]> {
  try {
    return parseSaved(new TextDecoder().decode(await vscode.workspace.fs.readFile(savedFile(context))));
  } catch {
    return []; // nothing saved yet
  }
}

let lastChange: Promise<unknown> = Promise.resolve();
/** Changes the saved plans, one change at a time, and shows the new list on every home page. */
function changeSaved(context: vscode.ExtensionContext, change: (saved: SavedPlan[]) => SavedPlan[]): Promise<void> {
  const done = lastChange.then(async () => {
    const saved = change(await readSaved(context));
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(savedFile(context), new TextEncoder().encode(JSON.stringify(saved, null, 1)));
    for (const panel of panels) {
      void panel.webview.postMessage({ type: 'saved', saved: summaries(saved) });
    }
  });
  lastChange = done.catch(() => undefined);
  return done;
}

function openPanel(context: vscode.ExtensionContext, initial: FoundPlan | undefined, column: vscode.ViewColumn): vscode.WebviewPanel {
  const testing = context.extensionMode === vscode.ExtensionMode.Test;
  const webviewDir = vscode.Uri.joinPath(context.extensionUri, 'out', 'webview');
  const probeDir = vscode.Uri.joinPath(context.extensionUri, 'out', 'test', 'integration');
  const panel = vscode.window.createWebviewPanel('explainVisualizer.plan', initial?.title ?? HOME_TITLE, column, {
    enableScripts: true,
    // Keeps the page as it is (its history, the form, the zoom) while the tab is in the background.
    retainContextWhenHidden: true,
    localResourceRoots: testing ? [webviewDir, probeDir] : [webviewDir],
  });
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');

  panels.add(panel);
  panel.onDidDispose(() => panels.delete(panel));

  const { webview } = panel;
  const post = (message: unknown) => void webview.postMessage(message);

  async function receive(message: Record<string, unknown> | undefined): Promise<void> {
    switch (message?.type) {
      case 'ready':
        // The page has loaded. A tab opened on a plan has the home page behind it, with the plan in its form.
        post({
          type: 'init',
          plan: initial && { title: initial.title, source: initial.source, query: initial.query, comment: '' },
          form: initial && { name: '', plan: initial.source, query: initial.query, comment: '' },
          saved: summaries(await readSaved(context)),
        });
        return;

      case 'title':
        // The page went to another page of its history.
        panel.title = text(message.title) || HOME_TITLE;
        return;

      case 'theme': {
        // The dark/light button was used: remember the choice and switch the other tabs too.
        const theme: Theme = message.theme === 'light' ? 'light' : 'dark';
        await context.globalState.update(THEME, theme);
        for (const other of panels) {
          if (other !== panel) {
            void other.webview.postMessage({ type: 'theme', theme });
          }
        }
        return;
      }

      case 'submit': {
        // The form of the home page.
        const form = formOf(message.form);
        const found = findPlan(form.plan);
        post(found ? { type: 'plan', plan: shown(found, form, form.name.trim() || found.title), form } : { type: 'invalid' });
        return;
      }

      case 'save': {
        // The Save Plan button beside a plan: keep the form it was drawn from, under its title.
        const form = formOf(message.form);
        const fields = { ...form, name: form.name.trim() || text(message.title) };
        let id = '';
        await changeSaved(context, (saved) => {
          const same = findSame(saved, fields);
          id = same?.id ?? crypto.randomUUID();
          return same ? saved : withPlan(saved, { id, ...fields, created: new Date().toISOString() });
        });
        // The page marks that plan as saved, by the place it has in the tab's history.
        post({ type: 'kept', page: message.page, id });
        return;
      }

      case 'open':
      case 'edit': {
        // A saved plan: draw it, or (the pencil) put it into the form to be changed.
        const saved = (await readSaved(context)).find((plan) => plan.id === message.id);
        if (!saved) {
          return; // deleted in another window
        }
        const form: Form = { name: saved.name, plan: saved.plan, query: saved.query, comment: saved.comment };
        if (message.type === 'edit') {
          post({ type: 'edit', id: saved.id, form });
          return;
        }
        const found = findPlan(saved.plan);
        post(found ? { type: 'plan', plan: shown(found, form, saved.name), form, savedId: saved.id } : { type: 'form', form, invalid: true });
        return;
      }

      case 'update': {
        // Save Changes: the form goes back into the saved plan that the pencil took it from.
        const form = formOf(message.form);
        const found = findPlan(form.plan);
        if (!found) {
          post({ type: 'invalid' });
          return;
        }
        const id = text(message.id);
        const fields = { ...form, name: form.name.trim() || found.title };
        await changeSaved(context, (saved) => withChanges(saved, id, fields));
        post({ type: 'updated', id, form: fields });
        return;
      }

      case 'delete': {
        const saved = (await readSaved(context)).find((plan) => plan.id === message.id);
        if (!saved) {
          return;
        }
        const answer = await vscode.window.showWarningMessage(`Delete the saved plan "${saved.name}"?`, { modal: true }, 'Delete');
        if (answer === 'Delete') {
          await changeSaved(context, (all) => withoutPlan(all, saved.id));
        }
        return;
      }
    }
  }
  webview.onDidReceiveMessage((message) => {
    receive(message).catch((error) => {
      void vscode.window.showErrorMessage(`Postgres Explain Visualizer: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  // Dark, until the button in the page is used.
  const theme: Theme = context.globalState.get(THEME) === 'light' ? 'light' : 'dark';
  const nonce = crypto.randomBytes(16).toString('base64');
  const src = (dir: vscode.Uri, file: string) => webview.asWebviewUri(vscode.Uri.joinPath(dir, file)).toString();
  // Plans contain text from the database, so the page may run this extension's script and nothing
  // else, and may load nothing from the network. (The icon library adds its styles to the page inline.)
  const policy = [
    "default-src 'none'",
    'img-src data:',
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  webview.html = `<!DOCTYPE html>
<html lang="en" data-bs-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${src(webviewDir, 'webview.css')}">
</head>
<body>
<div id="app" class="d-flex flex-column vh-100"></div>
${testing ? `<script nonce="${nonce}" src="${src(probeDir, 'probe.js')}"></script>` : ''}
<script nonce="${nonce}" src="${src(webviewDir, 'webview.js')}"></script>
</body>
</html>`;
  return panel;
}
