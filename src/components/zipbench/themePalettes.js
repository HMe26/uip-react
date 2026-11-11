/** Plain colour data for the ZIP workbench themes (no CodeMirror imports, so the JSON viewer can share it cheaply). */
// ui  -> chrome colours (become --zb-* CSS variables)
// ed  -> editor + syntax colours
export const THEMES = [
  {
    id: 'dark', name: 'Dark+', hint: 'Classic', dark: true,
    ui: {
      bg: '#1e1e1e', side: '#252526', bar: '#2b2b2c', tabs: '#252526', line: '#3a3a3c', text: '#d4d4d4', strong: '#ffffff', muted: '#8b949e',
      accent: '#3794ff', accentSoft: 'rgba(55,148,255,.2)', primary: '#0e639c', primaryH: '#1177bb', onPrimary: '#ffffff',
      status: '#0a64b0', statusFg: '#ffffff', hover: 'rgba(255,255,255,.07)', sel: '#37373d', input: '#3c3c3c', btn: '#3a3d41', btnH: '#45494e',
      modified: '#e2c08d', added: '#73c991', folder: '#dcb67a', danger: '#e5534b', warn: '#d7ba7d', menu: '#2d2d30',
      shadow: 'rgba(0,0,0,.55)', scrim: 'rgba(0,0,0,.45)', mark: 'rgba(234,92,0,.45)', chk1: '#262626', chk2: '#202020',
    },
    ed: {
      bg: '#1e1e1e', fg: '#d4d4d4', cursor: '#aeafad', selection: '#264f78', line: 'rgba(255,255,255,.05)', gutter: '#6e7681', match: 'rgba(255,255,255,.12)',
      find: 'rgba(234,92,0,.33)', findSel: 'rgba(234,92,0,.6)',
      keyword: '#569cd6', control: '#c586c0', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', fn: '#dcdcaa', variable: '#9cdcfe', prop: '#9cdcfe', type: '#4ec9b0', tag: '#569cd6', attr: '#9cdcfe', op: '#d4d4d4', meta: '#c586c0', invalid: '#f44747',
    },
  },
  {
    id: 'midnight', name: 'Midnight', hint: 'Deep indigo', dark: true,
    ui: {
      bg: '#1a1b26', side: '#16161e', bar: '#13131b', tabs: '#16161e', line: '#262a3f', text: '#c0caf5', strong: '#ffffff', muted: '#6b74a3',
      accent: '#7aa2f7', accentSoft: 'rgba(122,162,247,.18)', primary: '#3d59a1', primaryH: '#4a69bd', onPrimary: '#ffffff',
      status: '#3d59a1', statusFg: '#e6ebff', hover: 'rgba(122,162,247,.09)', sel: '#292e42', input: '#232536', btn: '#232536', btnH: '#2d3150',
      modified: '#e0af68', added: '#9ece6a', folder: '#7aa2f7', danger: '#f7768e', warn: '#e0af68', menu: '#1f2030',
      shadow: 'rgba(5,6,15,.7)', scrim: 'rgba(5,6,15,.55)', mark: 'rgba(255,158,100,.4)', chk1: '#1f2133', chk2: '#191a29',
    },
    ed: {
      bg: '#1a1b26', fg: '#c0caf5', cursor: '#c0caf5', selection: '#2f3b64', line: 'rgba(122,162,247,.07)', gutter: '#4b5173', match: 'rgba(122,162,247,.2)',
      find: 'rgba(255,158,100,.3)', findSel: 'rgba(255,158,100,.55)',
      keyword: '#bb9af7', control: '#bb9af7', string: '#9ece6a', number: '#ff9e64', comment: '#565f89', fn: '#7aa2f7', variable: '#c0caf5', prop: '#73daca', type: '#2ac3de', tag: '#f7768e', attr: '#bb9af7', op: '#89ddff', meta: '#7dcfff', invalid: '#f7768e',
    },
  },
  {
    id: 'dracula', name: 'Dracula', hint: 'Vivid purple', dark: true,
    ui: {
      bg: '#282a36', side: '#21222c', bar: '#191a21', tabs: '#21222c', line: '#3a3d4f', text: '#f8f8f2', strong: '#ffffff', muted: '#7a86b6',
      accent: '#bd93f9', accentSoft: 'rgba(189,147,249,.2)', primary: '#7c4dd4', primaryH: '#9163e6', onPrimary: '#ffffff',
      status: '#6d44bb', statusFg: '#ffffff', hover: 'rgba(248,248,242,.07)', sel: '#44475a', input: '#343746', btn: '#343746', btnH: '#44475a',
      modified: '#f1fa8c', added: '#50fa7b', folder: '#ffb86c', danger: '#ff5555', warn: '#f1fa8c', menu: '#2c2e3b',
      shadow: 'rgba(0,0,0,.6)', scrim: 'rgba(10,10,20,.55)', mark: 'rgba(255,184,108,.4)', chk1: '#2d2f3d', chk2: '#252733',
    },
    ed: {
      bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f0', selection: '#44475a', line: 'rgba(255,255,255,.05)', gutter: '#6272a4', match: 'rgba(255,255,255,.14)',
      find: 'rgba(255,184,108,.3)', findSel: 'rgba(255,184,108,.55)',
      keyword: '#ff79c6', control: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', fn: '#50fa7b', variable: '#f8f8f2', prop: '#8be9fd', type: '#8be9fd', tag: '#ff79c6', attr: '#50fa7b', op: '#ff79c6', meta: '#ffb86c', invalid: '#ff5555',
    },
  },
  {
    id: 'emerald', name: 'Emerald', hint: 'Dark green', dark: true,
    ui: {
      bg: '#0f1a17', side: '#0b1412', bar: '#08100e', tabs: '#0b1412', line: '#1c3a31', text: '#d1e7dd', strong: '#ffffff', muted: '#6c9a88',
      accent: '#34d399', accentSoft: 'rgba(52,211,153,.18)', primary: '#0f8a65', primaryH: '#12a578', onPrimary: '#ffffff',
      status: '#0b6b52', statusFg: '#e6fff5', hover: 'rgba(52,211,153,.08)', sel: '#17332b', input: '#152923', btn: '#152923', btnH: '#1d3a31',
      modified: '#fcd34d', added: '#34d399', folder: '#5eead4', danger: '#fb7185', warn: '#fcd34d', menu: '#10201b',
      shadow: 'rgba(0,8,5,.7)', scrim: 'rgba(0,8,5,.55)', mark: 'rgba(251,146,60,.4)', chk1: '#13211d', chk2: '#0e1a16',
    },
    ed: {
      bg: '#0f1a17', fg: '#d1e7dd', cursor: '#34d399', selection: '#1f4a3c', line: 'rgba(52,211,153,.06)', gutter: '#47705f', match: 'rgba(52,211,153,.2)',
      find: 'rgba(251,146,60,.3)', findSel: 'rgba(251,146,60,.55)',
      keyword: '#5eead4', control: '#5eead4', string: '#fcd34d', number: '#fb923c', comment: '#5f8374', fn: '#34d399', variable: '#d1e7dd', prop: '#bef264', type: '#67e8f9', tag: '#f472b6', attr: '#a7f3d0', op: '#86efac', meta: '#c4b5fd', invalid: '#fb7185',
    },
  },
  {
    id: 'nord', name: 'Nord', hint: 'Arctic blue', dark: true,
    ui: {
      bg: '#2e3440', side: '#2a303b', bar: '#242933', tabs: '#2a303b', line: '#3b4252', text: '#d8dee9', strong: '#eceff4', muted: '#7f8ba3',
      accent: '#88c0d0', accentSoft: 'rgba(136,192,208,.2)', primary: '#4c7a99', primaryH: '#5e8fb0', onPrimary: '#ffffff',
      status: '#4a6f8f', statusFg: '#eceff4', hover: 'rgba(216,222,233,.07)', sel: '#3b4252', input: '#3b4252', btn: '#3b4252', btnH: '#434c5e',
      modified: '#ebcb8b', added: '#a3be8c', folder: '#ebcb8b', danger: '#bf616a', warn: '#ebcb8b', menu: '#2e3440',
      shadow: 'rgba(0,0,0,.5)', scrim: 'rgba(15,18,25,.5)', mark: 'rgba(208,135,112,.45)', chk1: '#323945', chk2: '#2a303b',
    },
    ed: {
      bg: '#2e3440', fg: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e', line: 'rgba(216,222,233,.05)', gutter: '#616e88', match: 'rgba(136,192,208,.22)',
      find: 'rgba(208,135,112,.35)', findSel: 'rgba(208,135,112,.6)',
      keyword: '#81a1c1', control: '#81a1c1', string: '#a3be8c', number: '#b48ead', comment: '#616e88', fn: '#88c0d0', variable: '#d8dee9', prop: '#8fbcbb', type: '#8fbcbb', tag: '#81a1c1', attr: '#8fbcbb', op: '#81a1c1', meta: '#d08770', invalid: '#bf616a',
    },
  },
  {
    id: 'light', name: 'Light', hint: 'Clean & bright', dark: false,
    ui: {
      bg: '#ffffff', side: '#f6f8fa', bar: '#eef1f5', tabs: '#eaeef2', line: '#d0d7de', text: '#1f2328', strong: '#0b0f14', muted: '#656d76',
      accent: '#0969da', accentSoft: 'rgba(9,105,218,.12)', primary: '#0969da', primaryH: '#0a58b8', onPrimary: '#ffffff',
      status: '#0969da', statusFg: '#ffffff', hover: 'rgba(31,35,40,.06)', sel: '#ddf4ff', input: '#ffffff', btn: '#f3f4f6', btnH: '#e7eaee',
      modified: '#9a6700', added: '#1a7f37', folder: '#b7791f', danger: '#cf222e', warn: '#9a6700', menu: '#ffffff',
      shadow: 'rgba(31,35,40,.22)', scrim: 'rgba(31,35,40,.35)', mark: 'rgba(255,200,60,.55)', chk1: '#f1f3f5', chk2: '#e9ecef',
    },
    ed: {
      bg: '#ffffff', fg: '#1f2328', cursor: '#0969da', selection: '#b6e3ff', line: 'rgba(9,105,218,.06)', gutter: '#8c959f', match: 'rgba(9,105,218,.14)',
      find: 'rgba(255,200,60,.45)', findSel: 'rgba(255,170,0,.65)',
      keyword: '#cf222e', control: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', fn: '#8250df', variable: '#953800', prop: '#0550ae', type: '#0550ae', tag: '#116329', attr: '#0550ae', op: '#1f2328', meta: '#953800', invalid: '#cf222e',
    },
  },
  // ---- merged from the JSON viewer's own theme list (kept as extra choices; nothing above was removed) ----
  {
    id: 'monokai', name: 'Monokai', hint: 'Warm classic', dark: true,
    ui: {
      bg: '#272822', side: '#1e1f1c', bar: '#1a1b18', tabs: '#1e1f1c', line: '#3e3d32', text: '#f8f8f2', strong: '#ffffff', muted: '#a59f85',
      accent: '#a6e22e', accentSoft: 'rgba(166,226,46,.18)', primary: '#5c8a14', primaryH: '#6fa319', onPrimary: '#ffffff',
      status: '#4d6f12', statusFg: '#f8f8f2', hover: 'rgba(248,248,242,.07)', sel: '#49483e', input: '#34352d', btn: '#34352d', btnH: '#44453b',
      modified: '#e6db74', added: '#a6e22e', folder: '#fd971f', danger: '#f92672', warn: '#e6db74', menu: '#2b2c26',
      shadow: 'rgba(0,0,0,.6)', scrim: 'rgba(10,10,8,.55)', mark: 'rgba(253,151,31,.4)', chk1: '#2d2e28', chk2: '#252620',
    },
    ed: {
      bg: '#272822', fg: '#f8f8f2', cursor: '#f8f8f0', selection: '#49483e', line: 'rgba(255,255,255,.05)', gutter: '#90908a', match: 'rgba(255,255,255,.14)',
      find: 'rgba(253,151,31,.3)', findSel: 'rgba(253,151,31,.55)',
      keyword: '#f92672', control: '#f92672', string: '#e6db74', number: '#ae81ff', comment: '#75715e', fn: '#a6e22e', variable: '#f8f8f2', prop: '#a6e22e', type: '#66d9ef', tag: '#f92672', attr: '#a6e22e', op: '#f92672', meta: '#fd971f', invalid: '#f92672',
    },
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', hint: 'Teal dusk', dark: true,
    ui: {
      bg: '#002b36', side: '#00252f', bar: '#073642', tabs: '#00252f', line: '#0f4655', text: '#93a1a1', strong: '#eee8d5', muted: '#7a9196',
      accent: '#2aa198', accentSoft: 'rgba(42,161,152,.2)', primary: '#1f7f78', primaryH: '#26988f', onPrimary: '#ffffff',
      status: '#0b5566', statusFg: '#eee8d5', hover: 'rgba(147,161,161,.09)', sel: '#0b5566', input: '#073642', btn: '#073642', btnH: '#0b4a5a',
      modified: '#b58900', added: '#859900', folder: '#b58900', danger: '#dc322f', warn: '#b58900', menu: '#04313d',
      shadow: 'rgba(0,10,14,.65)', scrim: 'rgba(0,10,14,.55)', mark: 'rgba(203,75,22,.4)', chk1: '#05323d', chk2: '#002b36',
    },
    ed: {
      bg: '#002b36', fg: '#93a1a1', cursor: '#93a1a1', selection: '#0b5566', line: 'rgba(147,161,161,.07)', gutter: '#657b83', match: 'rgba(42,161,152,.25)',
      find: 'rgba(203,75,22,.35)', findSel: 'rgba(203,75,22,.6)',
      keyword: '#859900', control: '#cb4b16', string: '#2aa198', number: '#d33682', comment: '#657b83', fn: '#268bd2', variable: '#93a1a1', prop: '#268bd2', type: '#b58900', tag: '#268bd2', attr: '#93a1a1', op: '#859900', meta: '#cb4b16', invalid: '#dc322f',
    },
  },
  {
    id: 'github-light', name: 'GitHub Light', hint: 'Crisp white', dark: false,
    ui: {
      bg: '#ffffff', side: '#f6f8fa', bar: '#eaeef2', tabs: '#eaeef2', line: '#d0d7de', text: '#24292f', strong: '#0b0f14', muted: '#57606a',
      accent: '#0969da', accentSoft: 'rgba(9,105,218,.12)', primary: '#0969da', primaryH: '#0a58b8', onPrimary: '#ffffff',
      status: '#0969da', statusFg: '#ffffff', hover: 'rgba(31,35,40,.06)', sel: '#ddf4ff', input: '#ffffff', btn: '#f3f4f6', btnH: '#e7eaee',
      modified: '#9a6700', added: '#1a7f37', folder: '#b7791f', danger: '#cf222e', warn: '#9a6700', menu: '#ffffff',
      shadow: 'rgba(31,35,40,.22)', scrim: 'rgba(31,35,40,.35)', mark: 'rgba(255,211,61,.55)', chk1: '#f1f3f5', chk2: '#e9ecef',
    },
    ed: {
      bg: '#ffffff', fg: '#24292f', cursor: '#0969da', selection: '#b6e3ff', line: 'rgba(9,105,218,.06)', gutter: '#6e7781', match: 'rgba(9,105,218,.14)',
      find: 'rgba(255,211,61,.5)', findSel: 'rgba(255,170,0,.65)',
      keyword: '#cf222e', control: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#57606a', fn: '#8250df', variable: '#953800', prop: '#0550ae', type: '#116329', tag: '#116329', attr: '#0550ae', op: '#24292f', meta: '#953800', invalid: '#cf222e',
    },
  },
  {
    id: 'solarized-light', name: 'Solarized Light', hint: 'Warm paper', dark: false,
    ui: {
      bg: '#fdf6e3', side: '#f5eed8', bar: '#eee8d5', tabs: '#eee8d5', line: '#ddd5b8', text: '#586e75', strong: '#073642', muted: '#7d8f93',
      accent: '#268bd2', accentSoft: 'rgba(38,139,210,.14)', primary: '#268bd2', primaryH: '#1f78b8', onPrimary: '#ffffff',
      status: '#268bd2', statusFg: '#fdf6e3', hover: 'rgba(88,110,117,.08)', sel: '#e6dfc3', input: '#fffaf0', btn: '#f1ead2', btnH: '#e6dfc3',
      modified: '#b58900', added: '#859900', folder: '#b58900', danger: '#dc322f', warn: '#b58900', menu: '#fffaf0',
      shadow: 'rgba(88,110,117,.28)', scrim: 'rgba(7,54,66,.3)', mark: 'rgba(181,137,0,.35)', chk1: '#f3ecd6', chk2: '#eee6cb',
    },
    ed: {
      bg: '#fdf6e3', fg: '#586e75', cursor: '#268bd2', selection: '#e3dcc0', line: 'rgba(88,110,117,.08)', gutter: '#8d9a9b', match: 'rgba(38,139,210,.16)',
      find: 'rgba(181,137,0,.35)', findSel: 'rgba(203,75,22,.45)',
      keyword: '#859900', control: '#cb4b16', string: '#2aa198', number: '#d33682', comment: '#93a1a1', fn: '#268bd2', variable: '#586e75', prop: '#268bd2', type: '#b58900', tag: '#268bd2', attr: '#93a1a1', op: '#859900', meta: '#cb4b16', invalid: '#dc322f',
    },
  },
];
