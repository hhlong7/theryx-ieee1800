const CELL_LIBRARY = {
  GATE_AND: {
    type: "GATE_AND",
    width: 62,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 62,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M 10,0 L 32,0 A 20,20 0 0,1 32,40 L 10,40 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="52" y1="20" x2="62" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  GATE_OR: {
    type: "GATE_OR",
    width: 62,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 62,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="14" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M 10,0 Q 20,20 10,40 Q 32,40 52,20 Q 32,0 10,0 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="52" y1="20" x2="62" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  GATE_XOR: {
    type: "GATE_XOR",
    width: 66,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 66,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="16" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M 6,0 Q 16,20 6,40" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M 12,0 Q 22,20 12,40 Q 34,40 54,20 Q 34,0 12,0 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="54" y1="20" x2="66" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  GATE_NOT: {
    type: "GATE_NOT",
    width: 58,
    height: 40,
    pins: [
      {
        id: "in",
        name: "A",
        side: "WEST",
        x: 0,
        y: 20,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 58,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="20" x2="10" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <polygon points="10,6 38,20 10,34" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="44" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="48" y1="20" x2="58" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  GATE_NAND: {
    type: "GATE_NAND",
    width: 66,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 66,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M 10,0 L 28,0 A 20,20 0 0,1 28,40 L 10,40 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="52" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="56" y1="20" x2="66" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  GATE_NOR: {
    type: "GATE_NOR",
    width: 66,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 66,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="14" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M 10,0 Q 20,20 10,40 Q 30,40 48,20 Q 30,0 10,0 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="52" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="56" y1="20" x2="66" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  GATE_XNOR: {
    type: "GATE_XNOR",
    width: 66,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 66,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="16" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M 6,0 Q 16,20 6,40" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M 12,0 Q 22,20 12,40 Q 32,40 48,20 Q 32,0 12,0 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="52" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="56" y1="20" x2="66" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  MUX: {
    type: "MUX",
    width: 62,
    height: 60,
    pins: [
      {
        id: "in0",
        name: "0",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "in1",
        name: "1",
        side: "WEST",
        x: 0,
        y: 42,
      },
      {
        id: "sel",
        name: "SEL",
        side: "SOUTH",
        x: 31,
        y: 60,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 62,
        y: 30,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="42" x2="10" y2="42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <polygon points="10,0 52,14 52,46 10,60" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="31" y1="53" x2="31" y2="60" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="52" y1="30" x2="62" y2="30" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <text x="16" y="22" font-size="10" font-family="monospace" fill="currentColor">0</text>
      <text x="16" y="46" font-size="10" font-family="monospace" fill="currentColor">1</text>
    `,
  },
  DFF: {
    type: "DFF",
    width: 80,
    height: 80,
    pins: [
      {
        id: "d",
        name: "D",
        side: "WEST",
        x: 0,
        y: 25,
      },
      {
        id: "clk",
        name: "CLK",
        side: "WEST",
        x: 0,
        y: 55,
      },
      {
        id: "rst",
        name: "RST",
        side: "SOUTH",
        x: 40,
        y: 80,
      },
      {
        id: "q",
        name: "Q",
        side: "EAST",
        x: 80,
        y: 25,
      },
    ],
    svgBody: `
      <rect x="10" y="10" width="60" height="60" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="0" y1="25" x2="10" y2="25" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="0" y1="55" x2="10" y2="55" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="40" y1="70" x2="40" y2="80" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="70" y1="25" x2="80" y2="25" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M 10,49 L 20,55 L 10,61 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      <text x="18" y="30" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">D</text>
      <text x="56" y="30" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">Q</text>
    `,
  },
  LATCH: {
    type: "LATCH",
    width: 80,
    height: 70,
    pins: [
      {
        id: "d",
        name: "D",
        side: "WEST",
        x: 0,
        y: 25,
      },
      {
        id: "en",
        name: "EN",
        side: "WEST",
        x: 0,
        y: 48,
      },
      {
        id: "q",
        name: "Q",
        side: "EAST",
        x: 80,
        y: 25,
      },
    ],
    svgBody: `
      <rect x="10" y="10" width="60" height="50" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="0" y1="25" x2="10" y2="25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="48" x2="10" y2="48" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="70" y1="25" x2="80" y2="25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <text x="18" y="29" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">D</text>
      <text x="16" y="52" font-size="8.5" font-family="sans-serif" font-weight="bold" fill="currentColor">EN</text>
      <text x="56" y="29" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">Q</text>
      <text x="40" y="38" font-size="8.5" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor" opacity="0.9">LATCH</text>
    `,
  },
  PORT_IN: {
    type: "PORT_IN",
    width: 55,
    height: 30,
    pins: [
      {
        id: "out",
        name: "out",
        side: "EAST",
        x: 55,
        y: 15,
      },
    ],
    svgBody: `
      <path d="M 0,5 L 35,5 L 45,15 L 35,25 L 0,25 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <line x1="45" y1="15" x2="55" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  PORT_OUT: {
    type: "PORT_OUT",
    width: 55,
    height: 30,
    pins: [
      {
        id: "in",
        name: "in",
        side: "WEST",
        x: 0,
        y: 15,
      },
    ],
    svgBody: `
      <line x1="0" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M 10,5 L 45,5 L 55,15 L 45,25 L 10,25 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
    `,
  },
  PORT_INOUT: {
    type: "PORT_INOUT",
    width: 55,
    height: 30,
    pins: [
      {
        id: "in",
        name: "io",
        side: "WEST",
        x: 0,
        y: 15,
      },
    ],
    svgBody: `
      <line x1="0" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <polygon points="17,5 45,5 55,15 45,25 17,25 10,15" fill="none" stroke="currentColor" stroke-width="1.8"/>
    `,
  },
  PORT_INTERMEDIATE: {
    type: "PORT_INTERMEDIATE",
    width: 55,
    height: 30,
    pins: [
      {
        id: "in",
        name: "in",
        side: "WEST",
        x: 0,
        y: 15,
      },
    ],
    svgBody: `
      <line x1="0" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <polygon points="10,5 45,5 55,15 45,25 10,25 16,15" fill="var(--bg-panel, #252526)" stroke="var(--vscode-editorInfo-foreground, #75beff)" stroke-width="1.8" stroke-dasharray="4,2"/>
    `,
  },
  SIGNAL_UNUSED: {
    type: "SIGNAL_UNUSED",
    width: 65,
    height: 30,
    pins: [
      {
        id: "in",
        name: "in",
        side: "WEST",
        x: 0,
        y: 15,
      },
    ],
    svgBody: `
      <line x1="0" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="5" width="54" height="20" rx="3" fill="var(--bg-panel, #252526)" stroke="var(--vscode-editorWarning-foreground, #cca700)" stroke-width="1.6" stroke-dasharray="3,2"/>
      <line x1="53" y1="11" x2="60" y2="19" stroke="var(--vscode-editorWarning-foreground, #cca700)" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="60" y1="11" x2="53" y2="19" stroke="var(--vscode-editorWarning-foreground, #cca700)" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  CONSTANT: {
    type: "CONSTANT",
    width: 50,
    height: 26,
    pins: [
      {
        id: "out",
        name: "out",
        side: "EAST",
        x: 50,
        y: 13,
      },
    ],
    svgBody: `
      <rect x="0" y="0" width="40" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3,2"/>
      <line x1="40" y1="13" x2="50" y2="13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  SUBMODULE: {
    type: "SUBMODULE",
    width: 80,
    height: 80,
    pins: [],
    svgBody: `
      <rect x="0" y="0" width="80" height="80" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="0" y1="20" x2="80" y2="20" stroke="currentColor" stroke-width="1"/>
    `,
  },
  CONCAT: {
    type: "CONCAT",
    width: 44,
    height: 40,
    pins: [],
    svgBody: `
      <polygon points="8,4 34,12 34,28 8,36" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <line x1="34" y1="20" x2="44" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  ADD: {
    type: "ADD",
    width: 50,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 50,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="11" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="11" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="25" cy="20" r="14" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="2"/>
      <text x="25" y="25" font-size="16" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor">+</text>
      <line x1="39" y1="20" x2="50" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  SUB: {
    type: "SUB",
    width: 50,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 50,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="11" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="11" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="25" cy="20" r="14" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="2"/>
      <text x="25" y="24" font-size="18" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor">\u2212</text>
      <line x1="39" y1="20" x2="50" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  MUL: {
    type: "MUL",
    width: 50,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 50,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="11" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="11" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="25" cy="20" r="14" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="2"/>
      <text x="25" y="25" font-size="14" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor">\xD7</text>
      <line x1="39" y1="20" x2="50" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  COMPARE_EQ: {
    type: "COMPARE_EQ",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="12" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">==</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  COMPARE_NE: {
    type: "COMPARE_NE",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="12" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">!=</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  COMPARE_LT: {
    type: "COMPARE_LT",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="13" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&lt;</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  COMPARE_GT: {
    type: "COMPARE_GT",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="13" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&gt;</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  COMPARE_LE: {
    type: "COMPARE_LE",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&lt;=</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  COMPARE_GE: {
    type: "COMPARE_GE",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&gt;=</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  SPLIT: {
    type: "SPLIT",
    width: 44,
    height: 36,
    pins: [
      {
        id: "in",
        name: "IN",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "out",
        name: "OUT",
        side: "EAST",
        x: 44,
        y: 18,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="8" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <polygon points="8,10 34,4 34,32 8,26" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="21" y="22" font-size="9" font-family="monospace" text-anchor="middle" fill="currentColor">[ ]</text>
      <line x1="34" y1="18" x2="44" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  SHIFT_LEFT: {
    type: "SHIFT_LEFT",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&lt;&lt;</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  SHIFT_RIGHT: {
    type: "SHIFT_RIGHT",
    width: 52,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 52,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="32" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="26" y="24" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&gt;&gt;</text>
      <line x1="42" y1="20" x2="52" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  SHIFT_LEFT_ARITH: {
    type: "SHIFT_LEFT_ARITH",
    width: 54,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 54,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="34" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="27" y="24" font-size="10" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&lt;&lt;&lt;</text>
      <line x1="44" y1="20" x2="54" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  SHIFT_RIGHT_ARITH: {
    type: "SHIFT_RIGHT_ARITH",
    width: 54,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 54,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="34" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="27" y="24" font-size="10" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&gt;&gt;&gt;</text>
      <line x1="44" y1="20" x2="54" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  REDUCTION_AND: {
    type: "REDUCTION_AND",
    width: 50,
    height: 36,
    pins: [
      {
        id: "in",
        name: "A",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 50,
        y: 18,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="3" width="30" height="30" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="25" y="22" font-size="12" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">&amp;</text>
      <line x1="40" y1="18" x2="50" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  REDUCTION_NAND: {
    type: "REDUCTION_NAND",
    width: 54,
    height: 36,
    pins: [
      {
        id: "in",
        name: "A",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 54,
        y: 18,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="3" width="28" height="30" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="24" y="22" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">~&amp;</text>
      <circle cx="42" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <line x1="45" y1="18" x2="54" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  REDUCTION_OR: {
    type: "REDUCTION_OR",
    width: 50,
    height: 36,
    pins: [
      {
        id: "in",
        name: "A",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 50,
        y: 18,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="3" width="30" height="30" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="25" y="22" font-size="12" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">|</text>
      <line x1="40" y1="18" x2="50" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  REDUCTION_NOR: {
    type: "REDUCTION_NOR",
    width: 54,
    height: 36,
    pins: [
      {
        id: "in",
        name: "A",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 54,
        y: 18,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="3" width="28" height="30" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="24" y="22" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">~|</text>
      <circle cx="42" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <line x1="45" y1="18" x2="54" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  REDUCTION_XOR: {
    type: "REDUCTION_XOR",
    width: 50,
    height: 36,
    pins: [
      {
        id: "in",
        name: "A",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 50,
        y: 18,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="3" width="30" height="30" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="25" y="22" font-size="12" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">^</text>
      <line x1="40" y1="18" x2="50" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  REDUCTION_XNOR: {
    type: "REDUCTION_XNOR",
    width: 54,
    height: 36,
    pins: [
      {
        id: "in",
        name: "A",
        side: "WEST",
        x: 0,
        y: 18,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 54,
        y: 18,
      },
    ],
    svgBody: `
      <line x1="0" y1="18" x2="10" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="3" width="28" height="30" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
      <text x="24" y="22" font-size="10" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">^~</text>
      <circle cx="42" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <line x1="45" y1="18" x2="54" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
  REPLICATION: {
    type: "REPLICATION",
    width: 52,
    height: 40,
    pins: [],
    svgBody: "",
  },
  UNSUPPORTED: {
    type: "UNSUPPORTED",
    width: 62,
    height: 40,
    pins: [
      {
        id: "in0",
        name: "A",
        side: "WEST",
        x: 0,
        y: 12,
      },
      {
        id: "in1",
        name: "B",
        side: "WEST",
        x: 0,
        y: 28,
      },
      {
        id: "out",
        name: "Y",
        side: "EAST",
        x: 62,
        y: 20,
      },
    ],
    svgBody: `
      <line x1="0" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="0" y1="28" x2="10" y2="28" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="10" y="4" width="42" height="32" rx="4" fill="var(--bg-panel, #252526)" stroke="var(--vscode-editorError-foreground, #f14c4c)" stroke-width="2" stroke-dasharray="5,3"/>
      <line x1="16" y1="12" x2="46" y2="28" stroke="var(--vscode-editorError-foreground, #f14c4c)" stroke-width="2" stroke-linecap="round"/>
      <line x1="46" y1="12" x2="16" y2="28" stroke="var(--vscode-editorError-foreground, #f14c4c)" stroke-width="2" stroke-linecap="round"/>
      <line x1="52" y1="20" x2="62" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    `,
  },
};

export function cellFor(O) {
  return CELL_LIBRARY[O] ?? CELL_LIBRARY.GATE_AND;
}
