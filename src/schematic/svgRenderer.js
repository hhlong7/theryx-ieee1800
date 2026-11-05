import { cellFor } from "./cellLibrary.js";

function escapeXml(O) {
  return O.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class SvgRenderer {
  render(d) {
    let maxValue = Math.max(d.width + 80, 400);
    let maxValue2 = Math.max(d.height + 80, 300);
    let C = new Map(d.nodes.map((Q) => [Q.id, Q]));
    let M = d.nodes.map((Q) => this.renderNode(Q)).join(`
`);
    let v = new Set();
    let R = d.connections.map((Q) => this.renderConnection(Q, C, v)).join(`
`);
    let J = new Map();
    for (let connection of d.connections) {
      if (connection.points.length > 0) {
        let Re = connection.points[0];
        let Qe = `${Math.round(Re.x)},${Math.round(Re.y)}`;
        let value = J.get(Qe);
        if (value) {
          value.count++;
        } else {
          J.set(Qe, {
            x: Math.round(Re.x),
            y: Math.round(Re.y),
            count: 1,
          });
        }
      }
    }
    let X = Array.from(J.values())
      .filter((Q) => Q.count >= 2)
      .map((Q) => `<circle cx="${Q.x}" cy="${Q.y}" r="3" fill="currentColor" />`).join(`
`);
    return `
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${maxValue} ${maxValue2}"
  width="100%"
  height="100%"
  class="verilog-schematic"
  style="background-color: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #d4d4d4);"
>
  <defs>
    <!-- Background Grid Pattern -->
    <pattern id="grid-dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="1" fill="currentColor" opacity="0.15" />
    </pattern>
  </defs>

  <!-- Background Grid -->
  <rect width="100%" height="100%" fill="url(#grid-dots)" />

  <g id="circuit-root" transform="translate(40, 40)">
    <!-- Connections (Wires) -->
    <g id="wires-layer">
      ${R}
      ${X}
    </g>

    <!-- Components (Nodes) -->
    <g id="nodes-layer">
      ${M}
    </g>
  </g>
</svg>
`.trim();
  }
  renderNode(d) {
    let m = cellFor(d.type);
    let k = d.bitWidth > 1;
    let svgBody = m.svgBody;
    if (d.type === "SUBMODULE") {
      let _e = d.pins.filter((jn) => jn.direction === "in");
      let Ke = d.pins.filter((jn) => jn.direction === "out");
      let yn = _e
        .map(
          (jn, Ln) =>
            `<text x="10" y="${35 + Ln * 22 + 4}" font-size="10" font-family="monospace" text-anchor="start" fill="currentColor">${escapeXml(jn.name)}</text>`,
        )
        .join("");
      let Se = Ke.map((jn, Ln) => {
        let ji = 35 + Ln * 22;
        return `<text x="${d.width - 10}" y="${ji + 4}" font-size="10" font-family="monospace" text-anchor="end" fill="currentColor">${escapeXml(jn.name)}</text>`;
      }).join("");
      svgBody = `
        <rect x="0" y="0" width="${d.width}" height="${d.height}" rx="4" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="2"/>
        <line x1="0" y1="22" x2="${d.width}" y2="22" stroke="currentColor" stroke-width="1"/>
        <text x="${d.width / 2}" y="15" font-size="11" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor">${escapeXml(d.label)}</text>
        ${yn}
        ${Se}
      `;
    } else if (d.type === "CONCAT" || d.type === "REPLICATION") {
      let Ke = d.pins
        .filter((ji) => ji.direction === "in")
        .map((ji, Hr) => {
          let Zu = 12 + Hr * 16;
          return `<line x1="0" y1="${Zu}" x2="8" y2="${Zu}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
        })
        .join("");
      let yn = Math.round(d.height / 2);
      let Se = d.type === "REPLICATION" ? d.label || "{N{ }}" : "{ }";
      let jn = d.width - 10;
      let Ln = Math.round((8 + jn) / 2);
      svgBody = `
        <polygon points="8,4 ${jn},10 ${jn},${d.height - 10} 8,${d.height - 4}" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
        <text x="${Ln}" y="${yn + 4}" font-size="${d.type === "REPLICATION" ? "9" : "10"}" font-family="monospace" text-anchor="middle" fill="currentColor">${escapeXml(Se)}</text>
        ${Ke}
        <line x1="${jn}" y1="${yn}" x2="${d.width}" y2="${yn}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      `;
    } else if (d.type === "DFF") {
      let _e = d.attributes?.activeLow === true;
      let Ke = d.attributes?.rstValue ? String(d.attributes.rstValue) : undefined;
      let yn = d.pins.some((Ln) => Ln.id === "rst");
      let Se = "";
      if (yn) {
        if (_e) {
          Se = `
            <line x1="40" y1="76" x2="40" y2="80" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="40" cy="73" r="3" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
            <text x="40" y="65" font-size="8" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor" opacity="0.8">RST</text>
          `;
        } else {
          Se = `
            <line x1="40" y1="70" x2="40" y2="80" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <text x="40" y="65" font-size="8" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor" opacity="0.8">RST</text>
          `;
        }
      }
      let jn = Ke
        ? `<text x="40" y="44" font-size="8.5" font-family="monospace" text-anchor="middle" fill="var(--vscode-editorInfo-foreground, #75beff)">val=${escapeXml(Ke)}</text>`
        : "";
      svgBody = `
        <rect x="10" y="10" width="60" height="60" rx="3" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="2"/>
        <line x1="0" y1="25" x2="10" y2="25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="0" y1="55" x2="10" y2="55" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="70" y1="25" x2="80" y2="25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        ${Se}
        <path d="M 10,49 L 20,55 L 10,61 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <text x="18" y="29" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">D</text>
        <text x="56" y="29" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">Q</text>
        ${jn}
      `;
    } else if (d.type === "LATCH") {
      svgBody = `
        <rect x="10" y="10" width="60" height="50" rx="3" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="2"/>
        <line x1="0" y1="25" x2="10" y2="25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="0" y1="48" x2="10" y2="48" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="70" y1="25" x2="80" y2="25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <text x="18" y="29" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">D</text>
        <text x="16" y="52" font-size="8.5" font-family="sans-serif" font-weight="bold" fill="currentColor">EN</text>
        <text x="56" y="29" font-size="11" font-family="sans-serif" font-weight="bold" fill="currentColor">Q</text>
        <text x="40" y="38" font-size="8.5" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="var(--vscode-editorWarning-foreground, #cca700)" opacity="0.9">LATCH</text>
      `;
    } else if (d.type === "SPLIT") {
      svgBody = `
        <line x1="0" y1="18" x2="8" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <polygon points="8,8 36,4 36,32 8,28" fill="var(--bg-panel, #252526)" stroke="currentColor" stroke-width="1.8"/>
        <text x="22" y="22" font-size="8.5" font-family="monospace" font-weight="bold" text-anchor="middle" fill="currentColor">${escapeXml(d.label)}</text>
        <line x1="36" y1="18" x2="44" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      `;
    } else if (d.type === "PORT_IN") {
      let _e = d.width - 10;
      let Ke = d.width - 20;
      svgBody = `
        <path d="M 0,5 L ${Ke},5 L ${_e},15 L ${Ke},25 L 0,25 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <line x1="${_e}" y1="15" x2="${d.width}" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      `;
    } else if (d.type === "PORT_INTERMEDIATE") {
      let width = d.width;
      let Ke = d.width - 10;
      svgBody = `
        <line x1="0" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <polygon points="10,5 ${Ke},5 ${width},15 ${Ke},25 10,25 16,15" fill="var(--bg-panel, #252526)" stroke="var(--vscode-editorInfo-foreground, #75beff)" stroke-width="1.8" stroke-dasharray="4,2"/>
      `;
    } else if (d.type === "SIGNAL_UNUSED") {
      let _e = d.width - 11;
      let Ke = d.width - 13;
      let yn = d.width - 6;
      svgBody = `
        <line x1="0" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <rect x="10" y="5" width="${_e}" height="20" rx="3" fill="var(--bg-panel, #252526)" stroke="var(--vscode-editorWarning-foreground, #cca700)" stroke-width="1.6" stroke-dasharray="3,2"/>
        <line x1="${Ke}" y1="11" x2="${yn}" y2="19" stroke="var(--vscode-editorWarning-foreground, #cca700)" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="${yn}" y1="11" x2="${Ke}" y2="19" stroke="var(--vscode-editorWarning-foreground, #cca700)" stroke-width="1.8" stroke-linecap="round"/>
      `;
    } else if (d.type === "PORT_OUT") {
      let width2 = d.width;
      let Ke = d.width - 10;
      svgBody = `
        <line x1="0" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M 10,5 L ${Ke},5 L ${width2},15 L ${Ke},25 L 10,25 Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
      `;
    }
    let C = "";
    if (
      d.type !== "SUBMODULE" &&
      d.type !== "CONCAT" &&
      d.type !== "REPLICATION" &&
      d.type !== "SPLIT"
    ) {
      if (d.type === "PORT_IN") {
        C = `<text x="5" y="19" font-size="11" font-family="monospace" fill="currentColor">${escapeXml(d.label)}${k ? ` [${d.bitWidth - 1}:0]` : ""}</text>`;
      } else {
        if (d.type === "PORT_OUT" || d.type === "PORT_INOUT") {
          C = `<text x="12" y="19" font-size="11" font-family="monospace" fill="currentColor">${escapeXml(d.label)}${k ? ` [${d.bitWidth - 1}:0]` : ""}</text>`;
        } else {
          if (d.type === "PORT_INTERMEDIATE") {
            C = `<text x="17" y="19" font-size="10.5" font-family="monospace" font-weight="600" fill="var(--vscode-editorInfo-foreground, #75beff)">${escapeXml(d.label)}${k ? ` [${d.bitWidth - 1}:0]` : ""}</text>`;
          } else {
            if (d.type === "SIGNAL_UNUSED") {
              C = `<text x="14" y="19" font-size="10.5" font-family="monospace" font-weight="600" fill="var(--vscode-editorWarning-foreground, #cca700)">${escapeXml(d.label)}${k ? ` [${d.bitWidth - 1}:0]` : ""}</text>`;
            } else {
              if (d.type === "CONSTANT") {
                C = `<text x="20" y="16" font-size="10" font-family="monospace" text-anchor="middle" fill="currentColor">${escapeXml(d.label)}</text>`;
              } else {
                if (d.type === "DFF" || d.type === "LATCH") {
                  C = `<text x="${d.width / 2}" y="-8" font-size="9" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="currentColor" opacity="0.8">${escapeXml(d.label)}</text>`;
                } else {
                  if (d.type === "UNSUPPORTED") {
                    C = `<text x="${d.width / 2}" y="-6" font-size="9" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="var(--vscode-editorError-foreground, #f14c4c)">${escapeXml(d.label)} (unsupported)</text>`;
                  } else {
                    C = `<text x="${d.width / 2}" y="-6" font-size="9" font-family="sans-serif" text-anchor="middle" fill="currentColor" opacity="0.6">${escapeXml(d.label)}</text>`;
                  }
                }
              }
            }
          }
        }
      }
    }
    let M = d.type === "SUBMODULE";
    let v =
      d.type === "PORT_IN" ||
      d.type === "PORT_OUT" ||
      d.type === "PORT_INOUT" ||
      d.type === "PORT_INTERMEDIATE" ||
      d.type === "SIGNAL_UNUSED";
    let R = "";
    if (M) {
      R = `title="Double-click to open schematic of submodule '${escapeXml(String(d.attributes?.moduleName ?? d.label))}'"`;
    } else if (d.type === "PORT_INTERMEDIATE") {
      R = `title="Intermediate signal '${escapeXml(d.label)}'"`;
    } else if (d.type === "SIGNAL_UNUSED") {
      R = `title="Unconnected / unused signal '${escapeXml(d.label)}'"`;
    } else if (v) {
      R = `title="Click to highlight signal '${escapeXml(d.label)}'"`;
    } else if (d.type === "UNSUPPORTED") {
      let reason = d.attributes?.reason;
      R = `title="${escapeXml(String(reason ?? "Unsupported construct"))} \u2014 this part of the circuit is NOT elaborated"`;
    }
    let J = M ? `data-module-name="${escapeXml(String(d.attributes?.moduleName ?? d.label))}"` : "";
    let X = v ? `data-net="${escapeXml(d.label)}" data-width="${d.bitWidth}"` : "";
    let Q = d.attributes?.isExpandable === true;
    let Re = Q ? String(d.attributes?.macroType ?? "") : "";
    let Qe = Q ? " node-expandable" : "";
    let le = Q ? `data-macro-type="${escapeXml(Re)}"` : "";
    let te = "";
    let Oe = "";
    if (Q) {
      te = `
        <circle cx="${d.width - 8}" cy="8" r="6" fill="var(--bg-panel, #252526)" stroke="var(--vscode-editorInfo-foreground, #75beff)" stroke-width="1.2"/>
        <line x1="${d.width - 11}" y1="8" x2="${d.width - 5}" y2="8" stroke="var(--vscode-editorInfo-foreground, #75beff)" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="${d.width - 8}" y1="5" x2="${d.width - 8}" y2="11" stroke="var(--vscode-editorInfo-foreground, #75beff)" stroke-width="1.4" stroke-linecap="round"/>
      `;
      Oe = `title="Double-click to expand this '${escapeXml(Re)}' macro into its logic gates"`;
    }
    return `
      <g id="${d.id}" class="schematic-node node-${d.type.toLowerCase()} ${M ? "node-submodule" : ""} ${v ? "node-port" : ""}${Qe}" data-node-id="${d.id}" data-node-type="${d.type}" ${X} ${J} ${le} ${R}${Oe} transform="translate(${d.x}, ${d.y})">
        ${svgBody}
        ${C}
        ${te}
      </g>
    `;
  }
  renderConnection(d, m, k) {
    if (d.points.length === 0) {
      return "";
    }
    let reduce = d.points.reduce(
      (_e, Ke, yn) => (yn === 0 ? `M ${Ke.x},${Ke.y}` : `${_e} L ${Ke.x},${Ke.y}`),
      "",
    );
    let C = d.bitWidth > 1;
    let M = C ? 3 : 1.8;
    let value = m?.get(d.sourceNodeId);
    let value2 = m?.get(d.targetNodeId);
    let netName = d.netName;
    if (
      !netName ||
      netName.startsWith("conn_") ||
      netName.startsWith("port_in_") ||
      netName.startsWith("node_")
    ) {
      if (value?.type === "PORT_IN") {
        netName = value.label;
      } else {
        if (
          value2?.type === "PORT_OUT" ||
          value2?.type === "PORT_INOUT" ||
          value2?.type === "PORT_INTERMEDIATE" ||
          value2?.type === "SIGNAL_UNUSED"
        ) {
          netName = value2.label;
        } else {
          if (value?.attributes?.netName) {
            netName = String(value.attributes.netName);
          } else {
            if (value?.label && !value.label.startsWith("gate_")) {
              netName = value.label;
            } else {
              netName = d.sourceNodeId;
            }
          }
        }
      }
    }
    let X = value?.label ?? "";
    let Q = value2?.label ?? "";
    let Re = "";
    if (C && d.points.length >= 2) {
      let _e = Math.floor(d.points.length / 2);
      let Ke = d.points[_e - 1];
      let yn = d.points[_e];
      let Se = (Ke.x + yn.x) / 2;
      let jn = (Ke.y + yn.y) / 2;
      Re = `
        <line x1="${Se - 3}" y1="${jn + 5}" x2="${Se + 3}" y2="${jn - 5}" stroke="currentColor" stroke-width="2"/>
        <text x="${Se + 5}" y="${jn - 3}" font-size="9" font-family="monospace" fill="currentColor">${d.bitWidth}</text>
      `;
    }
    let Qe = value?.type === "PORT_IN";
    let le =
      value2?.type === "PORT_OUT" ||
      value2?.type === "PORT_INOUT" ||
      value2?.type === "PORT_INTERMEDIATE" ||
      value2?.type === "SIGNAL_UNUSED";
    let te = "";
    if (
      netName &&
      !Qe &&
      !le &&
      !netName.startsWith("conn_") &&
      !netName.startsWith("port_in_") &&
      !netName.startsWith("gate_") &&
      !netName.startsWith("node_") &&
      !netName.startsWith("dff_") &&
      !netName.startsWith("latch_") &&
      !netName.startsWith("split_") &&
      !netName.startsWith("concat_") &&
      !netName.startsWith("add_") &&
      !netName.startsWith("sub_") &&
      !netName.startsWith("mul_") &&
      (!k || !k.has(netName)) &&
      d.points.length >= 2
    ) {
      if (k) {
        k.add(netName);
      }
      let _e = d.points[0];
      let Ke = d.points[1];
      let yn = Math.round((_e.x * 2 + Ke.x) / 3);
      let Se = Math.round((_e.y * 2 + Ke.y) / 3) - 5;
      te = `
        <text x="${yn}" y="${Se}" class="wire-net-label" font-size="9" font-family="monospace" font-weight="600" fill="currentColor" opacity="0.85">${escapeXml(netName)}</text>
      `;
    }
    return `
      <g id="${d.id}" class="schematic-wire ${C ? "wire-bus" : "wire-single"}" data-net="${escapeXml(netName)}" data-source="${d.sourceNodeId}" data-source-label="${escapeXml(X)}" data-target="${d.targetNodeId}" data-target-label="${escapeXml(Q)}" data-width="${d.bitWidth}">
        <path d="${reduce}" fill="none" stroke="transparent" stroke-width="16" stroke-linejoin="round" stroke-linecap="round" class="wire-hitbox" style="cursor: pointer; pointer-events: stroke;"/>
        <path d="${reduce}" fill="none" stroke="currentColor" stroke-width="${M}" stroke-linejoin="round" stroke-linecap="round" class="wire-path"/>
        ${Re}
        ${te}
      </g>
    `;
  }
}
