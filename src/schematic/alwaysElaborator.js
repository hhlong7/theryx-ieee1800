import { baseIdentifier } from "../lint/rtlCheckers.js";

export class AlwaysElaborator {
  exprElaborator;
  isSequentialContext = false;
  constructor(exprElaborator) {
    this.exprElaborator = exprElaborator;
  }
  selectCoversWholeSignal(d, m) {
    let k = this.exprElaborator.scope?.resolve(m)?.bitWidth ?? 1;
    return d.kind === "BitSelect"
      ? k === 1
      : d.kind === "PartSelect"
        ? d.msb.kind !== "NumberLiteral" || d.lsb.kind !== "NumberLiteral"
          ? false
          : Math.abs(d.msb.value - d.lsb.value) + 1 === k
        : false;
  }
  elaborateAlways(d) {
    if (d.sensitivities.length === 0) {
      let m = d.delayExpr
        ? "Delay-controlled 'always' is a simulation construct (e.g. a clock generator) and is not synthesizable"
        : "'always' without an event or delay control is not synthesizable and never advances simulation time (zero-delay infinite loop)";
      let allAssignedVars = this.findAllAssignedVars(d.statement);
      for (let allAssignedVar of allAssignedVars) {
        this.exprElaborator.registerSignalSource(
          allAssignedVar,
          this.exprElaborator.createUnsupportedSource("always", m),
        );
      }
      return;
    }
    if (d.isSequential) {
      this.elaborateSequential(d);
    } else {
      this.elaborateCombinational(d.statement);
    }
  }
  elaborateCombinational(d) {
    switch (d.kind) {
      case "BlockingAssign":
      case "NonBlockingAssign": {
        let expression = this.exprElaborator.elaborateExpression(d.rhs);
        let k = "";
        if (d.lhs.kind === "Identifier") {
          k = d.lhs.name;
        } else if (
          (d.lhs.kind === "BitSelect" || d.lhs.kind === "PartSelect") &&
          ((k = baseIdentifier(d.lhs)?.name ?? ""), k && !this.selectCoversWholeSignal(d.lhs, k))
        ) {
          this.exprElaborator.registerSignalSource(
            k,
            this.exprElaborator.createUnsupportedSource(
              k,
              `Partial assignment to '${k}[...]' cannot be merged bit-by-bit yet`,
            ),
          );
          break;
        }
        if (k) {
          this.exprElaborator.registerSignalSource(k, expression);
        }
        break;
      }
      case "BlockStatement":
        for (let statement of d.statements) {
          this.elaborateCombinational(statement);
        }
        break;
      case "IfStatement":
        this.elaborateIfStatement(d);
        break;
      case "CaseStatement":
        this.elaborateCaseStatement(d);
        break;
      case "EmptyStatement":
        break;
    }
  }
  elaborateIfStatement(d) {
    let expression = this.exprElaborator.elaborateExpression(d.condition);
    let allAssignedVars = this.findAllAssignedVars(d);
    let E = new Map();
    for (let allAssignedVar of allAssignedVars) {
      let value = this.exprElaborator.signalOutputs.get(allAssignedVar);
      if (value) {
        E.set(allAssignedVar, value);
      }
    }
    this.elaborateCombinational(d.thenBranch);
    let C = new Map();
    for (let allAssignedVar2 of allAssignedVars) {
      let value2 = this.exprElaborator.signalOutputs.get(allAssignedVar2);
      if (value2 && value2 !== E.get(allAssignedVar2)) {
        C.set(allAssignedVar2, value2);
      }
    }
    for (let allAssignedVar3 of allAssignedVars) {
      let value3 = E.get(allAssignedVar3);
      if (value3) {
        this.exprElaborator.registerSignalSource(allAssignedVar3, value3);
      } else {
        this.exprElaborator.signalOutputs.delete(allAssignedVar3);
      }
    }
    let M = new Map();
    if (d.elseBranch) {
      this.elaborateCombinational(d.elseBranch);
      for (let allAssignedVar4 of allAssignedVars) {
        let value4 = this.exprElaborator.signalOutputs.get(allAssignedVar4);
        if (value4 && value4 !== E.get(allAssignedVar4)) {
          M.set(allAssignedVar4, value4);
        }
      }
    }
    for (let allAssignedVar5 of allAssignedVars) {
      let value5 = C.get(allAssignedVar5);
      let value6 = M.get(allAssignedVar5);
      let value7 = E.get(allAssignedVar5);
      if (!this.isSequentialContext && value5 && !value6 && !value7) {
        let latch = this.createLatch(expression, value5, d.span);
        this.exprElaborator.registerSignalSource(allAssignedVar5, latch);
        continue;
      }
      if (!this.isSequentialContext && value6 && !value5 && !value7) {
        let nodeId = this.exprElaborator.createNodeId("gate_not");
        let te = {
          id: nodeId,
          type: "GATE_NOT",
          label: "~",
          pins: [
            {
              id: "in",
              name: "A",
              direction: "in",
              bitWidth: 1,
            },
            {
              id: "out",
              name: "Y",
              direction: "out",
              bitWidth: 1,
            },
          ],
          bitWidth: 1,
          span: d.span,
        };
        this.exprElaborator.nodes.push(te);
        this.exprElaborator.connect(expression.nodeId, expression.pinId, nodeId, "in", 1);
        let Oe = {
          nodeId: nodeId,
          pinId: "out",
          bitWidth: 1,
        };
        let latch2 = this.createLatch(Oe, value6, d.span);
        this.exprElaborator.registerSignalSource(allAssignedVar5, latch2);
        continue;
      }
      let Q = value7;
      if (!Q && this.isSequentialContext) {
        Q = this.exprElaborator.elaborateExpression({
          kind: "Identifier",
          name: allAssignedVar5,
          span: d.span,
        });
      }
      let Re = value5 ?? Q;
      let Qe = value6 ?? Q;
      if (Re && Qe && Re.nodeId === Qe.nodeId && Re.pinId === Qe.pinId) {
        this.exprElaborator.registerSignalSource(allAssignedVar5, Re);
      } else if (Re || Qe) {
        let maxValue = Math.max(Re?.bitWidth ?? 1, Qe?.bitWidth ?? 1);
        let te = Re ?? this.exprElaborator.createConstantSource(0, maxValue);
        let Oe = Qe ?? this.exprElaborator.createConstantSource(0, maxValue);
        let mux = this.createMux(expression, te, Oe, d.span);
        this.exprElaborator.registerSignalSource(allAssignedVar5, mux);
      }
    }
  }
  elaborateCaseStatement(d) {
    if (d.caseType !== "case") {
      let le = new Set();
      for (let item of d.items) {
        for (let Oe of this.findAllAssignedVars(item.statement)) {
          le.add(Oe);
        }
      }
      for (let te of le) {
        this.exprElaborator.registerSignalSource(
          te,
          this.exprElaborator.createUnsupportedSource(
            d.caseType,
            `'${d.caseType}' wildcard matching is not elaborated`,
          ),
        );
      }
      return;
    }
    let expression = this.exprElaborator.elaborateExpression(d.expression);
    let k = new Set();
    for (let item2 of d.items) {
      for (let te of this.findAllAssignedVars(item2.statement)) {
        k.add(te);
      }
    }
    if (k.size === 0) {
      return;
    }
    let E = new Map();
    for (let le of k) {
      let value = this.exprElaborator.signalOutputs.get(le);
      if (value) {
        E.set(le, value);
      }
    }
    let C = d.items.find((le) => le.isDefault);
    let M = new Map();
    if (C) {
      this.elaborateCombinational(C.statement);
      for (let le of k) {
        let value2 = this.exprElaborator.signalOutputs.get(le);
        if (value2) {
          M.set(le, value2);
        }
      }
    }
    let v = d.items.filter((le) => !le.isDefault);
    let R = [];
    let J = [];
    for (let le of v) {
      for (let _e of k) {
        let value3 = E.get(_e);
        if (value3) {
          this.exprElaborator.registerSignalSource(_e, value3);
        } else {
          this.exprElaborator.signalOutputs.delete(_e);
        }
      }
      if (le.patterns.length > 0) {
        let _e = [];
        for (let pattern of le.patterns) {
          let expression2 = this.exprElaborator.elaborateExpression(pattern);
          let nodeId = this.exprElaborator.createNodeId("cmp_eq");
          let jn = {
            id: "in0",
            name: "A",
            direction: "in",
            bitWidth: expression.bitWidth,
          };
          let Ln = {
            id: "in1",
            name: "B",
            direction: "in",
            bitWidth: expression2.bitWidth,
          };
          let ji = {
            id: "out",
            name: "Y",
            direction: "out",
            bitWidth: 1,
          };
          let Hr = {
            id: nodeId,
            type: "COMPARE_EQ",
            label: "==",
            pins: [jn, Ln, ji],
            bitWidth: 1,
            attributes: {
              isExpandable: true,
              macroType: "compare",
              operator: "==",
            },
          };
          this.exprElaborator.nodes.push(Hr);
          this.exprElaborator.connect(
            expression.nodeId,
            expression.pinId,
            nodeId,
            "in0",
            expression.bitWidth,
          );
          this.exprElaborator.connect(
            expression2.nodeId,
            expression2.pinId,
            nodeId,
            "in1",
            expression2.bitWidth,
          );
          _e.push({
            nodeId: nodeId,
            pinId: "out",
            bitWidth: 1,
          });
        }
        R.push(this.combineWithOr(_e));
      } else {
        R.push(this.exprElaborator.createConstantSource(1, 1));
      }
      this.elaborateCombinational(le.statement);
      let te = new Map();
      let allAssignedVars = this.findAllAssignedVars(le.statement);
      for (let allAssignedVar of allAssignedVars) {
        let value4 = this.exprElaborator.signalOutputs.get(allAssignedVar);
        if (value4) {
          te.set(allAssignedVar, value4);
        }
      }
      J.push(te);
    }
    let bitWidth = expression.bitWidth;
    let pow = Math.pow(2, bitWidth);
    let Re = new Set();
    for (let le of v) {
      for (let pattern2 of le.patterns) {
        if (pattern2.kind === "NumberLiteral") {
          Re.add(pattern2.value);
        }
      }
    }
    let Qe = Re.size >= pow;
    for (let le of k) {
      let te = M.has(le) || E.has(le) || Qe;
      let Oe = [];
      let _e = M.get(le) ?? E.get(le);
      if (!_e && this.isSequentialContext) {
        _e = this.exprElaborator.elaborateExpression({
          kind: "Identifier",
          name: le,
          span: d.span,
        });
        te = true;
      }
      for (let Ke = v.length - 1; Ke >= 0; Ke--) {
        let value5 = J[Ke]?.get(le);
        let Se = R[Ke];
        if (value5 && Se) {
          Oe.unshift(Se);
          if (_e) {
            _e = this.createMux(Se, value5, _e, v[Ke]?.span ?? d.span);
          } else {
            _e = value5;
          }
        }
      }
      if (_e) {
        if (!te && Oe.length > 0 && !this.isSequentialContext) {
          let combineWithOr = this.combineWithOr(Oe);
          let latch = this.createLatch(combineWithOr, _e, d.span);
          this.exprElaborator.registerSignalSource(le, latch);
        } else {
          this.exprElaborator.registerSignalSource(le, _e);
        }
      }
    }
  }
  elaborateSequential(d) {
    let m = d.sensitivities.filter(
      (te) => te.signal && (te.edge === "posedge" || te.edge === "negedge"),
    );
    let k = (te) => {
      let Oe = te.toLowerCase();
      return Oe.includes("clk") || Oe.includes("clock");
    };
    let E = (te) => {
      let Oe = te.toLowerCase();
      return Oe.includes("rst") || Oe.includes("reset");
    };
    let C = m.find((te) => E(te.signal.name) && !k(te.signal.name));
    let M;
    let v = false;
    let R = false;
    if (C) {
      M = C.signal.name;
      v = C.edge === "negedge";
      R = true;
    }
    let J = "";
    let X = m.find((te) => k(te.signal.name));
    if (X) {
      J = X.signal.name;
    } else {
      let te = m.find((Oe) => Oe.signal.name !== M);
      if (te) {
        J = te.signal.name;
      } else {
        J = d.sensitivities.find((_e) => _e.signal)?.signal?.name ?? "";
      }
    }
    let allAssignedVars = this.findAllAssignedVars(d.statement);
    if (allAssignedVars.size === 0) {
      return;
    }
    let Re = new Map();
    let Qe = new Map();
    let le = (te) => {
      if (te.kind === "BlockStatement") {
        for (let statement of te.statements) {
          le(statement);
        }
      } else if (te.kind === "IfStatement" && M && this.testsSignal(te.condition, M)) {
        if (
          !R &&
          te.condition.kind === "UnaryExpression" &&
          (te.condition.operator === "!" || te.condition.operator === "~")
        ) {
          v = true;
        }
        let extractResetValues = this.extractResetValues(te.thenBranch);
        for (let [_e, Ke] of extractResetValues.entries()) {
          Qe.set(_e, Ke);
        }
        if (te.elseBranch) {
          this.elaborateCombinational(te.elseBranch);
          for (let allAssignedVar of allAssignedVars) {
            let value = this.exprElaborator.signalOutputs.get(allAssignedVar);
            if (value) {
              Re.set(allAssignedVar, value);
            }
          }
        }
      } else {
        this.elaborateCombinational(te);
        for (let allAssignedVar2 of allAssignedVars) {
          let value2 = this.exprElaborator.signalOutputs.get(allAssignedVar2);
          if (value2) {
            Re.set(allAssignedVar2, value2);
          }
        }
      }
    };
    this.isSequentialContext = true;
    try {
      for (let allAssignedVar3 of allAssignedVars) {
        let expression = this.exprElaborator.elaborateExpression({
          kind: "Identifier",
          name: allAssignedVar3,
          span: d.span,
        });
        this.exprElaborator.registerSignalSource(allAssignedVar3, expression);
      }
      le(d.statement);
    } finally {
      this.isSequentialContext = false;
    }
    for (let allAssignedVar4 of allAssignedVars) {
      let value3 = Re.get(allAssignedVar4);
      let Ke =
        this.exprElaborator.scope?.resolve(allAssignedVar4)?.bitWidth ?? value3?.bitWidth ?? 1;
      let yn =
        value3 ??
        this.exprElaborator.signalOutputs.get(allAssignedVar4) ??
        this.exprElaborator.createConstantSource(0, Ke);
      let nodeId = this.exprElaborator.createNodeId("dff");
      let Hr = [
        {
          id: "clk",
          name: "CLK",
          direction: "clock",
          bitWidth: 1,
        },
        {
          id: "d",
          name: "D",
          direction: "in",
          bitWidth: Ke,
        },
        {
          id: "q",
          name: "Q",
          direction: "out",
          bitWidth: Ke,
        },
      ];
      if (M) {
        let xr = {
          id: "rst",
          name: "RST",
          direction: "reset",
          bitWidth: 1,
        };
        Hr.push(xr);
      }
      let value4 = Qe.get(allAssignedVar4);
      let Di = {
        id: nodeId,
        type: "DFF",
        label: `DFF (${allAssignedVar4})`,
        pins: Hr,
        bitWidth: Ke,
        attributes: {
          rstSignal: M,
          rstValue: value4,
          activeLow: v,
        },
        span: d.span,
      };
      this.exprElaborator.nodes.push(Di);
      let Js;
      let Qa = this.exprElaborator.nodes.find((xr) => xr.id === yn.nodeId);
      if (Qa?.type === "CONSTANT") {
        Js = "d";
      } else {
        let xr =
          (Qa?.type === "PORT_IN" ? Qa.label : undefined) ??
          (Qa?.attributes?.netName ? String(Qa.attributes.netName) : undefined) ??
          (yn.signalName && yn.signalName !== allAssignedVar4 ? yn.signalName : undefined) ??
          (this.exprElaborator.sourceSignalNames.get(yn.nodeId) &&
          this.exprElaborator.sourceSignalNames.get(yn.nodeId) !== allAssignedVar4
            ? this.exprElaborator.sourceSignalNames.get(yn.nodeId)
            : undefined);
        if (xr) {
          Js = xr;
        } else {
          Js = `${allAssignedVar4}_d`;
        }
      }
      this.exprElaborator.connect(yn.nodeId, yn.pinId, nodeId, "d", Ke, Js);
      let expression2 = this.exprElaborator.elaborateExpression({
        kind: "Identifier",
        name: J,
        span: d.span,
      });
      if (
        (this.exprElaborator.connect(expression2.nodeId, expression2.pinId, nodeId, "clk", 1, J), M)
      ) {
        let expression3 = this.exprElaborator.elaborateExpression({
          kind: "Identifier",
          name: M,
          span: d.span,
        });
        this.exprElaborator.connect(expression3.nodeId, expression3.pinId, nodeId, "rst", 1, M);
      }
      let Sb = {
        nodeId: nodeId,
        pinId: "q",
        bitWidth: Ke,
      };
      this.exprElaborator.registerSignalSource(allAssignedVar4, Sb);
    }
  }
  testsSignal(d, m) {
    return d.kind === "Identifier"
      ? d.name === m
      : d.kind === "UnaryExpression"
        ? (d.operator === "!" || d.operator === "~") &&
          d.argument.kind === "Identifier" &&
          d.argument.name === m
        : false;
  }
  createMux(d, m, k, E) {
    let maxValue = Math.max(m.bitWidth, k.bitWidth);
    let nodeId = this.exprElaborator.createNodeId("mux");
    let v = {
      id: "in0",
      name: "0",
      direction: "in",
      bitWidth: k.bitWidth,
    };
    let R = {
      id: "in1",
      name: "1",
      direction: "in",
      bitWidth: m.bitWidth,
    };
    let J = {
      id: "sel",
      name: "SEL",
      direction: "select",
      bitWidth: 1,
    };
    let X = {
      id: "out",
      name: "Y",
      direction: "out",
      bitWidth: maxValue,
    };
    let Q = {
      id: nodeId,
      type: "MUX",
      label: "MUX",
      pins: [v, R, J, X],
      bitWidth: maxValue,
      span: E,
      attributes: {
        isExpandable: true,
        macroType: "mux",
      },
    };
    this.exprElaborator.nodes.push(Q);
    this.exprElaborator.connect(k.nodeId, k.pinId, nodeId, "in0", k.bitWidth);
    this.exprElaborator.connect(m.nodeId, m.pinId, nodeId, "in1", m.bitWidth);
    this.exprElaborator.connect(d.nodeId, d.pinId, nodeId, "sel", 1);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: maxValue,
    };
  }
  createLatch(d, m, k) {
    let bitWidth = m.bitWidth;
    let nodeId = this.exprElaborator.createNodeId("latch");
    let M = {
      id: "d",
      name: "D",
      direction: "in",
      bitWidth: bitWidth,
    };
    let v = {
      id: "en",
      name: "EN",
      direction: "in",
      bitWidth: 1,
    };
    let R = {
      id: "q",
      name: "Q",
      direction: "out",
      bitWidth: bitWidth,
    };
    let J = {
      id: nodeId,
      type: "LATCH",
      label: "LATCH",
      pins: [M, v, R],
      bitWidth: bitWidth,
      span: k,
    };
    this.exprElaborator.nodes.push(J);
    this.exprElaborator.connect(m.nodeId, m.pinId, nodeId, "d", bitWidth);
    this.exprElaborator.connect(d.nodeId, d.pinId, nodeId, "en", 1);
    return {
      nodeId: nodeId,
      pinId: "q",
      bitWidth: bitWidth,
    };
  }
  combineWithOr(d) {
    if (d.length === 0) {
      return this.exprElaborator.createConstantSource(0, 1);
    }
    if (d.length === 1) {
      return d[0];
    }
    let m = d[0];
    for (let k = 1; k < d.length; k++) {
      let E = d[k];
      let nodeId = this.exprElaborator.createNodeId("gate_or");
      let M = {
        id: "in0",
        name: "A",
        direction: "in",
        bitWidth: 1,
      };
      let v = {
        id: "in1",
        name: "B",
        direction: "in",
        bitWidth: 1,
      };
      let R = {
        id: "out",
        name: "Y",
        direction: "out",
        bitWidth: 1,
      };
      let J = {
        id: nodeId,
        type: "GATE_OR",
        label: "|",
        pins: [M, v, R],
        bitWidth: 1,
      };
      this.exprElaborator.nodes.push(J);
      this.exprElaborator.connect(m.nodeId, m.pinId, nodeId, "in0", 1);
      this.exprElaborator.connect(E.nodeId, E.pinId, nodeId, "in1", 1);
      m = {
        nodeId: nodeId,
        pinId: "out",
        bitWidth: 1,
      };
    }
    return m;
  }
  findAllAssignedVars(d) {
    let m = new Set();
    let k = (E) => {
      switch (E.kind) {
        case "BlockingAssign":
        case "NonBlockingAssign":
          if (E.lhs.kind === "Identifier") {
            m.add(E.lhs.name);
          } else if (E.lhs.kind === "BitSelect" || E.lhs.kind === "PartSelect") {
            let C = baseIdentifier(E.lhs);
            if (C) {
              m.add(C.name);
            }
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
        case "EmptyStatement":
          break;
      }
    };
    k(d);
    return m;
  }
  extractResetValues(d) {
    let m = new Map();
    let k = (E) => {
      if (E.kind === "BlockingAssign" || E.kind === "NonBlockingAssign") {
        let C = "";
        if (E.lhs.kind === "Identifier") {
          C = E.lhs.name;
        } else {
          if (E.lhs.kind === "BitSelect" || E.lhs.kind === "PartSelect") {
            C = baseIdentifier(E.lhs)?.name ?? "";
          }
        }
        if (C) {
          if (E.rhs.kind === "Identifier") {
            m.set(C, E.rhs.name);
          } else {
            if (E.rhs.kind === "NumberLiteral") {
              m.set(C, E.rhs.raw ?? String(E.rhs.value));
            }
          }
        }
      } else if (E.kind === "BlockStatement") {
        for (let statement of E.statements) {
          k(statement);
        }
      }
    };
    k(d);
    return m;
  }
}
