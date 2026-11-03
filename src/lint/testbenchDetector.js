const IDENT_START = /[A-Za-z_]/;

const IDENT_PART = /[A-Za-z0-9_$]/;

const DIGIT = /[0-9]/;

function tokenizeForDelays(O) {
  let d = [];
  let count = O.length;
  let k = 0;
  for (; k < count;) {
    let E = O[k];
    if (
      E === " " ||
      E === "	" ||
      E === "\r" ||
      E ===
        `
`
    ) {
      k++;
      continue;
    }
    if (E === "/" && O[k + 1] === "/") {
      for (
        ;
        k < count &&
        O[k] !==
          `
`;
      ) {
        k++;
      }
      continue;
    }
    if (E === "/" && O[k + 1] === "*") {
      for (k += 2; k < count && !(O[k] === "*" && O[k + 1] === "/");) {
        k++;
      }
      k = Math.min(count, k + 2);
      continue;
    }
    if (E === '"') {
      for (k++; k < count && O[k] !== '"';) {
        if (O[k] === "\\") {
          k++;
        }
        k++;
      }
      k = Math.min(count, k + 1);
      continue;
    }
    if (E === "`") {
      for (k++; k < count && IDENT_PART.test(O[k]);) {
        k++;
      }
      continue;
    }
    if (E === "\\") {
      let C = k;
      for (k++; k < count && !/\s/.test(O[k]);) {
        k++;
      }
      d.push({
        kind: "id",
        text: O.slice(C, k),
        start: C,
      });
      continue;
    }
    if (IDENT_START.test(E)) {
      let C = k;
      for (; k < count && IDENT_PART.test(O[k]);) {
        k++;
      }
      d.push({
        kind: "id",
        text: O.slice(C, k),
        start: C,
      });
      continue;
    }
    if (DIGIT.test(E)) {
      let C = k;
      for (; k < count && /[0-9_]/.test(O[k]);) {
        k++;
      }
      if (O[k] === "." && DIGIT.test(O[k + 1] ?? "")) {
        for (k++; k < count && /[0-9_]/.test(O[k]);) {
          k++;
        }
      }
      if (O[k] === "'" && /[sS]?[bBoOdDhH]/.test(O.slice(k + 1, k + 3))) {
        for (
          k++, /[sS]/.test(O[k] ?? "") && k++, k++;
          k < count && /[0-9a-fA-F_xXzZ?]/.test(O[k]);
        ) {
          k++;
        }
      }
      d.push({
        kind: "num",
        text: O.slice(C, k),
        start: C,
      });
      continue;
    }
    d.push({
      kind: "punc",
      text: E,
      start: k,
    });
    k++;
  }
  return d;
}

function markProceduralTokens(O) {
  let fill = new Array(O.length).fill(false);
  let m = [];
  let k = 0;
  let E = false;
  let C = (v) => {
    m.push(v);
    if (v.kind === "proc" || v.kind === "task" || v.kind === "function") {
      k++;
    }
  };
  let M = () => m.pop();
  for (let v = 0; v < O.length; v++) {
    let R = O[v];
    switch (R.kind === "id" ? R.text : "") {
      case "always":
      case "always_ff":
      case "always_comb":
      case "always_latch":
      case "initial":
        C({
          kind: "proc",
        });
        E = true;
        break;
      case "task":
        C({
          kind: "task",
        });
        break;
      case "function":
        C({
          kind: "function",
        });
        break;
      case "begin":
        C({
          kind: "block",
          closesProc: E,
        });
        E = false;
        break;
      case "end": {
        if (M()?.closesProc) {
          M();
          k--;
        }
        break;
      }
      case "endtask":
      case "endfunction": {
        for (; m.length > 0;) {
          let X = M();
          if (X.kind === "task" || X.kind === "function") {
            k--;
            break;
          }
        }
        break;
      }
      case "case":
      case "casex":
      case "casez":
        C({
          kind: "case",
        });
        break;
      case "endcase":
      case "join":
      case "endgenerate":
      case "endspecify":
        M();
        break;
      case "fork":
        C({
          kind: "fork",
        });
        break;
      case "generate":
        C({
          kind: "generate",
        });
        break;
      case "specify":
        C({
          kind: "specify",
        });
        break;
      case "endmodule":
        m.length = 0;
        k = 0;
        break;
      case ";":
        if (E) {
          M();
          k--;
          E = false;
        }
        break;
      default:
        break;
    }
    fill[v] = k > 0;
  }
  return fill;
}

function findMatchingParen(O, d) {
  let m = 0;
  for (let k = d; k < O.length; k++) {
    let E = O[k];
    if (E.kind === "punc") {
      if (E.text === "(") {
        m++;
      } else if (E.text === ")" && (m--, m === 0)) {
        return k;
      }
    }
  }
  return -1;
}

function hasNamedPortPattern(O) {
  for (let d = 0; d + 2 < O.length; d++) {
    let m = O[d];
    let k = O[d + 1];
    let E = O[d + 2];
    if (
      m.kind === "punc" &&
      m.text === "." &&
      k.kind === "id" &&
      E.kind === "punc" &&
      E.text === "("
    ) {
      return true;
    }
  }
  return false;
}

function isModuleHeaderHash(O, d) {
  let m = O[d - 1];
  let k = O[d - 2];
  return !!m && m.kind === "id" && !!k && k.kind === "id" && k.text === "module";
}

function findTimingDelays(O) {
  let d = tokenizeForDelays(O);
  let m = markProceduralTokens(d);
  let k = [];
  for (let E = 0; E < d.length; E++) {
    let C = d[E];
    if (C.kind !== "punc" || C.text !== "#") {
      continue;
    }
    let M = d[E + 1];
    if (M) {
      if (M.kind === "num") {
        if (isModuleHeaderHash(d, E)) {
          continue;
        }
        k.push({
          text: `#${M.text}`,
          kind: "number",
        });
        continue;
      }
      if (M.kind === "punc" && M.text === "(") {
        let matchingParen = findMatchingParen(d, E + 1);
        if (matchingParen < 0) {
          continue;
        }
        let R = d.slice(E + 2, matchingParen);
        if (hasNamedPortPattern(R) || !m[E]) {
          continue;
        }
        k.push({
          text: `#(${R.map((J) => J.text).join(" ")})`,
          kind: "parenthesised",
        });
      }
    }
  }
  return k;
}

function stripComments(O) {
  return O.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    `
`.repeat((m.match(/\n/g) || []).length),
  ).replace(/\/\/[^\r\n]*/g, "");
}

export function detectTestbench(O, d, m) {
  let k = m?.threshold ?? 4;
  let E = stripComments(O);
  let C = [];
  let M = 0;
  let v = 0;
  let timingDelays = findTimingDelays(E);
  if (timingDelays.length > 0) {
    M += 4;
    v += 4;
    C.push(`timing delay construct ('${timingDelays[0].text.trim()}')`);
  }
  if (/\b(?:always|forever)\s*#/.test(E)) {
    M += 4;
    v += 4;
    C.push("simulation clock generator pattern (always/forever #delay)");
  }
  let match = E.match(/\$(?:finish|stop|fatal|exit)\b/);
  if (match) {
    M += 4;
    v += 4;
    C.push(`simulation control task ('${match[0]}')`);
  }
  let match2 = E.match(
    /\$(?:dumpfile|dumpvars|dumpon|dumpoff|dumpall|fsdbDumpfile|fsdbDumpvars)\b/,
  );
  if (match2) {
    M += 3;
    v += 3;
    C.push(`waveform dumping task ('${match2[0]}')`);
  }
  let Q = E.replace(/always\s*@\s*(?:\([^)]*\)|\*)/g, "");
  if (/@\s*\(\s*(?:posedge|negedge|[a-zA-Z_])/.test(Q)) {
    M += 3;
    v += 3;
    C.push("procedural event waiting (@) inside block or task");
  }
  if (/===|!==/.test(E)) {
    M += 3;
    C.push("4-state equality operator (=== / !==)");
  }
  if (/\b(?:forever|repeat\s*\()/.test(E)) {
    M += 2;
    v += 2;
    C.push("simulation loop statement (forever/repeat)");
  }
  let match3 = E.match(/\$(?:display|monitor|strobe|write)\b/);
  if (match3) {
    M += 2;
    v += 2;
    C.push(`simulation reporting task ('${match3[0]}')`);
  }
  let match4 = E.match(/\$(?:time|stime|realtime|random|urandom|urandom_range)\b/);
  if (match4) {
    M += 2;
    v += 2;
    C.push(`simulation query/random task ('${match4[0]}')`);
  }
  let match5 = E.match(/\$(?:readmemh|readmemb|fopen|fclose|fdisplay|fwrite|fscanf|sscanf|feof)\b/);
  if (match5) {
    M += 2;
    v += 2;
    C.push(`file I/O simulation task ('${match5[0]}')`);
  }
  if (/\btask\b[\s\S]*?\bendtask\b/.test(E)) {
    M += 2;
    v += 2;
    C.push("verification task definition (task...endtask)");
  }
  let match6 = E.match(/\bmodule\s+([a-zA-Z_]\w*)\s*(?:;\s*|\(\s*\)\s*;)/);
  if (
    (match6 && v > 0 && ((M += 2), C.push(`zero-port closed test fixture module '${match6[1]}'`)),
    d)
  ) {
    let Ke = d.replace(/\\/g, "/").split("/").pop() ?? "";
    if (/(?:^tb_|_tb\.[a-zA-Z0-9]+$|_testbench\.[a-zA-Z0-9]+$|_sim\.[a-zA-Z0-9]+$)/i.test(Ke)) {
      M += 1;
      C.push(`filename testbench pattern ('${Ke}')`);
    }
  }
  let Oe = match6?.[1];
  if (Oe && /(?:^tb_|_tb$|_testbench$|_sim$)/i.test(Oe)) {
    M += 1;
    C.push(`module name testbench pattern ('${Oe}')`);
  }
  return {
    isTestbench: M >= k,
    score: M,
    reasons: C,
  };
}
