/**
 * Loaded into the plan panel by the integration tests only (the extension adds it when VS Code
 * runs it in test mode; it is not in the packaged extension). The suite can't see into a
 * webview, so this answers its questions about the page and clicks what it asks for.
 */
(() => {
  type Api = { postMessage(message: unknown): void };
  const host = window as unknown as { acquireVsCodeApi(): Api; __pwned?: unknown };

  // VS Code hands the API out once. Take it here and give the same one to the page's script.
  const api = host.acquireVsCodeApi();
  host.acquireVsCodeApi = () => api;

  const problems: string[] = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    problems.push(`blocked by the content security policy: ${event.violatedDirective} ${event.blockedURI}`);
  });
  window.addEventListener('error', (event) => problems.push(`error: ${event.message}`));
  window.addEventListener('unhandledrejection', (event) => problems.push(`rejection: ${String(event.reason)}`));

  const label = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** What a click in the middle of the element would land on, when that is something else. */
  function covering(element: Element): Element | undefined {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (box.width === 0 || box.height === 0 || x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return undefined; // not on screen: hidden, in another tab, or scrolled away
    }
    const hit = document.elementFromPoint(x, y) ?? document.documentElement;
    return element.contains(hit) || hit.contains(element) ? undefined : hit;
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const request = event.data as { type?: string; id: number; selector?: string; text?: string; click?: boolean; value?: string };
    if (request?.type !== 'probe') {
      return;
    }
    let found = request.selector ? [...document.querySelectorAll<HTMLElement>(request.selector)] : [];
    if (request.text !== undefined) {
      found = found.filter((element) => label(element) === request.text);
    }
    if (request.value !== undefined && found[0]) {
      // What typing into a field, or choosing from a list, does.
      (found[0] as HTMLInputElement).value = request.value;
      found[0].dispatchEvent(new Event('input', { bubbles: true }));
      found[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (request.click) {
      // What a mouse click does; some of the page listens for the event, not the default action.
      found[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    api.postMessage({
      type: 'probed',
      id: request.id,
      count: found.length,
      text: found.map((element) => element.textContent ?? '').join('\n'),
      classes: found.map((element) => element.getAttribute('class') ?? ''),
      values: found.map((element) => String((element as HTMLInputElement).value ?? '')),
      disabled: found.map((element) => (element as HTMLInputElement).disabled === true),
      // Where each one is, for clicking it with the real mouse.
      boxes: found.map((element) => {
        const box = element.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height];
      }),
      covered: found.flatMap((element) => {
        const over = covering(element);
        const name = (e: Element) => `<${e.tagName.toLowerCase()} class="${e.getAttribute('class') ?? ''}"> ${label(e).slice(0, 40)}`;
        return over ? [`${name(element)} is under ${name(over)}`] : [];
      }),
      theme: document.documentElement.dataset.bsTheme,
      hash: window.location.hash,
      bodyPadding: getComputedStyle(document.body).padding,
      problems,
      // Set by the script that html.txt tries to smuggle in.
      scriptRan: host.__pwned !== undefined,
    });
  });
})();
