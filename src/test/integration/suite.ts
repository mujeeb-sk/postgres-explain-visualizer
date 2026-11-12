/**
 * End-to-end checks inside VS Code: the commands find the plan where the user has it (a
 * selection, the whole editor, the clipboard, the terminal) and the tab draws it, and the home
 * page takes a pasted one. The page in the tab is asked what it shows, and told what to click
 * and type, through probe.ts.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures');
const read = (f: string) => fs.readFileSync(path.join(FIXTURES, f), 'utf8');

/** What probe.ts reports about the page, and about the elements a question was about. */
interface Page {
  count: number;
  text: string;
  classes: string[];
  /** What the fields among them hold, and which of them are disabled. */
  values: string[];
  disabled: boolean[];
  /** Of those elements, the ones that something else on the page lies over. */
  covered: string[];
  theme: string;
  hash: string;
  bodyPadding: string;
  problems: string[];
  scriptRan: boolean;
}

/** Elements matching a selector; with `text`, only those whose text is exactly that. */
interface Target {
  selector: string;
  text?: string;
}
const target = (t: string | Target): Target => (typeof t === 'string' ? { selector: t } : t);
const describe = (t: Target) => (t.text === undefined ? t.selector : `${t.selector} "${t.text}"`);

async function waitFor<T>(
  what: string,
  check: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let lastProbe = 0;
/** Asks the page about some elements, clicking the first of them or typing into it if asked to. */
function look(panel: vscode.WebviewPanel, about?: string | Target, click = false, value?: string): Promise<Page | undefined> {
  const id = ++lastProbe;
  return new Promise((resolve) => {
    const done = (page?: Page) => {
      clearTimeout(timer);
      listener.dispose();
      resolve(page);
    };
    // No answer while the page is still loading.
    const timer = setTimeout(done, 1000);
    const listener = panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'probed' && message.id === id) {
        done(message as Page);
      }
    });
    void panel.webview.postMessage({ type: 'probe', id, ...(about === undefined ? {} : target(about)), click, value });
  });
}

type Window = { -readonly [K in keyof typeof vscode.window]: (typeof vscode.window)[K] };

export async function run(): Promise<void> {
  const failures: string[] = [];
  const panels: vscode.WebviewPanel[] = [];
  const warnings: string[] = [];
  const step = async (name: string, body: () => Promise<void> | void) => {
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      panels.length = 0;
      warnings.length = 0;
      answer = undefined;
      await body();
      console.log(`  ✔ ${name}`);
    } catch (error) {
      console.log(`  ✖ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
      failures.push(name);
    }
  };

  // The warnings and questions are answered by the test: with this button, or dismissed.
  let answer: string | undefined;
  const win = vscode.window as Window;
  win.showWarningMessage = (async (message: string) => {
    warnings.push(message);
    return answer;
  }) as Window['showWarningMessage'];

  const open = async (content: string) => {
    const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
    return vscode.window.showTextDocument(doc);
  };
  const visualize = () => vscode.commands.executeCommand('explainVisualizer.visualize');
  const openHome = () => vscode.commands.executeCommand('explainVisualizer.open');
  /** Types into a field of the page, or chooses from a list. */
  const type = (panel: vscode.WebviewPanel, selector: string, value: string) =>
    waitFor(`${selector} to type into`, async () => (await look(panel, selector, false, value))?.count);
  const titled = (panel: vscode.WebviewPanel, title: string) =>
    waitFor(`the title "${title}" (it is "${panel.title}")`, () => panel.title === title);
  /** The nth panel the commands opened, once VS Code has put it in a column. */
  const opened = (n = 1) => waitFor(`plan panel ${n}`, () => (panels[n - 1]?.viewColumn ? panels[n - 1] : undefined));
  /** Waits until the panel shows this many of the elements. */
  const shows = (panel: vscode.WebviewPanel, about: string | Target, count: number) =>
    waitFor(`${count} × ${describe(target(about))}`, async () => {
      const page = await look(panel, about);
      return page?.count === count ? page : undefined;
    });
  /**
   * Clicks the first of the elements once nothing lies over any of them. (The diagram moves its
   * nodes into place with a short animation, during which they overlap.)
   */
  const click = async (panel: vscode.WebviewPanel, about: string | Target) => {
    const what = describe(target(about));
    let covered: string[] = [];
    try {
      await waitFor(`${what} to click`, async () => {
        const page = await look(panel, about);
        covered = page?.covered ?? [];
        return page?.count && covered.length === 0;
      });
    } catch (error) {
      throw covered.length ? new Error(`${what} can't be clicked: ${covered.join('; ')}`) : error;
    }
    await look(panel, about, true);
  };
  /** Waits until the first of the elements has the class, as the pressed button of a group has. */
  const has = (panel: vscode.WebviewPanel, about: string | Target, className: string) =>
    waitFor(`${describe(target(about))} to be ${className}`, async () =>
      (await look(panel, about))?.classes[0]?.split(/\s+/).includes(className),
    );
  const tab = (name: string) => `.plan-container > div > .nav-pills a.nav-link[href="#${name.toLowerCase()}"]`;
  const activeTab = async (panel: vscode.WebviewPanel) =>
    (await look(panel, '.plan-container > div > .nav-pills a.nav-link.active'))?.text.trim().split(/\s+/)[0];

  const session = read('session.txt');
  const NODES = '.plan-node';
  const HOME = 'Explain Visualizer';
  const SUBMIT = 'form button[type="submit"]';
  const SAVED = '.saved-plan';
  const THEME_BUTTON = 'button.theme-toggle';

  console.log('Postgres Explain Visualizer integration');

  const ext = vscode.extensions.getExtension('ShaikMohammadMujeeb.postgres-explain-visualizer');
  await step('the commands and menus are contributed', async () => {
    assert.ok(ext, 'extension not found');
    const api = await ext.activate();
    api.onDidOpenPanel((panel: vscode.WebviewPanel) => panels.push(panel));
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['explainVisualizer.visualize', 'explainVisualizer.visualizeTerminalSelection']) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
    const menus = ext.packageJSON.contributes.menus;
    assert.ok(menus['terminal/context'].some((m: { command: string }) => m.command === 'explainVisualizer.visualizeTerminalSelection'));
    assert.ok(menus['editor/context'].some((m: { command: string }) => m.command === 'explainVisualizer.visualize'));
  });

  // The clipboard is the user's; put it back at the end.
  const clipboard = await vscode.env.clipboard.readText();

  await step('draws the selected psql session beside the editor', async () => {
    const editor = await open(`some notes\n\n${session}\nmore notes\n`);
    const text = editor.document.getText();
    editor.selection = new vscode.Selection(
      editor.document.positionAt(text.indexOf('shop=# EXPLAIN')),
      editor.document.positionAt(text.indexOf('more notes')),
    );
    await visualize();
    const panel = await opened();
    assert.strictEqual(panel.title, 'Plan: Limit (36.8 ms)');
    assert.strictEqual(panel.viewColumn, vscode.ViewColumn.Two);
    const page = await shows(panel, NODES, 8);
    assert.match(page.text, /Bitmap Index Scan/);
    assert.deepStrictEqual(page.problems, [], 'the page reported problems');
    assert.strictEqual(page.bodyPadding, '0px', "VS Code's padding around the page is still there");
    assert.deepStrictEqual(warnings, []);
  });

  await step('every tab opens, and none of its buttons is covered', async () => {
    await open(session);
    await visualize();
    const panel = await opened();
    await shows(panel, NODES, 8);
    assert.strictEqual(await activeTab(panel), 'Plan');
    const controls = '#app button, #app a.nav-link, #app .node-detail-toggle';
    for (const name of ['Grid', 'Raw', 'Query', 'Stats', 'Plan']) {
      await click(panel, tab(name));
      await waitFor(`the ${name} tab`, async () => (await activeTab(panel)) === name);
      const page = await look(panel, controls);
      assert.strictEqual(page?.hash, `#${name.toLowerCase()}`);
      assert.ok(page.count > 5, `only ${page.count} buttons and tabs on ${name}`);
      assert.deepStrictEqual(page.covered, [], `covered on the ${name} tab`);
    }
    await shows(panel, NODES, 8);

    await click(panel, tab('Grid'));
    await shows(panel, '.plan-grid', 1);
    await click(panel, tab('Query'));
    const query = await waitFor('the statement', async () => {
      const page = await look(panel, '.tab-pane.active code');
      return page?.hash === '#query' ? page : undefined;
    });
    assert.match(query.text, /^EXPLAIN \(ANALYZE, BUFFERS\)\nSELECT c\.name/);
    assert.doesNotMatch(query.text, /shop[=-]#/);
    assert.deepStrictEqual(query.problems, []);
  });

  await step('the buttons on the Plan tab work', async () => {
    await open(session);
    await visualize();
    const panel = await opened();
    await shows(panel, NODES, 8);

    // What the bars of the outline on the left measure.
    for (const metric of ['rows', 'estimation', 'cost', 'buffers', 'time']) {
      const button: Target = { selector: '.plan-diagram button', text: metric };
      await click(panel, button);
      await has(panel, button, 'active');
    }
    // What the nodes of the diagram are highlighted by.
    for (const highlight of ['duration', 'rows', 'cost', 'none']) {
      const button: Target = { selector: '.plan .btn-group button', text: highlight };
      await click(panel, button);
      await has(panel, button, 'active');
    }
    // A node opens, and so does each tab of its details that this node has.
    await shows(panel, `${NODES}.detailed`, 0);
    await click(panel, `${NODES} .node-detail-toggle`);
    await shows(panel, `${NODES}.detailed`, 1);
    for (const details of ['IO & Buffers', 'Misc', 'General']) {
      const link: Target = { selector: `${NODES}.detailed .nav-tabs a.nav-link`, text: details };
      await click(panel, link);
      await has(panel, link, 'active');
    }
    await click(panel, `${NODES}.detailed .node-detail-toggle`);
    await shows(panel, `${NODES}.detailed`, 0);
    // A line of the outline selects its node.
    const line = '.plan-diagram tr.node:nth-child(4)';
    assert.match((await shows(panel, line, 1)).text, /#4\s+└?\s*Hash Join/);
    await click(panel, line);
    await waitFor('node 4 to be selected', async () => (await look(panel))?.hash === '#plan/node/4');
    await shows(panel, `${NODES}.selected`, 1);
    assert.deepStrictEqual((await look(panel))?.problems, []);
  });

  await step('several plans can be open at once', async () => {
    await open(session);
    await visualize();
    const first = await opened(1);
    await shows(first, NODES, 8);
    await vscode.env.clipboard.writeText(read('html.txt'));
    await open('notes that are not a plan\n');
    await visualize();
    const second = await opened(2);
    assert.strictEqual(first.title, 'Plan: Limit (36.8 ms)');
    assert.strictEqual(second.title, 'Plan: Seq Scan');
    await shows(second, NODES, 1);
    // The first one is still there and still its own plan.
    await shows(first, NODES, 8);
    first.reveal();
    await click(first, tab('Grid'));
    await shows(first, '.plan-grid', 1);
    await shows(second, '.plan-grid', 0);
  });

  await step('is dark until its button is used, then keeps the chosen look for every plan', async () => {
    await vscode.env.clipboard.writeText(session);
    await open(session);
    await visualize();
    const first = await opened(1);
    await shows(first, NODES, 8);
    assert.strictEqual((await look(first))?.theme, 'dark');
    await visualize();
    const second = await opened(2);
    await shows(second, NODES, 8);

    await click(second, THEME_BUTTON);
    await waitFor('the light look', async () => (await look(second))?.theme === 'light');
    await waitFor('the light look in the other plan', async () => (await look(first))?.theme === 'light');
    // A plan opened later starts with the look that was chosen.
    await visualize();
    const third = await opened(3);
    await shows(third, NODES, 8);
    assert.strictEqual((await look(third))?.theme, 'light');

    await click(third, THEME_BUTTON);
    for (const panel of [first, second, third]) {
      await waitFor('the dark look again', async () => (await look(panel))?.theme === 'dark');
    }
  });

  await step('without a selection, draws the whole editor when it holds a plan', async () => {
    await open(read('json.txt'));
    await visualize();
    const panel = await opened();
    assert.strictEqual(panel.title, 'Plan: Limit');
    assert.strictEqual(panel.viewColumn, vscode.ViewColumn.Two);
    await shows(panel, NODES, 8);
    // No statement came with the plan.
    assert.match((await look(panel, tab('Query')))?.classes[0] ?? '', /\bdisabled\b/);
  });

  await step('otherwise draws the plan on the clipboard, in the active column', async () => {
    await open('notes that are not a plan\n');
    await vscode.env.clipboard.writeText(read('border2.txt'));
    await visualize();
    const panel = await opened();
    assert.strictEqual(panel.title, 'Plan: Limit');
    assert.strictEqual(panel.viewColumn, vscode.ViewColumn.One);
    await shows(panel, NODES, 8);
  });

  await step('says so when there is no plan anywhere', async () => {
    await open('notes that are not a plan\n');
    await vscode.env.clipboard.writeText('not a plan either');
    await visualize();
    await waitFor('the warning', () => warnings.length === 1);
    assert.match(warnings[0], /^No EXPLAIN plan found\./);
    assert.strictEqual(panels.length, 0);
  });

  await step('says so when the selection is not a plan, and leaves the clipboard alone', async () => {
    const editor = await open(`SELECT 1;\n${session}`);
    editor.selection = new vscode.Selection(0, 0, 0, 9);
    await vscode.env.clipboard.writeText(session);
    await visualize();
    await waitFor('the warning', () => warnings.length === 1);
    assert.match(warnings[0], /^The selection isn't an EXPLAIN plan/);
    assert.strictEqual(panels.length, 0);
  });

  await step('draws the selection in the terminal', async () => {
    await vscode.env.clipboard.writeText('');
    const write = new vscode.EventEmitter<string>();
    const terminal = vscode.window.createTerminal({
      name: 'psql',
      pty: { onDidWrite: write.event, open: () => write.fire(session.replace(/\n/g, '\r\n')), close: () => undefined },
    });
    terminal.show();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await vscode.commands.executeCommand('workbench.action.terminal.selectAll');
    await vscode.commands.executeCommand('explainVisualizer.visualizeTerminalSelection');
    const panel = await opened();
    assert.strictEqual(panel.title, 'Plan: Limit (36.8 ms)');
    await shows(panel, NODES, 8);
    terminal.dispose();
  });

  await step('HTML in a plan is shown as text and its script does not run', async () => {
    await open(read('html.txt'));
    await visualize();
    const panel = await opened();
    await shows(panel, NODES, 1);
    // The filter with the HTML in it is under the node's Misc tab.
    await click(panel, `${NODES} .node-detail-toggle`);
    await click(panel, { selector: `${NODES} .nav-tabs a.nav-link`, text: 'Misc' });
    const details = await waitFor('the filter', async () => {
      const page = await look(panel, `${NODES} .prop-list`);
      return page?.text.includes('<img src=x') ? page : undefined;
    });
    assert.match(details.text, /<script>window\.__pwned=1<\/script>/);
    await click(panel, tab('Raw'));
    const raw = await waitFor('the Raw tab', async () => {
      const page = await look(panel, '.tab-pane.active code');
      return page?.hash === '#raw' ? page : undefined;
    });
    assert.match(raw.text, /<b>bold<\/b>/);
    const smuggled = await look(panel, '#app img, #app script');
    assert.strictEqual(smuggled?.count, 0, 'the HTML in the plan became elements');
    assert.strictEqual(smuggled?.scriptRan, false);
    assert.deepStrictEqual(smuggled?.problems, []);
    // The page has bold text of its own; none of it is the plan's.
    const bold = await look(panel, '#app b');
    assert.ok(!bold?.text.split('\n').some((text) => text.trim() === 'bold'), 'the <b> in the plan became an element');
  });

  await step('the home page opens without a plan, and none of its controls is covered', async () => {
    await openHome();
    const panel = await opened();
    assert.strictEqual(panel.title, HOME);
    assert.strictEqual(panel.viewColumn, vscode.ViewColumn.One);
    const page = await shows(panel, '#planInput', 1);
    assert.strictEqual(page.theme, 'dark');
    assert.deepStrictEqual(page.problems, []);
    await shows(panel, NODES, 0);
    const controls = await look(panel, '#app button, #app select, #app input, #app textarea');
    assert.ok(controls && controls.count >= 9, `only ${controls?.count} controls`);
    assert.deepStrictEqual(controls.covered, []);
    // Nowhere to go back or forward to yet, and nothing to submit.
    for (const button of ['button.go-back', 'button.go-forward', SUBMIT]) {
      assert.deepStrictEqual((await look(panel, button))?.disabled, [true], `${button} is not disabled`);
    }
    await click(panel, 'button.theme-toggle');
    await waitFor('the light look', async () => (await look(panel))?.theme === 'light');
    await click(panel, 'button.theme-toggle');
    await waitFor('the dark look', async () => (await look(panel))?.theme === 'dark');
  });

  await step('the home page says so when the text is not a plan', async () => {
    await openHome();
    const panel = await opened();
    await shows(panel, '#planInput', 1);
    await type(panel, '#planInput', 'hello, this is not a plan');
    await click(panel, SUBMIT);
    await shows(panel, '#planInput.is-invalid', 1);
    await shows(panel, NODES, 0);
    assert.strictEqual(panel.title, HOME);
    // Typing takes the complaint away.
    await type(panel, '#planInput', 'hello again');
    await shows(panel, '#planInput.is-invalid', 0);
  });

  await step('a pasted psql session is drawn, and Back and Forward move between the form and the plan', async () => {
    await openHome();
    const panel = await opened();
    await shows(panel, '#planInput', 1);
    await type(panel, '#planInput', session);
    await click(panel, SUBMIT);
    await shows(panel, NODES, 8);
    await titled(panel, 'Plan: Limit (36.8 ms)');
    assert.deepStrictEqual((await look(panel, 'button.go-forward'))?.disabled, [true]);

    await click(panel, 'button.go-back');
    assert.deepStrictEqual((await shows(panel, '#planInput', 1)).values, [session], 'the form is not as it was left');
    await titled(panel, HOME);
    await shows(panel, '.saved-plans', 0);
    assert.deepStrictEqual((await look(panel, 'button.go-back'))?.disabled, [true]);

    await click(panel, 'button.go-forward');
    await shows(panel, NODES, 8);
    await titled(panel, 'Plan: Limit (36.8 ms)');
    // The statement above the plan went to the Query tab.
    await click(panel, tab('Query'));
    const query = await waitFor('the statement', async () => {
      const page = await look(panel, '.tab-pane.active code');
      return page?.hash === '#query' ? page : undefined;
    });
    assert.match(query.text, /^EXPLAIN \(ANALYZE, BUFFERS\)\nSELECT c\.name/);

    // New Plan is the home page with an empty form; Back from it is the plan, on its Plan tab.
    await click(panel, 'button.new-plan');
    assert.deepStrictEqual((await shows(panel, '#planInput', 1)).values, ['']);
    await titled(panel, HOME);
    await click(panel, 'button.go-back');
    await shows(panel, NODES, 8);
    assert.strictEqual(await activeTab(panel), 'Plan');
    assert.deepStrictEqual((await look(panel))?.problems, []);
  });

  await step('a sample plan fills the form and is drawn under its name', async () => {
    await openHome();
    const panel = await opened();
    await shows(panel, '#samplePlans option', 15);
    await type(panel, '#samplePlans', '0');
    await waitFor('the sample in the form', async () => (await look(panel, '#planName'))?.values[0] === 'Simple join (TEXT format)');
    assert.match((await look(panel, '#planInput'))?.values[0] ?? '', /^Nested Loop Left Join/);
    assert.match((await look(panel, '#queryInput'))?.values[0] ?? '', /A join between two tables/);
    assert.deepStrictEqual((await look(panel, '#samplePlans'))?.values, [''], 'the list still shows the sample');
    await click(panel, SUBMIT);
    await waitFor('the plan', async () => ((await look(panel, NODES))?.count ?? 0) > 1);
    await titled(panel, 'Simple join (TEXT format)');
  });

  await step('nothing is saved until Save Plan is used; a saved plan is listed on every home page, opened, edited and deleted', async () => {
    const plan = read('html.txt');
    const saveButton = async (panel: vscode.WebviewPanel) => {
      const button = await look(panel, 'button.save-plan');
      return button?.count === 1 ? `${button.text.trim()}${button.disabled[0] ? ' (disabled)' : ''}` : undefined;
    };
    await openHome();
    const first = await opened(1);
    await shows(first, '#planInput', 1);
    await shows(first, '.saved-plans', 0);
    await type(first, '#planName', 'My plan');
    await type(first, '#planInput', plan);
    await type(first, '#commentInput', 'slow on Mondays');
    await click(first, SUBMIT);
    await shows(first, NODES, 1);
    await titled(first, 'My plan');
    assert.match((await shows(first, 'a.nav-link[href="#comment"]', 1)).text, /Comment/);
    assert.strictEqual(await saveButton(first), 'Save Plan');

    // Submitting saved nothing: another home page has no list.
    await openHome();
    const second = await opened(2);
    await shows(second, '#planInput', 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await shows(second, '.saved-plans', 0);

    // The button beside the plan saves it.
    first.reveal();
    await click(first, 'button.save-plan');
    await waitFor('the button to say Saved', async () => (await saveButton(first)) === 'Saved (disabled)');
    second.reveal();
    const listed = await shows(second, SAVED, 1);
    assert.match(listed.text.trim(), /^My plan\s+saved just now/);

    // From the list it is drawn again, and is marked as saved.
    await click(second, `${SAVED} .open-saved`);
    await shows(second, NODES, 1);
    await titled(second, 'My plan');
    assert.strictEqual(await saveButton(second), 'Saved (disabled)');

    // The pencil puts it into the form to be changed. The form holds this very plan already
    // (Back from it), so what shows is the notice and the Save Changes button.
    await click(second, 'button.go-back');
    await shows(second, '#planInput', 1);
    await shows(second, '.editing', 0);
    await click(second, `${SAVED} .edit-saved`);
    assert.match((await shows(second, '.editing', 1)).text, /Editing the saved plan My plan\./);
    assert.deepStrictEqual((await look(second, '#planName, #planInput, #commentInput'))?.values, ['My plan', plan, 'slow on Mondays']);
    await shows(second, SUBMIT, 1);
    assert.match((await look(second, SUBMIT))?.text ?? '', /Save Changes/);
    assert.match((await look(second, SAVED))?.classes[0] ?? '', /list-group-item-primary/);

    // Text that is not a plan is not saved over it.
    await type(second, '#planInput', 'not a plan');
    await click(second, 'button.save-changes');
    await shows(second, '#planInput.is-invalid', 1);
    await shows(second, '.editing', 1);

    // Save Changes writes the form back into the same saved plan.
    await type(second, '#planInput', plan);
    await type(second, '#planName', 'My plan, renamed');
    await type(second, '#commentInput', 'fast on Tuesdays');
    await click(second, 'button.save-changes');
    await shows(second, '.editing', 0);
    assert.match((await shows(second, SAVED, 1)).text.trim(), /^My plan, renamed\s+saved/);
    assert.match((await look(second, SUBMIT))?.text ?? '', /Submit/);
    // The plan in the other tab is still that saved plan.
    assert.strictEqual(await saveButton(first), 'Saved (disabled)');

    // Cancel leaves the saved plan alone and gives the form back as it was.
    await type(second, '#planName', 'something of my own');
    await click(second, `${SAVED} .edit-saved`);
    await shows(second, '.editing', 1);
    await type(second, '#commentInput', 'never mind');
    await click(second, 'button.cancel-editing');
    await shows(second, '.editing', 0);
    assert.deepStrictEqual((await look(second, '#planName'))?.values, ['something of my own']);
    await click(second, `${SAVED} .open-saved`);
    await shows(second, NODES, 1);
    await titled(second, 'My plan, renamed');
    await click(second, tab('Comment'));
    await waitFor('the comments', async () => (await look(second, '.plan-comment'))?.text === 'fast on Tuesdays');
    await click(second, 'button.go-back');
    await shows(second, '#planInput', 1);

    // Deleting asks first.
    await click(second, `${SAVED} .delete-saved`);
    await waitFor('the question', () => warnings.length === 1);
    assert.strictEqual(warnings[0], 'Delete the saved plan "My plan, renamed"?');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual((await look(second, SAVED))?.count, 1, 'deleted without a yes');
    answer = 'Delete';
    await click(second, `${SAVED} .delete-saved`);
    await shows(second, '.saved-plans', 0);
    // The plan in the other tab is not saved any more, and can be saved again.
    first.reveal();
    await waitFor('the button to say Save Plan', async () => (await saveButton(first)) === 'Save Plan');
  });

  await step('a plan opened by a command has the home page behind it, with the plan in the form', async () => {
    await open(session);
    await visualize();
    const panel = await opened();
    await shows(panel, NODES, 8);
    assert.deepStrictEqual((await look(panel, 'button.save-plan'))?.disabled, [false], 'it cannot be saved');
    await click(panel, 'button.go-back');
    const form = await shows(panel, '#planInput, #queryInput', 2);
    assert.match(form.values[0], /^\s+QUERY PLAN[\s\S]*\(32 rows\)$/);
    assert.match(form.values[1], /^EXPLAIN \(ANALYZE, BUFFERS\)\nSELECT c\.name/);
    await titled(panel, HOME);
    await click(panel, 'button.go-forward');
    await shows(panel, NODES, 8);
    await titled(panel, 'Plan: Limit (36.8 ms)');
  });

  await step('offers the home page when there is no plan anywhere', async () => {
    await open('notes that are not a plan\n');
    await vscode.env.clipboard.writeText('not a plan either');
    answer = 'Open Visualizer';
    await visualize();
    const panel = await opened();
    assert.strictEqual(panel.title, HOME);
    await shows(panel, '#planInput', 1);
  });

  await vscode.env.clipboard.writeText(clipboard);
  if (failures.length) {
    throw new Error(`${failures.length} integration step(s) failed`);
  }
}
