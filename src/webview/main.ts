/**
 * The page inside a tab: the home page, where a plan is pasted, and the plan drawn by the
 * visualizer in src/pev2. state.ts holds what it shows.
 */
import 'bootstrap/dist/css/bootstrap.css';
import './webview.css';

import { createApp } from 'vue';

import App from './App.vue';
import { connect } from './state';

// The visualizer's tabs are links such as #grid, and it switches tab when the address changes.
// VS Code cancels clicks on in-page links (it scrolls to the element with that id instead), so
// change the address here. This runs after the page's own click handlers and before VS Code's;
// a link the page has dealt with itself is left alone, as a browser would.
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
  if (link && !event.defaultPrevented) {
    event.preventDefault();
    window.location.hash = link.getAttribute('href') ?? '';
  }
});

createApp(App).mount('#app');
connect();
