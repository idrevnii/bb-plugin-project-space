# Project Space

Project Space is a bb plugin. It gives each project a full-screen
documentation **space** with Markdown pages, HTML pages and tldraw canvases.
Agents and people edit these files together. The space of a project is the
`.bb-space/` folder in its checkout.

The full documentation is in the space of this repository:
[`.bb-space/index.md`](.bb-space/index.md). To read it in bb, open **Space**.

## Install

Install the plugin from GitHub. bb builds it during the install.

```sh
bb plugin install git:github.com/idrevnii/bb-plugin-project-space
```

This source follows the `main` branch. To get new commits, run
`bb plugin update project-space`.

To change the plugin, install it from a checkout:

```sh
npm install
bb plugin install .
```

## Develop

```sh
npm run check    # typecheck + tests + build
bb plugin build && bb plugin reload project-space
npm run e2e      # browser checks against the installed plugin
```

[Develop the plugin](.bb-space/guides/developing.md) tells how to prove a
change. [Architecture](.bb-space/architecture/index.md) tells what each file
does.

## Licenses

The plugin bundles tldraw under the
[tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md).
tldraw is free on `http://` and localhost addresses. For other https
addresses, set the *tldraw license key* setting.

The *Reading style* setting and the **Blue Topaz** and **Things** themes
(Settings → Appearance) copy the Obsidian themes
[Blue Topaz](https://github.com/PKM-er/Blue-Topaz_Obsidian-css) and
[Things](https://github.com/colineckert/obsidian-things) (both MIT). The
Markdown rules of the themes style the DOM of bb (`[data-markdown-preview]`),
so a bb update can break them.
