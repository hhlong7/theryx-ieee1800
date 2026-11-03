import * as url from "url";
import * as path from "path";

export function baseIdentifier(O) {
  let d = O;
  for (; d.kind === "BitSelect" || d.kind === "PartSelect";) {
    d = d.target;
  }
  return d.kind === "Identifier" ? d : undefined;
}

export const checkNamingConventions = (O) => {
  let d = O.ruleConfig.params ?? {};
  let m = new RegExp(d.clockPattern ?? "^(clk|clock)(_[a-zA-Z0-9]+)?$", "i");
  let k = new RegExp(d.resetPattern ?? "^(rst|reset)(_[a-zA-Z0-9]+)?_n$", "i");
  for (let item of O.currentModule.items) {
    if (item.kind === "PortDeclaration" && item.direction === "input") {
      for (let identifier of item.identifiers) {
        let M = identifier.name.toLowerCase();
        if ((M.includes("clk") || M.includes("clock")) && !m.test(identifier.name)) {
          O.report(
            `Clock port '${identifier.name}' violates STARC naming convention (expected pattern: ${m.source}).`,
            identifier.span,
          );
        }
        if ((M.includes("rst") || M.includes("reset")) && !k.test(identifier.name)) {
          O.report(
            `Reset port '${identifier.name}' violates STARC naming convention (expected active-low pattern: ${k.source}).`,
            identifier.span,
          );
        }
      }
    }
  }
};

export const checkParameterNaming = (O) => {
  let m = (O.ruleConfig.params ?? {}).pattern ?? "^[A-Z0-9_]+$";
  let k = new RegExp(m);
  for (let item of O.currentModule.items) {
    if (item.kind !== "ParameterDeclaration") {
      continue;
    }
    let C = item;
    for (let parameter of C.parameters) {
      if (!k.test(parameter.name)) {
        O.report(
          `Parameter '${parameter.name}' violates STARC-1.1.2 naming convention (expected uppercase pattern: ${k.source}).`,
          parameter.span,
        );
      }
    }
  }
};

function fileUriToPath(O) {
  if (!O || O.startsWith("untitled:")) {
    return;
  }
  let d = O.split("?")[0].split("#")[0];
  if (d.startsWith("file://")) {
    try {
      d = url.fileURLToPath(d);
    } catch {
      d = d.replace(/^file:\/\/\/?/, "");
    }
  }
  let extname = path.extname(d);
  if (![".v", ".vh", ".sv", ".svh"].includes(extname)) {
    return;
  }
  let basename = path.basename(d, extname);
  if (basename) {
    return {
      baseName: basename,
      ext: extname,
    };
  }
}

export const checkModuleFilename = (O) => {
  let d = fileUriToPath(O.ast.span.fileUri);
  if (!d) {
    return;
  }
  let k = (O.ruleConfig.params ?? {}).caseSensitive !== false;
  let currentModule = O.currentModule;
  if (
    !(k
      ? currentModule.name === d.baseName
      : currentModule.name.toLowerCase() === d.baseName.toLowerCase())
  ) {
    O.report(
      `Module name '${currentModule.name}' does not match file base name '${d.baseName}'. According to STARC-1.2.1, module name should match the file name.`,
      currentModule.nameSpan ?? currentModule.span,
    );
  }
};

export const checkSingleModule = (O) => {
  let modules = O.ast.modules;
  if (!(modules.length <= 1)) {
    if (O.currentModule !== modules[0]) {
      O.report(
        `Multiple module definitions found in the same file ('${O.currentModule.name}'). STARC-1.2.2 recommends defining only one module per file.`,
        O.currentModule.nameSpan ?? O.currentModule.span,
      );
    }
  }
};

export function* walkItems(O) {
  for (let d of O) {
    if ((yield d, d.kind === "GenerateBlock")) {
      yield* walkItems(d.items);
      for (let statement of d.statements) {
        yield* walkGenerateItems(statement);
      }
    }
  }
}

function* walkGenerateItems(O) {
  if (O.kind === "GenerateBlockStatement") {
    yield* walkItems(O.items);
    for (let statement of O.statements) {
      yield* walkGenerateItems(statement);
    }
  } else {
    if (O.kind === "GenerateLoopStatement") {
      yield* walkGenerateItems(O.body);
    }
  }
}

export const checkMixedAssignments = (O) => {
  for (let d of walkItems(O.currentModule.items)) {
    if (d.kind !== "AlwaysBlock") {
      continue;
    }
    let m = [];
    let k = [];
    let E = (C) => {
      switch (C.kind) {
        case "BlockingAssign":
          if (!C.svLocalTarget) {
            m.push(C);
          }
          break;
        case "NonBlockingAssign":
          k.push(C);
          break;
        case "BlockStatement":
          for (let statement of C.statements) {
            E(statement);
          }
          break;
        case "IfStatement":
          E(C.thenBranch);
          if (C.elseBranch) {
            E(C.elseBranch);
          }
          break;
        case "CaseStatement":
          for (let item of C.items) {
            E(item.statement);
          }
          break;
        case "LoopStatement":
        case "GenerateLoopStatement":
          E(C.body);
          break;
        case "GenerateBlockStatement":
          for (let statement2 of C.statements) {
            E(statement2);
          }
          break;
      }
    };
    if ((E(d.statement), m.length > 0 && k.length > 0)) {
      let C = d.isSequential ? m[0] : k[0];
      let M = d.isSequential ? "sequential" : "combinational";
      let v = d.isSequential ? "non-blocking (<=)" : "blocking (=)";
      let R = d.isSequential ? "blocking (=)" : "non-blocking (<=)";
      O.report(
        `Mixed blocking (=) and non-blocking (<=) assignments in always block. In a ${M} block, use only ${v}; found ${R}.`,
        C.span,
      );
    }
  }
};

export const checkAssignmentType = (O) => {
  for (let d of walkItems(O.currentModule.items)) {
    if (d.kind !== "AlwaysBlock") {
      continue;
    }
    let isSequential = d.isSequential;
    let k = (E) => {
      switch (E.kind) {
        case "BlockingAssign":
          // Blocking writes to a block-local temporary are the idiom in always_ff.
          if (isSequential && !E.svLocalTarget) {
            O.report(
              "Sequential always block should use non-blocking assignment (<=), found blocking (=).",
              E.span,
            );
          }
          break;
        case "NonBlockingAssign":
          if (!isSequential) {
            O.report(
              "Combinational always @(*) block should use blocking assignment (=), found non-blocking (<=).",
              E.span,
            );
          }
          break;
        case "BlockStatement":
          for (let statement of E.statements) {
            k(statement);
          }
          break;
        case "IfStatement":
          k(E.thenBranch);
          if (E.elseBranch) {
            k(E.elseBranch);
          }
          break;
        case "CaseStatement":
          for (let item of E.items) {
            k(item.statement);
          }
          break;
        case "LoopStatement":
        case "GenerateLoopStatement":
          k(E.body);
          break;
        case "GenerateBlockStatement":
          for (let statement2 of E.statements) {
            k(statement2);
          }
          break;
      }
    };
    k(d.statement);
  }
};

export function scalarSymbol(O, d, m, k, E) {
  return {
    name: O,
    kind: d,
    direction: k,
    netType: E,
    msb: 0,
    lsb: 0,
    bitWidth: 1,
    span: m,
  };
}

export function vectorSymbol(O, d, m, k, E, C, M) {
  let v = Math.abs(m - k) + 1;
  return {
    name: O,
    kind: d,
    direction: C,
    netType: M,
    msb: m,
    lsb: k,
    bitWidth: v,
    span: E,
  };
}

function collectExpressionReads(O, d) {
  if (O) {
    switch (O.kind) {
      case "Identifier":
        if (!d.has(O.name)) {
          d.set(O.name, O.span);
        }
        break;
      case "BitSelect":
        collectExpressionReads(O.target, d);
        collectExpressionReads(O.index, d);
        break;
      case "PartSelect":
        collectExpressionReads(O.target, d);
        collectExpressionReads(O.msb, d);
        collectExpressionReads(O.lsb, d);
        break;
      case "BinaryExpression":
        collectExpressionReads(O.left, d);
        collectExpressionReads(O.right, d);
        break;
      case "UnaryExpression":
        collectExpressionReads(O.argument, d);
        break;
      case "TernaryExpression":
        collectExpressionReads(O.condition, d);
        collectExpressionReads(O.trueExpr, d);
        collectExpressionReads(O.falseExpr, d);
        break;
      case "Concatenation":
        for (let element of O.elements) {
          collectExpressionReads(element, d);
        }
        break;
      case "ReplicationExpression":
        collectExpressionReads(O.multiplier, d);
        for (let element2 of O.elements) {
          collectExpressionReads(element2, d);
        }
        break;
      case "FunctionCall":
      case "SystemFunctionCall":
        for (let arg of O.args) {
          collectExpressionReads(arg, d);
        }
        break;
    }
  }
}

function collectStatementReads(O, d) {
  switch (O.kind) {
    case "BlockingAssign":
    case "NonBlockingAssign":
      collectExpressionReads(O.rhs, d);
      break;
    case "BlockStatement":
      for (let statement of O.statements) {
        collectStatementReads(statement, d);
      }
      break;
    case "IfStatement":
      collectExpressionReads(O.condition, d);
      collectStatementReads(O.thenBranch, d);
      if (O.elseBranch) {
        collectStatementReads(O.elseBranch, d);
      }
      break;
    case "CaseStatement":
      collectExpressionReads(O.expression, d);
      for (let item of O.items) {
        for (let pattern of item.patterns) {
          collectExpressionReads(pattern, d);
        }
        collectStatementReads(item.statement, d);
      }
      break;
    case "LoopStatement":
      collectExpressionReads(O.initExpr, d);
      collectExpressionReads(O.condition, d);
      collectExpressionReads(O.stepExpr, d);
      collectExpressionReads(O.countExpr, d);
      collectStatementReads(O.body, d);
      break;
    case "TaskCallStatement":
      for (let arg of O.args) {
        collectExpressionReads(arg, d);
      }
      break;
    case "SystemTaskCall":
      for (let arg2 of O.args) {
        collectExpressionReads(arg2, d);
      }
      break;
    case "DelayStatement":
      collectExpressionReads(O.delayExpr, d);
      break;
    case "GenerateLoopStatement":
      collectStatementReads(O.body, d);
      break;
    case "GenerateBlockStatement":
      for (let statement2 of O.statements) {
        collectStatementReads(statement2, d);
      }
      break;
  }
}

export const checkIncompleteSensitivity = (O) => {
  for (let d of walkItems(O.currentModule.items)) {
    if (d.kind !== "AlwaysBlock") {
      continue;
    }
    let m = d;
    if (
      m.isSequential ||
      m.sensitivities.length === 0 ||
      m.sensitivities.some((M) => M.edge === "all")
    ) {
      continue;
    }
    let E = new Set();
    for (let sensitivity of m.sensitivities) {
      if (sensitivity.signal) {
        E.add(sensitivity.signal.name);
      }
    }
    let C = new Map();
    collectStatementReads(m.statement, C);
    for (let [M, v] of Array.from(C.entries())) {
      if (E.has(M)) {
        continue;
      }
      let resolve = O.moduleScope?.resolve(M);
      if (!(!resolve || resolve.kind === "parameter")) {
        O.report(
          `Signal '${M}' is read inside combinational always block but missing from the sensitivity list (STARC-2.2.1). Use @* to prevent simulation/synthesis mismatches.`,
          v,
        );
      }
    }
  }
};

function constantValue(O, d) {
  if (O.kind === "NumberLiteral") {
    return O.value;
  }
  if (O.kind === "Identifier" && d) {
    let resolve = d.resolve(O.name);
    if (resolve && resolve.kind === "parameter") {
      if (typeof resolve.value == "number") {
        return resolve.value;
      }
      if (typeof resolve.value == "string") {
        let int = parseInt(resolve.value.replace(/_/g, ""), 10);
        if (!isNaN(int)) {
          return int;
        }
      }
    }
  }
  if (O.kind === "BinaryExpression") {
    let m = constantValue(O.left, d);
    let k = constantValue(O.right, d);
    if (m !== undefined && k !== undefined) {
      switch (O.operator) {
        case "+":
          return m + k;
        case "-":
          return m - k;
        case "*":
          return m * k;
        case "/":
          return k !== 0 ? Math.floor(m / k) : 0;
        case "%":
          return k !== 0 ? m % k : 0;
        case "<<":
          return m << k;
        case ">>":
          return m >> k;
      }
    }
  }
  if (O.kind === "UnaryExpression") {
    let m = constantValue(O.argument, d);
    if (m !== undefined) {
      switch (O.operator) {
        case "+":
          return m;
        case "-":
          return -m;
        case "~":
          return ~m;
      }
    }
  }
}

function expressionWidth(O, d) {
  if (O.svWidth !== undefined || O.svWidthUnknown) {
    return O.svWidth;
  }
  switch (O.kind) {
    case "Identifier":
      return d?.resolve(O.name)?.bitWidth;
    case "BitSelect":
      return 1;
    case "PartSelect": {
      let m = constantValue(O.msb, d);
      let k = constantValue(O.lsb, d);
      return m !== undefined && k !== undefined ? Math.abs(m - k) + 1 : undefined;
    }
    case "Concatenation": {
      let m = 0;
      for (let element of O.elements) {
        let E = expressionWidth(element, d);
        if (E === undefined) {
          return;
        }
        m += E;
      }
      return m > 0 ? m : undefined;
    }
    case "NumberLiteral": {
      if (O.bitWidth !== undefined) {
        return O.bitWidth;
      }
      let index = O.raw.indexOf("'");
      if (index > 0) {
        let int = parseInt(O.raw.slice(0, index).replace(/_/g, ""), 10);
        if (!isNaN(int)) {
          return int;
        }
      }
      return 32;
    }
    default:
      return;
  }
}

function casePatternValues(O, d, m, k) {
  let E = (1 << m) - 1;
  if (O.kind !== "NumberLiteral" || !O.raw.includes("'")) {
    let Q = constantValue(O, k);
    return Q === undefined ? undefined : new Set([Q & E]);
  }
  let M = O.raw.indexOf("'") + 1;
  if (O.raw[M]?.toLowerCase() === "s") {
    M += 1;
  }
  let v = O.raw[M]?.toLowerCase();
  let R = O.raw.slice(M + 1).replace(/_/g, "");
  if (R.length === 0) {
    return;
  }
  let J = v === "b" ? 1 : v === "o" ? 3 : v === "h" ? 4 : undefined;
  if (J === undefined) {
    let Q = constantValue(O, k);
    return Q === undefined ? undefined : new Set([Q & E]);
  }
  let X = new Set([0]);
  for (let Q of R) {
    let Re = Q.toLowerCase();
    let Qe = Re === "?" || Re === "z" || (d === "casex" && Re === "x");
    if (Re === "x" && d !== "casex") {
      return;
    }
    if (Qe) {
      let _e = new Set();
      for (let Ke of X) {
        for (let yn = 0; yn < 1 << J; yn++) {
          _e.add(((Ke << J) | yn) & E);
        }
      }
      X = _e;
      continue;
    }
    let int = parseInt(Q, v === "b" ? 2 : v === "o" ? 8 : 16);
    if (isNaN(int)) {
      return;
    }
    let Oe = new Set();
    for (let _e of X) {
      Oe.add(((_e << J) | int) & E);
    }
    X = Oe;
  }
  return X;
}

export const checkCaseDefault = (O) => {
  for (let d of walkItems(O.currentModule.items)) {
    if (d.kind !== "AlwaysBlock") {
      continue;
    }
    let m = (k) => {
      switch (k.kind) {
        case "CaseStatement": {
          if (!k.items.some((C) => C.isDefault)) {
            let C = expressionWidth(k.expression, O.moduleScope);
            let M = false;
            if (C !== undefined && C > 0 && C <= 12) {
              let v = 1 << C;
              let R = new Set();
              let J = false;
              for (let item of k.items) {
                if (!item.isDefault) {
                  for (let pattern of item.patterns) {
                    let Re = casePatternValues(pattern, k.caseType, C, O.moduleScope);
                    if (Re === undefined) {
                      J = true;
                    } else {
                      for (let Qe of Re) {
                        R.add(Qe);
                      }
                    }
                  }
                }
              }
              if (!J && R.size >= v) {
                let X = true;
                for (let Q = 0; Q < v; Q++) {
                  if (!R.has(Q)) {
                    X = false;
                    break;
                  }
                }
                if (X) {
                  M = true;
                }
              }
            }
            if (!M) {
              O.report(
                "'case' statement is missing a 'default' clause. Add 'default:' to handle unspecified states and avoid latches.",
                k.span,
              );
            }
          }
          for (let item2 of k.items) {
            m(item2.statement);
          }
          break;
        }
        case "BlockStatement":
          for (let statement of k.statements) {
            m(statement);
          }
          break;
        case "IfStatement":
          m(k.thenBranch);
          if (k.elseBranch) {
            m(k.elseBranch);
          }
          break;
        case "LoopStatement":
        case "GenerateLoopStatement":
          m(k.body);
          break;
        case "GenerateBlockStatement":
          for (let statement2 of k.statements) {
            m(statement2);
          }
          break;
      }
    };
    m(d.statement);
  }
};

function constantValue2(O, d) {
  if (O.kind === "NumberLiteral") {
    return O.value;
  }
  if (O.kind === "Identifier" && d) {
    let resolve = d.resolve(O.name);
    if (resolve && resolve.kind === "parameter") {
      if (typeof resolve.value == "number") {
        return resolve.value;
      }
      if (typeof resolve.value == "string") {
        let int = parseInt(resolve.value.replace(/_/g, ""), 10);
        if (!isNaN(int)) {
          return int;
        }
      }
    }
  }
  if (O.kind === "BinaryExpression") {
    let m = constantValue2(O.left, d);
    let k = constantValue2(O.right, d);
    if (m !== undefined && k !== undefined) {
      switch (O.operator) {
        case "+":
          return m + k;
        case "-":
          return m - k;
        case "*":
          return m * k;
        case "/":
          return k !== 0 ? Math.floor(m / k) : 0;
        case "%":
          return k !== 0 ? m % k : 0;
        case "<<":
          return m << k;
        case ">>":
          return m >> k;
      }
    }
  }
}

function lvalueInfo(O, d) {
  if (O.kind === "Identifier") {
    return {
      width: d?.resolve(O.name)?.bitWidth,
      name: O.name,
    };
  }
  if (O.kind === "BitSelect") {
    return {
      width: O.svWidthUnknown ? undefined : (O.svWidth ?? 1),
      name: `${baseIdentifier(O)?.name ?? "target"}[...]`,
    };
  }
  if (O.kind === "PartSelect") {
    let m = baseIdentifier(O)?.name ?? "target";
    let k = constantValue2(O.msb, d);
    let E = constantValue2(O.lsb, d);
    return k !== undefined && E !== undefined
      ? {
          width: Math.abs(k - E) + 1,
          name: `${m}[${k}:${E}]`,
        }
      : {
          name: `${m}[...]`,
        };
  }
  return {
    name: "target",
  };
}

function inferWidth(O, d, m = false, k, E = false) {
  if (O.svWidth !== undefined || O.svWidthUnknown) {
    return O.svWidth;
  }
  switch (O.kind) {
    case "Identifier": {
      let resolve = d?.resolve(O.name);
      if (
        resolve &&
        resolve.kind === "parameter" &&
        m &&
        resolve.bitWidth === 32 &&
        typeof resolve.value == "number" &&
        k !== undefined &&
        k <= 32
      ) {
        let M = k >= 32 ? 4294967295 : (1 << k) - 1;
        if (resolve.value <= M) {
          return k;
        }
      }
      return resolve?.bitWidth;
    }
    case "BitSelect":
      return 1;
    case "PartSelect": {
      let C = constantValue2(O.msb, d);
      let M = constantValue2(O.lsb, d);
      return C !== undefined && M !== undefined ? Math.abs(C - M) + 1 : undefined;
    }
    case "NumberLiteral": {
      if (O.bitWidth !== undefined) {
        return O.bitWidth;
      }
      let index = O.raw.indexOf("'");
      if (index > 0) {
        let int = parseInt(O.raw.slice(0, index).replace(/_/g, ""), 10);
        if (!isNaN(int)) {
          return int;
        }
      }
      if (m && k !== undefined && k <= 32) {
        let M = k >= 32 ? 4294967295 : (1 << k) - 1;
        if (O.value <= M) {
          return k;
        }
      }
      return 32;
    }
    case "Concatenation": {
      let C = 0;
      for (let element of O.elements) {
        let v = inferWidth(element, d, m, k, E);
        if (v === undefined) {
          return;
        }
        C += v;
      }
      return C;
    }
    case "ReplicationExpression": {
      let C = 1;
      let M = constantValue2(O.multiplier, d);
      if (M !== undefined && M > 0) {
        C = M;
      }
      let v = 0;
      for (let element2 of O.elements) {
        let J = inferWidth(element2, d, m, k, E);
        if (J === undefined) {
          return;
        }
        v += J;
      }
      return v * C;
    }
    case "BinaryExpression": {
      if (["==", "!=", "===", "!==", "<", ">", "<=", ">=", "&&", "||"].includes(O.operator)) {
        return 1;
      }
      if (["<<", ">>", "<<<", ">>>"].includes(O.operator)) {
        return inferWidth(O.left, d, m, k, E);
      }
      let v = inferWidth(O.left, d, m, k, E);
      let R = inferWidth(O.right, d, m, k, E);
      return v !== undefined && R !== undefined
        ? E &&
          k !== undefined &&
          (((O.operator === "+" || O.operator === "-") &&
            k <= Math.max(v, R) + 1 &&
            k >= Math.max(v, R)) ||
            (O.operator === "*" && k <= v + R && k >= Math.max(v, R)))
          ? k
          : Math.max(v, R)
        : (v ?? R);
    }
    case "UnaryExpression":
      return ["&", "~&", "|", "~|", "^", "~^", "^~", "!"].includes(O.operator)
        ? 1
        : inferWidth(O.argument, d, m, k, E);
    case "TernaryExpression": {
      let C = inferWidth(O.trueExpr, d, m, k, E);
      let M = inferWidth(O.falseExpr, d, m, k, E);
      return C !== undefined && M !== undefined ? Math.max(C, M) : (C ?? M);
    }
    default:
      return;
  }
}

export const checkBitwidthMismatch = (O) => {
  let moduleScope = O.moduleScope;
  let m = O.ruleConfig.params ?? {};
  let k = m.allowUnsizedLiterals === true;
  let E = m.allowArithmeticBitGrowth === true;
  function C(v, R) {
    let J = lvalueInfo(v, moduleScope);
    if (J.width === undefined) {
      return;
    }
    let X = inferWidth(R, moduleScope, k, J.width, E);
    if (X !== undefined && J.width !== X) {
      O.report(
        `Bit-width mismatch in assignment to '${J.name}': LHS is ${J.width} bit(s), but RHS is ${X} bit(s). (STARC-3.1.1)`,
        v.span,
      );
    }
  }
  function M(v) {
    if (v) {
      switch (v.kind) {
        case "BlockingAssign":
        case "NonBlockingAssign":
          C(v.lhs, v.rhs);
          break;
        case "BlockStatement":
          for (let statement of v.statements) {
            M(statement);
          }
          break;
        case "IfStatement":
          M(v.thenBranch);
          if (v.elseBranch) {
            M(v.elseBranch);
          }
          break;
        case "CaseStatement":
          for (let item of v.items) {
            M(item.statement);
          }
          break;
        case "LoopStatement":
        case "GenerateLoopStatement":
          M(v.body);
          break;
        case "GenerateBlockStatement":
          for (let statement2 of v.statements) {
            M(statement2);
          }
          break;
      }
    }
  }
  for (let v of walkItems(O.currentModule.items)) {
    if (v.kind === "ContinuousAssign") {
      C(v.lhs, v.rhs);
    } else {
      if (v.kind === "AlwaysBlock") {
        M(v.statement);
      }
    }
  }
};

const cloneAssignState = (O) => ({
  definite: new Set(O.definite),
  maybe: new Set(O.maybe),
});

function lvalueNames(O) {
  if (!O) {
    return [];
  }
  switch (O.kind) {
    case "Identifier":
      return [O.name];
    case "BitSelect":
    case "PartSelect": {
      let d = baseIdentifier(O);
      return d ? [d.name] : [];
    }
    case "Concatenation":
      return O.elements.flatMap((d) => lvalueNames(d));
    default:
      return [];
  }
}

function caseIsFullyCovered(O, d) {
  let m = expressionWidth(O.expression, d);
  if (m === undefined || m <= 0 || m > 12) {
    return false;
  }
  let k = 1 << m;
  let E = new Set();
  for (let item of O.items) {
    if (item.isDefault) {
      return true;
    }
    for (let pattern of item.patterns) {
      let v = casePatternValues(pattern, O.caseType, m, d);
      if (v === undefined) {
        return false;
      }
      for (let R of v) {
        E.add(R);
      }
    }
  }
  if (E.size < k) {
    return false;
  }
  for (let C = 0; C < k; C++) {
    if (!E.has(C)) {
      return false;
    }
  }
  return true;
}

function trackIfAssignments(O, d, m, k) {
  let E = cloneAssignState(d);
  let C = cloneAssignState(d);
  trackAssignments(O.thenBranch, C, m, k);
  let M = cloneAssignState(d);
  if (O.elseBranch) {
    trackAssignments(O.elseBranch, M, m, k);
  }
  d.definite = new Set([...C.definite].filter((v) => M.definite.has(v)));
  d.maybe = new Set([...C.maybe, ...M.maybe]);
  for (let maybeItem of d.maybe) {
    if (!(E.definite.has(maybeItem) || d.definite.has(maybeItem) || m.has(maybeItem))) {
      m.set(maybeItem, O.span);
    }
  }
}

function trackCaseAssignments(O, d, m, k) {
  let E = cloneAssignState(d);
  let C = [];
  for (let item of O.items) {
    let Q = cloneAssignState(d);
    trackAssignments(item.statement, Q, m, k);
    C.push(Q);
  }
  if ((caseIsFullyCovered(O, k) || C.push(cloneAssignState(d)), C.length === 0)) {
    return;
  }
  let [M, ...v] = C;
  let R = new Set(M.definite);
  for (let X of v) {
    for (let Q of [...R]) {
      if (!X.definite.has(Q)) {
        R.delete(Q);
      }
    }
  }
  let J = new Set();
  for (let X of C) {
    for (let maybeItem of X.maybe) {
      J.add(maybeItem);
    }
  }
  d.definite = R;
  d.maybe = J;
  for (let maybeItem2 of d.maybe) {
    if (!(E.definite.has(maybeItem2) || d.definite.has(maybeItem2) || m.has(maybeItem2))) {
      m.set(maybeItem2, O.span);
    }
  }
}

function trackAssignments(O, d, m, k) {
  switch (O.kind) {
    case "BlockingAssign":
    case "NonBlockingAssign":
      for (let E of lvalueNames(O.lhs)) {
        d.definite.add(E);
        d.maybe.add(E);
      }
      break;
    case "BlockStatement":
      for (let statement of O.statements) {
        trackAssignments(statement, d, m, k);
      }
      break;
    case "IfStatement":
      trackIfAssignments(O, d, m, k);
      break;
    case "CaseStatement":
      trackCaseAssignments(O, d, m, k);
      break;
    case "LoopStatement":
    case "GenerateLoopStatement":
      trackAssignments(O.body, cloneAssignState(d), m, k);
      break;
    case "GenerateBlockStatement":
      for (let statement2 of O.statements) {
        trackAssignments(statement2, d, m, k);
      }
      break;
    default:
      break;
  }
}

function findLatchedVariables(O, d) {
  let m = {
    definite: new Set(),
    maybe: new Set(),
  };
  let k = new Map();
  trackAssignments(O, m, k, d);
  let E = [];
  for (let [C, M] of k) {
    if (!m.definite.has(C)) {
      E.push({
        variable: C,
        span: M,
      });
    }
  }
  return E;
}

export const checkLatchInference = (O) => {
  for (let d of walkItems(O.currentModule.items)) {
    if (d.alwaysKind === "always_latch") {
      continue;
    }
    if (d.kind === "AlwaysBlock" && !d.isSequential) {
      for (let m of findLatchedVariables(d.statement, O.moduleScope)) {
        O.report(
          `Inferred latch risk: signal '${m.variable}' is not assigned on every path of the combinational always @(*) block. Assign it in all branches of the 'if' statement or provide a default assignment before it.`,
          m.span,
        );
      }
    }
  }
};

export const checkNamedPorts = (O) => {
  for (let item of O.currentModule.items) {
    if (item.kind === "InstanceDeclaration") {
      if (item.portConnections.length === 0) {
        O.report(
          `Module instance '${item.instanceName}' of '${item.moduleName}' has no port connections. Use explicit named connections: .port(net).`,
          item.span,
        );
        continue;
      }
      for (let portConnection of item.portConnections) {
        if (
          !portConnection.portName ||
          portConnection.portName.trim() === "" ||
          portConnection.portName.startsWith("__pos_")
        ) {
          O.report(
            `Module instance '${item.instanceName}' of '${item.moduleName}' uses positional or empty port connection. Use explicit named connections: .port(net).`,
            portConnection.span,
          );
        }
      }
    }
  }
};
