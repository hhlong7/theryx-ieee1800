import { baseIdentifier } from "../lint/rtlCheckers.js";

export class ExpressionElaborator {
  nodes = [];
  connections = [];
  signalOutputs = new Map();
  sourceSignalNames = new Map();
  placeholderNodes = new Map();
  nodeIdCounter = 0;
  connectionIdCounter = 0;
  scope;
  constructor(scope) {
    this.scope = scope;
  }
  registerSignalSource(d, m) {
    m.signalName = d;
    this.signalOutputs.set(d, m);
    this.sourceSignalNames.set(`${m.nodeId}:${m.pinId}`, d);
    this.sourceSignalNames.set(m.nodeId, d);
  }
  elaborateAssign(d) {
    let expression = this.elaborateExpression(d.rhs);
    if (d.lhs.kind === "Concatenation") {
      this.driveConcatLhs(d.lhs, expression);
      return;
    }
    let k = "";
    if (
      (d.lhs.kind === "Identifier"
        ? (k = d.lhs.name)
        : (d.lhs.kind === "BitSelect" || d.lhs.kind === "PartSelect") &&
          (k = baseIdentifier(d.lhs)?.name ?? ""),
      k)
    ) {
      this.registerSignalSource(k, expression);
      let E = this.nodes.find((C) => C.id === expression.nodeId);
      if (E) {
        if (!E.attributes) {
          E.attributes = {};
        }
        if (!E.attributes.netName) {
          E.attributes.netName = k;
        }
      }
    }
  }
  driveConcatLhs(d, m) {
    let k = d.elements.map((C) => this.lvalueWidth(C));
    let E = 0;
    for (let C = k.length - 1; C >= 0; C--) {
      let M = k[C];
      let v = d.elements[C];
      let lvalueName = this.lvalueName(v);
      if (!lvalueName) {
        E += M;
        continue;
      }
      let sliceSource = this.sliceSource(m, E, M, v.span);
      this.registerSignalSource(lvalueName, sliceSource);
      let X = this.nodes.find((Q) => Q.id === sliceSource.nodeId);
      if (X) {
        if (!X.attributes) {
          X.attributes = {};
        }
        if (!X.attributes.netName) {
          X.attributes.netName = lvalueName;
        }
      }
      E += M;
    }
  }
  lvalueWidth(d) {
    switch (d.kind) {
      case "Identifier":
        return this.scope?.resolve(d.name)?.bitWidth ?? 1;
      case "BitSelect":
        return 1;
      case "PartSelect": {
        let m = d.msb.kind === "NumberLiteral" ? d.msb.value : undefined;
        let k = d.lsb.kind === "NumberLiteral" ? d.lsb.value : undefined;
        return m === undefined || k === undefined ? 1 : Math.abs(m - k) + 1;
      }
      default:
        return 1;
    }
  }
  lvalueName(d) {
    if (d.kind === "Identifier") {
      return d.name;
    }
    if (d.kind === "BitSelect" || d.kind === "PartSelect") {
      return baseIdentifier(d)?.name;
    }
  }
  sliceSource(d, m, k, E) {
    if (m === 0 && k === d.bitWidth) {
      return d;
    }
    let C = m + k - 1;
    let nodeId = this.createNodeId("split");
    let v = {
      id: "in",
      name: "IN",
      direction: "in",
      bitWidth: d.bitWidth,
    };
    let R = {
      id: "out",
      name: "OUT",
      direction: "out",
      bitWidth: k,
    };
    let J = {
      id: nodeId,
      type: "SPLIT",
      label: `[${C}:${m}]`,
      pins: [v, R],
      bitWidth: k,
      span: E,
      attributes: {
        msb: C,
        lsb: m,
      },
    };
    this.nodes.push(J);
    this.connect(d.nodeId, d.pinId, nodeId, "in", d.bitWidth);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: k,
    };
  }
  elaborateExpression(d) {
    switch (d.kind) {
      case "Identifier":
        return this.elaborateIdentifier(d);
      case "NumberLiteral":
        return this.elaborateNumberLiteral(d);
      case "BinaryExpression":
        return this.elaborateBinary(d);
      case "UnaryExpression":
        return this.elaborateUnary(d);
      case "TernaryExpression":
        return this.elaborateTernary(d);
      case "BitSelect": {
        let expression = this.elaborateExpression(d.target);
        let nodeId = this.createNodeId("split");
        let E = 0;
        if (d.index.kind === "NumberLiteral") {
          E = d.index.value;
        }
        let C = {
          id: "in",
          name: "IN",
          direction: "in",
          bitWidth: expression.bitWidth,
        };
        let M = {
          id: "out",
          name: "OUT",
          direction: "out",
          bitWidth: 1,
        };
        let v = {
          id: nodeId,
          type: "SPLIT",
          label: `[${E}]`,
          pins: [C, M],
          bitWidth: 1,
          span: d.span,
          attributes: {
            index: E,
          },
        };
        this.nodes.push(v);
        this.connect(expression.nodeId, expression.pinId, nodeId, "in", expression.bitWidth);
        return {
          nodeId: nodeId,
          pinId: "out",
          bitWidth: 1,
        };
      }
      case "PartSelect": {
        let expression2 = this.elaborateExpression(d.target);
        let k = 0;
        let E = 0;
        if (d.msb.kind === "NumberLiteral") {
          k = d.msb.value;
        }
        if (d.lsb.kind === "NumberLiteral") {
          E = d.lsb.value;
        }
        let C = Math.abs(k - E) + 1;
        let nodeId2 = this.createNodeId("split");
        let v = {
          id: "in",
          name: "IN",
          direction: "in",
          bitWidth: expression2.bitWidth,
        };
        let R = {
          id: "out",
          name: "OUT",
          direction: "out",
          bitWidth: C,
        };
        let J = {
          id: nodeId2,
          type: "SPLIT",
          label: `[${k}:${E}]`,
          pins: [v, R],
          bitWidth: C,
          span: d.span,
          attributes: {
            msb: k,
            lsb: E,
          },
        };
        this.nodes.push(J);
        this.connect(expression2.nodeId, expression2.pinId, nodeId2, "in", expression2.bitWidth);
        return {
          nodeId: nodeId2,
          pinId: "out",
          bitWidth: C,
        };
      }
      case "Concatenation": {
        if (d.elements.length === 0) {
          return this.createConstantSource(0, 1);
        }
        let m = d.elements.map((R) => this.elaborateExpression(R));
        let reduce = m.reduce((R, J) => R + J.bitWidth, 0);
        let nodeId3 = this.createNodeId("concat");
        let C = m.map((R, J) => ({
          id: `in${J}`,
          name: `in${J}`,
          direction: "in",
          bitWidth: R.bitWidth,
        }));
        let M = {
          id: "out",
          name: "Y",
          direction: "out",
          bitWidth: reduce,
        };
        let v = {
          id: nodeId3,
          type: "CONCAT",
          label: "{ }",
          pins: [...C, M],
          bitWidth: reduce,
          span: d.span,
        };
        this.nodes.push(v);
        m.forEach((R, J) => {
          this.connect(R.nodeId, R.pinId, nodeId3, `in${J}`, R.bitWidth);
        });
        return {
          nodeId: nodeId3,
          pinId: "out",
          bitWidth: reduce,
        };
      }
      case "ReplicationExpression":
        return this.elaborateReplication(d);
      case "StringLiteral":
        return this.createUnsupportedSource(
          "string",
          `String literal "${d.value}" has no hardware meaning`,
        );
      case "SystemFunctionCall":
        return this.createUnsupportedSource(
          d.name,
          `System function '${d.name}' has no hardware meaning`,
        );
      case "FunctionCall":
        return this.createUnsupportedSource(
          d.name,
          `Function call '${d.name}' cannot be elaborated into a circuit`,
        );
      case "OpaqueExpression":
        return this.createUnsupportedSource(
          d.text ?? "expression",
          `'${d.text ?? "expression"}' is a SystemVerilog construct that is not drawn in the schematic`,
        );
    }
  }
  createUnsupportedSource(d, m) {
    let nodeId = this.createNodeId("unsupported");
    let E = {
      id: "out",
      name: "out",
      direction: "out",
      bitWidth: 1,
    };
    let C = {
      id: nodeId,
      type: "UNSUPPORTED",
      label: d,
      pins: [E],
      bitWidth: 1,
      attributes: {
        unsupported: true,
        reason: m,
      },
    };
    this.nodes.push(C);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: 1,
    };
  }
  resolvePlaceholders() {
    let d = true;
    for (; d;) {
      d = false;
      for (let [m, k] of Array.from(this.placeholderNodes.entries())) {
        let value = this.signalOutputs.get(k);
        if (value && value.nodeId !== m) {
          for (let connection of this.connections) {
            if (connection.sourceNodeId === m) {
              connection.sourceNodeId = value.nodeId;
              connection.sourcePinId = value.pinId;
              if (!connection.netName) {
                connection.netName = k;
              }
            }
            if (connection.targetNodeId === m) {
              connection.targetNodeId = value.nodeId;
              connection.targetPinId = value.pinId;
            }
          }
          for (let [M, v] of Array.from(this.signalOutputs.entries())) {
            if (v.nodeId === m) {
              this.signalOutputs.set(M, {
                nodeId: value.nodeId,
                pinId: value.pinId,
                bitWidth: v.bitWidth,
                signalName: v.signalName ?? k,
              });
            }
          }
          let index = this.nodes.findIndex((M) => M.id === m);
          if (index !== -1) {
            this.nodes.splice(index, 1);
          }
          this.placeholderNodes.delete(m);
          d = true;
        }
      }
    }
  }
  elaborateIdentifier(d) {
    let value = this.signalOutputs.get(d.name);
    if (value) {
      return value;
    }
    let resolve = this.scope?.resolve(d.name);
    let E = resolve?.bitWidth ?? 1;
    if (resolve && resolve.kind === "parameter") {
      let constantSource = this.createConstantSource(
        this.resolveParameterValue(resolve),
        E,
        d.name,
      );
      this.registerSignalSource(d.name, constantSource);
      return constantSource;
    }
    let nodeId = this.createNodeId(`port_${d.name}`);
    let M = {
      id: "out",
      name: d.name,
      direction: "out",
      bitWidth: E,
    };
    let v = {
      id: nodeId,
      type: "PORT_IN",
      label: d.name,
      pins: [M],
      bitWidth: E,
      span: d.span,
    };
    this.nodes.push(v);
    let R = {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: E,
      signalName: d.name,
    };
    this.registerSignalSource(d.name, R);
    if (resolve?.direction !== "input") {
      this.placeholderNodes.set(nodeId, d.name);
    }
    return R;
  }
  resolveParameterValue(d) {
    if (typeof d.value == "number" && Number.isFinite(d.value)) {
      return d.value;
    }
    if (typeof d.value == "string") {
      let int = parseInt(d.value.replace(/_/g, ""), 10);
      if (!Number.isNaN(int)) {
        return int;
      }
    }
    return 0;
  }
  elaborateNumberLiteral(d) {
    let m = d.bitWidth ?? 1;
    return this.createConstantSource(d.value, m, d.raw);
  }
  createConstantSource(d, m, k) {
    let nodeId = this.createNodeId("const");
    let C = {
      id: "out",
      name: "out",
      direction: "out",
      bitWidth: m,
    };
    let M = {
      id: nodeId,
      type: "CONSTANT",
      label: k ?? String(d),
      pins: [C],
      bitWidth: m,
      attributes: {
        value: d,
      },
    };
    this.nodes.push(M);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: m,
    };
  }
  elaborateBinary(d) {
    let expression = this.elaborateExpression(d.left);
    let expression2 = this.elaborateExpression(d.right);
    if (
      (d.operator === "&&" || d.operator === "||") &&
      (expression.bitWidth > 1 || expression2.bitWidth > 1)
    ) {
      return this.createUnsupportedSource(
        d.operator,
        `Logical '${d.operator}' on multi-bit operands needs reduction logic`,
      );
    }
    let includes = ["==", "!=", "===", "!==", "<", ">", "<=", ">=", "&&", "||"].includes(
      d.operator,
    );
    let includes2 = ["<<", ">>", "<<<", ">>>"].includes(d.operator);
    let M = includes
      ? 1
      : includes2
        ? expression.bitWidth
        : Math.max(expression.bitWidth, expression2.bitWidth);
    let mapBinaryOperatorToNodeType = this.mapBinaryOperatorToNodeType(d.operator);
    let nodeId = this.createNodeId(mapBinaryOperatorToNodeType.toLowerCase());
    let J = {
      id: "in0",
      name: "A",
      direction: "in",
      bitWidth: expression.bitWidth,
    };
    let X = {
      id: "in1",
      name: "B",
      direction: "in",
      bitWidth: expression2.bitWidth,
    };
    let Q = {
      id: "out",
      name: "Y",
      direction: "out",
      bitWidth: M,
    };
    let Re = includes2 && d.right.kind === "NumberLiteral" ? d.right.value : undefined;
    let Qe = macroTypeForNode(mapBinaryOperatorToNodeType);
    let le = {
      id: nodeId,
      type: mapBinaryOperatorToNodeType,
      label: d.operator,
      pins: [J, X, Q],
      bitWidth: M,
      span: d.span,
      attributes:
        mapBinaryOperatorToNodeType === "UNSUPPORTED"
          ? {
              unsupported: true,
              operator: d.operator,
              reason: `Operator '${d.operator}' is not supported by the elaborator`,
            }
          : includes2
            ? {
                isExpandable: typeof Re == "number",
                macroType: "shift",
                operator: d.operator,
                ...(typeof Re == "number"
                  ? {
                      shiftAmount: Re,
                    }
                  : {}),
              }
            : Qe
              ? {
                  isExpandable: true,
                  macroType: Qe,
                  operator: d.operator,
                }
              : undefined,
    };
    this.nodes.push(le);
    this.connect(expression.nodeId, expression.pinId, nodeId, "in0", expression.bitWidth);
    this.connect(expression2.nodeId, expression2.pinId, nodeId, "in1", expression2.bitWidth);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: M,
    };
  }
  elaborateUnary(d) {
    let expression = this.elaborateExpression(d.argument);
    let bitWidth = expression.bitWidth;
    let includes = ["&", "~&", "|", "~|", "^", "~^", "^~"].includes(d.operator);
    let C;
    let M;
    if (includes) {
      switch (((M = 1), d.operator)) {
        case "&":
          C = "REDUCTION_AND";
          break;
        case "~&":
          C = "REDUCTION_NAND";
          break;
        case "|":
          C = "REDUCTION_OR";
          break;
        case "~|":
          C = "REDUCTION_NOR";
          break;
        case "^":
          C = "REDUCTION_XOR";
          break;
        case "~^":
        case "^~":
          C = "REDUCTION_XNOR";
          break;
        default:
          C = "UNSUPPORTED";
      }
    } else if (d.operator === "!") {
      if (bitWidth > 1) {
        return this.createUnsupportedSource(
          "!",
          "Logical '!' on a multi-bit operand needs reduction logic",
        );
      }
      M = 1;
      C = "GATE_NOT";
    } else {
      if (d.operator === "~") {
        M = bitWidth;
        C = "GATE_NOT";
      } else {
        M = bitWidth;
        C = "UNSUPPORTED";
      }
    }
    let nodeId = this.createNodeId(C.toLowerCase());
    let R = {
      id: "in",
      name: "A",
      direction: "in",
      bitWidth: bitWidth,
    };
    let J = {
      id: "out",
      name: "Y",
      direction: "out",
      bitWidth: M,
    };
    let X = {
      id: nodeId,
      type: C,
      label: d.operator,
      pins: [R, J],
      bitWidth: M,
      span: d.span,
      attributes:
        C === "UNSUPPORTED"
          ? {
              unsupported: true,
              operator: d.operator,
              reason: `Operator '${d.operator}' is not supported by the elaborator`,
            }
          : includes
            ? {
                isExpandable: true,
                macroType: "reduction",
                operator: d.operator,
                inputWidth: bitWidth,
              }
            : undefined,
    };
    this.nodes.push(X);
    this.connect(expression.nodeId, expression.pinId, nodeId, "in", bitWidth);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: M,
    };
  }
  elaborateReplication(d) {
    let m = 1;
    if (d.multiplier.kind === "NumberLiteral") {
      m = Math.max(1, d.multiplier.value);
    } else if (d.multiplier.kind === "Identifier" && this.scope) {
      let resolve = this.scope.resolve(d.multiplier.name);
      if (resolve && typeof resolve.value == "number") {
        m = Math.max(1, resolve.value);
      } else if (resolve && typeof resolve.value == "string") {
        let int = parseInt(resolve.value, 10);
        if (!isNaN(int)) {
          m = Math.max(1, int);
        }
      }
    }
    let k = [];
    for (let X = 0; X < m; X++) {
      k.push(...d.elements);
    }
    if (k.length === 0) {
      return this.createConstantSource(0, 1);
    }
    let E = k.map((X) => this.elaborateExpression(X));
    let reduce = E.reduce((X, Q) => X + Q.bitWidth, 0);
    let nodeId = this.createNodeId("replication");
    let v = E.map((X, Q) => ({
      id: `in${Q}`,
      name: `in${Q}`,
      direction: "in",
      bitWidth: X.bitWidth,
    }));
    let R = {
      id: "out",
      name: "Y",
      direction: "out",
      bitWidth: reduce,
    };
    let J = {
      id: nodeId,
      type: "REPLICATION",
      label: `{${m}{ }}`,
      pins: [...v, R],
      bitWidth: reduce,
      span: d.span,
      attributes: {
        isExpandable: true,
        macroType: "replication",
        multiplier: m,
      },
    };
    this.nodes.push(J);
    E.forEach((X, Q) => {
      this.connect(X.nodeId, X.pinId, nodeId, `in${Q}`, X.bitWidth);
    });
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: reduce,
    };
  }
  elaborateTernary(d) {
    let expression = this.elaborateExpression(d.condition);
    let expression2 = this.elaborateExpression(d.trueExpr);
    let expression3 = this.elaborateExpression(d.falseExpr);
    let maxValue = Math.max(expression2.bitWidth, expression3.bitWidth);
    let nodeId = this.createNodeId("mux");
    let v = {
      id: "in0",
      name: "0",
      direction: "in",
      bitWidth: expression3.bitWidth,
    };
    let R = {
      id: "in1",
      name: "1",
      direction: "in",
      bitWidth: expression2.bitWidth,
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
      span: d.span,
      attributes: {
        isExpandable: true,
        macroType: "mux",
      },
    };
    this.nodes.push(Q);
    this.connect(expression3.nodeId, expression3.pinId, nodeId, "in0", expression3.bitWidth);
    this.connect(expression2.nodeId, expression2.pinId, nodeId, "in1", expression2.bitWidth);
    this.connect(expression.nodeId, expression.pinId, nodeId, "sel", 1);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: maxValue,
    };
  }
  connect(d, m, k, E, C, M) {
    let v = M ?? this.sourceSignalNames.get(`${d}:${m}`) ?? this.sourceSignalNames.get(d);
    this.connections.push({
      id: `conn_${++this.connectionIdCounter}`,
      sourceNodeId: d,
      sourcePinId: m,
      targetNodeId: k,
      targetPinId: E,
      bitWidth: C,
      netName: v,
    });
  }
  createNodeId(d) {
    return `${d}_${++this.nodeIdCounter}`;
  }
  mapBinaryOperatorToNodeType(d) {
    switch (d) {
      case "&":
      case "&&":
        return "GATE_AND";
      case "|":
      case "||":
        return "GATE_OR";
      case "^":
        return "GATE_XOR";
      case "~&":
        return "GATE_NAND";
      case "~|":
        return "GATE_NOR";
      case "^~":
      case "~^":
        return "GATE_XNOR";
      case "+":
        return "ADD";
      case "-":
        return "SUB";
      case "*":
        return "MUL";
      case "==":
        return "COMPARE_EQ";
      case "!=":
        return "COMPARE_NE";
      case "<":
        return "COMPARE_LT";
      case ">":
        return "COMPARE_GT";
      case "<=":
        return "COMPARE_LE";
      case ">=":
        return "COMPARE_GE";
      case "<<":
        return "SHIFT_LEFT";
      case ">>":
        return "SHIFT_RIGHT";
      case "<<<":
        return "SHIFT_LEFT_ARITH";
      case ">>>":
        return "SHIFT_RIGHT_ARITH";
      default:
        return "UNSUPPORTED";
    }
  }
}

function macroTypeForNode(O) {
  switch (O) {
    case "ADD":
      return "add";
    case "SUB":
      return "sub";
    case "MUL":
      return "mul";
    case "COMPARE_EQ":
    case "COMPARE_NE":
    case "COMPARE_LT":
    case "COMPARE_GT":
    case "COMPARE_LE":
    case "COMPARE_GE":
      return "compare";
    default:
      return;
  }
}
