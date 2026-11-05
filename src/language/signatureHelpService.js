import { spanContains } from "./nodeLocator.js";

function rangeLabel(O) {
  return O && O.msb.kind === "NumberLiteral" && O.lsb.kind === "NumberLiteral"
    ? `[${O.msb.value}:${O.lsb.value}]`
    : "";
}

function portParameters(O) {
  let d = [];
  for (let item of O.items) {
    if (item.kind !== "PortDeclaration") {
      continue;
    }
    let k = rangeLabel(item.range);
    for (let identifier of item.identifiers) {
      d.push({
        label: `${item.direction} ${item.netType ?? "wire"} ${k ? k + " " : ""}${identifier.name}`
          .replace(/\s+/g, " ")
          .trim(),
        documentation: `${item.direction === "input" ? "Input" : item.direction === "output" ? "Output" : "Inout"} port${k ? `, ${k}` : ", scalar"}`,
      });
    }
  }
  return d;
}

function moduleParameters(O) {
  let d = [];
  for (let item of O.items) {
    if (item.kind !== "ParameterDeclaration") {
      continue;
    }
    let k = rangeLabel(item.range);
    for (let parameter of item.parameters) {
      d.push({
        label: `parameter ${k ? k + " " : ""}${parameter.name}`.replace(/\s+/g, " ").trim(),
        documentation: `Parameter${k ? `, ${k}` : ""}`,
      });
    }
  }
  return d;
}

function scanInstanceContext(O) {
  let d = {
    pendingEntry: undefined,
    completeEntries: 0,
    positionalSeparators: 0,
    inParameterRegion: false,
    namedSeen: false,
  };
  let m = 0;
  let k = -1;
  let E = -1;
  let C = false;
  for (let M = 0; M < O.length; M++) {
    let v = O[M];
    if (v === "#") {
      let R = M + 1;
      for (; R < O.length && /\s/.test(O[R]);) {
        R++;
      }
      if (O[R] === "(") {
        M = R;
        m++;
        k = m;
        d.inParameterRegion = true;
      }
      continue;
    }
    if (v === "(") {
      m++;
      if (k < 0) {
        k = m;
      }
      continue;
    }
    if (v === ")") {
      m--;
      if (E >= 0 && m === E) {
        d.completeEntries++;
        d.pendingEntry = undefined;
        E = -1;
      }
      if (m === k - 1) {
        k = -1;
        d.inParameterRegion = false;
      }
      continue;
    }
    if (v === "," && m === k) {
      if (!C && E < 0) {
        d.positionalSeparators++;
      }
      continue;
    }
    if (v === "." && m >= 1 && O[M + 1] && /[a-zA-Z_]/.test(O[M + 1])) {
      let match = /^\.\s*([a-zA-Z_][a-zA-Z0-9_$]*)\s*\(/.exec(O.slice(M));
      if (match) {
        d.pendingEntry = match[1];
        E = m;
        C = true;
        d.namedSeen = true;
        m++;
        M += match[0].length - 1;
      }
      continue;
    }
  }
  return d;
}

export class SignatureHelpService {
  getSignatureHelp(d, m, k, E, C, M) {
    let v = d.modules.find((te) => spanContains(m, k, te.span));
    if (!v) {
      return;
    }
    let R;
    for (let item of v.items) {
      if (item.kind === "InstanceDeclaration" && spanContains(m, k, item.span)) {
        R = item;
        break;
      }
    }
    let line = R?.span.start.line;
    if (!R && M) {
      let te = m - 1;
      for (let Oe = te; Oe >= 0 && Oe >= te - 30; Oe--) {
        let _e = M[Oe] ?? "";
        if (Oe < te && _e.includes(");")) {
          break;
        }
        let match =
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:#\s*\(.*?\)\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/.exec(_e);
        if (
          match &&
          ![
            "always",
            "initial",
            "if",
            "case",
            "casex",
            "casez",
            "function",
            "task",
            "module",
          ].includes(match[1])
        ) {
          R = {
            kind: "InstanceDeclaration",
            moduleName: match[1],
            instanceName: match[2],
            portConnections: [],
            span: {
              fileUri: E,
              start: {
                line: Oe + 1,
                column: 1,
              },
              end: {
                line: m,
                column: k,
              },
            },
          };
          line = Oe + 1;
          break;
        }
      }
    }
    if (!R) {
      return;
    }
    let X = d.modules.find((te) => te.name === R.moduleName);
    if (!X && C) {
      let te = C.resolveModule(R.moduleName, E);
      if (te.found && te.moduleNode) {
        X = te.moduleNode;
      }
    }
    if (!X) {
      return;
    }
    let Q = moduleParameters(X);
    let Re = portParameters(X);
    if (Q.length === 0 && Re.length === 0) {
      return;
    }
    let Qe = moduleSignatureLabel(X, Q, Re);
    let le = 0;
    if (M && line !== undefined) {
      let te = m - 1;
      let Oe =
        te === line - 1
          ? (M[line - 1] ?? "").slice(0, k - 1)
          : [M[line - 1] ?? "", ...M.slice(line, te), (M[te] ?? "").slice(0, k - 1)].join(`
`);
      let instanceContext = scanInstanceContext(Oe);
      if (instanceContext.inParameterRegion) {
        if (instanceContext.pendingEntry) {
          let index = Q.findIndex((yn) => yn.label.endsWith(instanceContext.pendingEntry));
          le = index >= 0 ? index : Math.max(0, Q.length - 1);
        } else {
          le = Math.min(instanceContext.completeEntries, Math.max(0, Q.length - 1));
        }
      } else {
        let count = Q.length;
        if (instanceContext.pendingEntry) {
          let index2 = Re.findIndex((Se) => Se.label.endsWith(instanceContext.pendingEntry));
          le = count + (index2 >= 0 ? index2 : Math.max(0, Re.length - 1));
        } else {
          if (instanceContext.namedSeen) {
            le = count + Math.min(instanceContext.completeEntries, Math.max(0, Re.length - 1));
          } else {
            le = count + Math.min(instanceContext.positionalSeparators, Math.max(0, Re.length - 1));
          }
        }
      }
    }
    return {
      signature: Qe,
      parameters: [...Q, ...Re],
      activeParameter: Math.min(le, Q.length + Re.length - 1),
    };
  }
}

function moduleSignatureLabel(O, d, m) {
  let k = [`module ${O.name}`];
  if (d.length > 0) {
    k.push(`#(${d.map((E) => lastWord(E.label)).join(", ")})`);
  }
  k.push(`(${m.map((E) => lastWord(E.label)).join(", ")})`);
  return k.join(" ");
}

function lastWord(O) {
  let parts = O.split(/\s+/);
  return parts[parts.length - 1] ?? O;
}
