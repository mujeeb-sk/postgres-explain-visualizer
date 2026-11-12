# Changelog

## 1.0.0

First release.

- **Visualize EXPLAIN Plan**: draws the output of `EXPLAIN` (the selection, the whole editor, or the clipboard) as an interactive diagram in a new tab. Also on the right-click menus of the editor and the terminal.
- Reads the text and JSON formats, with or without psql's header, borders and row count, and plans written by `auto_explain`.
- **Open Explain Visualizer**: the home page, for when the plan isn't in an editor: a form to paste the plan, its query, a name and comments into, and fourteen sample plans.
- Back and Forward buttons move between the home page and the plans drawn from it.
- **Save Plan**, beside a plan, keeps it in a list on the home page, to open, edit (name, plan, query, comments) or delete later. No plan is saved without it.
- From a psql session, shows the `EXPLAIN` statement above the plan on the Query tab.
- Plan, Grid, Raw, Query and Stats tabs.
- A dark and a light look, switched with a button in the tab. It starts dark and remembers the choice.
- Several plans can be open at once, each in its own tab.
- Makes no network requests.
