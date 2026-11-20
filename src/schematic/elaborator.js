import { ModuleResolver } from "../workspace/moduleResolver.js";
import { ExpressionElaborator } from "./expressionElaborator.js";
import { AlwaysElaborator } from "./alwaysElaborator.js";
import { baseIdentifier } from "../lint/rtlCheckers.js";

export class Elaborator {
  moduleResolver;
  constructor(d) {
    this.moduleResolver = d ?? new ModuleResolver();
  }
  elaborateModule(d, m) {
    let moduleScope = m.getModuleScope(d.name);
    let expressionElaborator = new ExpressionElaborator(moduleScope);
    expressionElaborator.registerDeclarations([...(d.svImportedFunctions ?? []), ...d.items]);
    let alwaysElaborator = new AlwaysElaborator(expressionElaborator);
    let M = new Set();
    let v = new Set();
    for (let item of d.items) {
      if (item.kind === "PortDeclaration") {
        for (let identifier of item.identifiers) {
          if (item.direction === "input" || item.direction === "inout") {
            M.add(identifier.name);
          }
          if (item.direction === "output" || item.direction === "inout") {
            v.add(identifier.name);
          }
        }
      }
    }
    this.createPortNodes(d, expressionElaborator, m);
    for (let item2 of d.items) {
      if (item2.kind === "ContinuousAssign") {
        expressionElaborator.elaborateAssign(item2);
      } else if (item2.kind === "NetDeclaration" && item2.assignments && item2.netType === "wire") {
        for (let assignment of item2.assignments) {
          expressionElaborator.elaborateAssign({
            kind: "ContinuousAssign",
            lhs: {
              kind: "Identifier",
              name: assignment.name,
              span: assignment.nameSpan,
            },
            rhs: assignment.expr,
            span: assignment.expr.span,
          });
        }
      } else {
        if (item2.kind === "AlwaysBlock") {
          alwaysElaborator.elaborateAlways(item2);
        } else {
          if (item2.kind === "InstanceDeclaration") {
            this.elaborateInstance(item2, expressionElaborator, m, d, M, v);
          }
        }
      }
    }
    expressionElaborator.finishContinuousSlices();
    expressionElaborator.resolvePlaceholders();
    this.connectOutputs(d, expressionElaborator, m);
    expressionElaborator.pruneDeadNodes();
    for (let [R, J] of Array.from(expressionElaborator.signalOutputs.entries())) {
      if (M.has(R) || v.has(R)) {
        continue;
      }
      if (
        !expressionElaborator.connections.some(
          (Q) => Q.sourceNodeId === J.nodeId && Q.sourcePinId === J.pinId,
        )
      ) {
        let nodeId = expressionElaborator.createNodeId(`term_${R}`);
        let Re = {
          id: "in",
          name: R,
          direction: "in",
          bitWidth: J.bitWidth,
        };
        let Qe = {
          id: nodeId,
          type: "SIGNAL_UNUSED",
          label: R,
          pins: [Re],
          bitWidth: J.bitWidth,
          attributes: {
            isUnused: true,
          },
        };
        expressionElaborator.nodes.push(Qe);
        expressionElaborator.connect(J.nodeId, J.pinId, nodeId, "in", J.bitWidth, R);
      }
    }
    return {
      moduleName: d.name,
      nodes: expressionElaborator.nodes,
      connections: expressionElaborator.connections,
      isSubcircuit: false,
    };
  }
  elaborateBlock(d, m, k) {
    let moduleScope = k.getModuleScope(m.name);
    let expressionElaborator = new ExpressionElaborator(moduleScope);
    expressionElaborator.registerDeclarations(m.items);
    let alwaysElaborator = new AlwaysElaborator(expressionElaborator);
    let v = new Set();
    let R = new Set();
    for (let item of m.items) {
      if (item.kind === "PortDeclaration") {
        for (let identifier of item.identifiers) {
          if (item.direction === "input" || item.direction === "inout") {
            v.add(identifier.name);
          }
          if (item.direction === "output" || item.direction === "inout") {
            R.add(identifier.name);
          }
        }
      }
    }
    if (d.kind === "ContinuousAssign") {
      expressionElaborator.elaborateAssign(d);
    } else {
      if (d.kind === "AlwaysBlock") {
        alwaysElaborator.elaborateAlways(d);
      } else {
        if (d.kind === "InstanceDeclaration") {
          this.elaborateInstance(d, expressionElaborator, k, m, v, R);
        }
      }
    }
    expressionElaborator.finishContinuousSlices();
    expressionElaborator.resolvePlaceholders();
    let J = new Set();
    if (d.kind === "ContinuousAssign") {
      for (let X of alwaysElaborator.lvalueNames(d.lhs)) {
        J.add(X);
      }
    } else if (d.kind === "AlwaysBlock") {
      for (let X of alwaysElaborator.findAllAssignedVars(d.statement)) {
        J.add(X);
      }
    } else if (d.kind === "InstanceDeclaration") {
      let moduleScope2 = k.getModuleScope(d.moduleName);
      for (let portConnection of d.portConnections) {
        if (portConnection.expression && portConnection.expression.kind === "Identifier") {
          let resolve = moduleScope2?.resolve(portConnection.portName);
          if (resolve && (resolve.direction === "output" || resolve.direction === "inout")) {
            J.add(portConnection.expression.name);
          }
        }
      }
    }
    for (let X of J) {
      let value = expressionElaborator.signalOutputs.get(X);
      if (value) {
        let nodeId = expressionElaborator.createNodeId(`port_out_${X}`);
        let Qe = {
          id: "in",
          name: X,
          direction: "in",
          bitWidth: value.bitWidth,
        };
        let le = R.has(X);
        let te = !le && this.isSignalUsedInModule(m, X, d);
        let Oe = le ? "PORT_OUT" : te ? "PORT_INTERMEDIATE" : "SIGNAL_UNUSED";
        let _e = {
          id: nodeId,
          type: Oe,
          label: X,
          pins: [Qe],
          bitWidth: value.bitWidth,
          attributes: {
            isIntermediate: Oe === "PORT_INTERMEDIATE",
            isUnused: Oe === "SIGNAL_UNUSED",
          },
        };
        expressionElaborator.nodes.push(_e);
        expressionElaborator.connect(value.nodeId, value.pinId, nodeId, "in", value.bitWidth, X);
      }
    }
    return {
      moduleName: `${m.name} (subcircuit)`,
      nodes: expressionElaborator.nodes,
      connections: expressionElaborator.connections,
      isSubcircuit: true,
    };
  }
  isSignalUsedInModule(d, m, k) {
    let E = (M, v) => {
      switch (M.kind) {
        case "Identifier":
          v.add(M.name);
          break;
        case "BinaryExpression":
          E(M.left, v);
          E(M.right, v);
          break;
        case "UnaryExpression":
          E(M.argument, v);
          break;
        case "TernaryExpression":
          E(M.condition, v);
          E(M.trueExpr, v);
          E(M.falseExpr, v);
          break;
        case "BitSelect":
          E(M.target, v);
          E(M.index, v);
          break;
        case "PartSelect":
          E(M.target, v);
          E(M.msb, v);
          E(M.lsb, v);
          break;
        case "Concatenation":
          for (let element of M.elements) {
            E(element, v);
          }
          break;
      }
    };
    let C = (M, v) => {
      switch (M.kind) {
        case "BlockingAssign":
        case "NonBlockingAssign":
          if (M.lhs.kind === "BitSelect") {
            E(M.lhs.index, v);
          } else {
            if (M.lhs.kind === "PartSelect") {
              E(M.lhs.msb, v);
              E(M.lhs.lsb, v);
            }
          }
          E(M.rhs, v);
          break;
        case "BlockStatement":
          for (let statement of M.statements) {
            C(statement, v);
          }
          break;
        case "IfStatement":
          E(M.condition, v);
          C(M.thenBranch, v);
          if (M.elseBranch) {
            C(M.elseBranch, v);
          }
          break;
        case "CaseStatement":
          E(M.expression, v);
          for (let item of M.items) {
            for (let pattern of item.patterns) {
              E(pattern, v);
            }
            C(item.statement, v);
          }
          break;
      }
    };
    for (let item2 of d.items) {
      if (item2 === k) {
        continue;
      }
      let v = new Set();
      if (item2.kind === "ContinuousAssign") {
        E(item2.rhs, v);
      } else if (item2.kind === "NetDeclaration" && item2.assignments) {
        for (let assignment of item2.assignments) {
          E(assignment.expr, v);
        }
      } else if (item2.kind === "AlwaysBlock") {
        for (let sensitivity of item2.sensitivities) {
          if (sensitivity.signal) {
            v.add(sensitivity.signal.name);
          }
        }
        C(item2.statement, v);
      } else if (item2.kind === "InstanceDeclaration") {
        for (let portConnection of item2.portConnections) {
          if (portConnection.expression) {
            E(portConnection.expression, v);
          }
        }
      }
      if (v.has(m)) {
        return true;
      }
    }
    return false;
  }
  createPortNodes(d, m, k) {
    let moduleScope = k.getModuleScope(d.name);
    if (moduleScope) {
      for (let item of d.items) {
        if (item.kind === "PortDeclaration") {
          for (let identifier of item.identifiers) {
            let R = moduleScope.resolve(identifier.name)?.bitWidth ?? 1;
            let dims = m.arrays.get(identifier.name);
            if (dims?.length === 1) {
              R *= dims[0].count;
            }
            if (item.direction === "input") {
              let nodeId = m.createNodeId(`port_in_${identifier.name}`);
              let X = {
                id: "out",
                name: identifier.name,
                direction: "out",
                bitWidth: R,
              };
              let Q = {
                id: nodeId,
                type: "PORT_IN",
                label: identifier.name,
                pins: [X],
                bitWidth: R,
                span: identifier.span,
              };
              m.nodes.push(Q);
              m.registerSignalSource(identifier.name, {
                nodeId: nodeId,
                pinId: "out",
                bitWidth: R,
                signalName: identifier.name,
              });
            }
          }
        }
      }
    }
  }
  connectOutputs(d, m, k) {
    let moduleScope = k.getModuleScope(d.name);
    if (moduleScope) {
      for (let item of d.items) {
        if (
          item.kind === "PortDeclaration" &&
          (item.direction === "output" || item.direction === "inout")
        ) {
          for (let identifier of item.identifiers) {
            let R = moduleScope.resolve(identifier.name)?.bitWidth ?? 1;
            let value = m.signalOutputs.get(identifier.name);
            let dims = m.arrays.get(identifier.name);
            if (dims?.length === 1 && !m.isMemory(identifier.name)) {
              let elements = [];
              for (let k = dims[0].count - 1; k >= 0; k--) {
                let element = `${identifier.name}[${dims[0].low + k}]`;
                elements.push(m.signalOutputs.get(element) ?? m.createConstantSource(0, R, `${R}'bx`));
              }
              value = m.concatSources(elements, identifier.span);
              R *= dims[0].count;
            }
            let nodeId = m.createNodeId(`port_out_${identifier.name}`);
            let Q = {
              id: "in",
              name: identifier.name,
              direction: "in",
              bitWidth: R,
            };
            let Re = {
              id: nodeId,
              type: item.direction === "inout" ? "PORT_INOUT" : "PORT_OUT",
              label: identifier.name,
              pins: [Q],
              bitWidth: R,
              span: identifier.span,
            };
            m.nodes.push(Re);
            if (value) {
              m.connect(value.nodeId, value.pinId, nodeId, "in", R, identifier.name);
            }
          }
        }
      }
    }
  }
  elaborateInstance(d, m, k, E, C = new Set(), M = new Set()) {
    if (d.instanceDims?.length === 1) {
      let copies = this.expandInstanceArray(d, m, k, E);
      if (copies) {
        for (let copy of copies) {
          this.elaborateInstance(copy, m, k, E, C, M);
        }
        return;
      }
    }
    let nodeId = m.createNodeId(`inst_${d.instanceName}`);
    let R = [];
    let moduleScope = k?.getModuleScope(d.moduleName);
    let X;
    if (!moduleScope) {
      let le = this.moduleResolver.resolveModule(d.moduleName, E?.span.fileUri);
      if (le.found && le.moduleNode) {
        X = le.moduleNode;
      }
    }
    let Q = new Map();
    let Re = [];
    if (moduleScope) {
      for (let le of moduleScope.getSymbols()) {
        if (le.kind === "port" && le.direction) {
          Q.set(le.name, le.direction);
          Re.push({
            name: le.name,
            direction: le.direction,
          });
        }
      }
    } else if (X) {
      for (let item of X.items) {
        if (item.kind === "PortDeclaration") {
          for (let identifier of item.identifiers) {
            Q.set(identifier.name, item.direction);
            Re.push({
              name: identifier.name,
              direction: item.direction,
            });
          }
        }
      }
    }
    for (let portConnection of d.portConnections) {
      let portName = portConnection.portName;
      let Oe = false;
      let _e = false;
      if (portConnection.portName.startsWith("__pos_")) {
        let int = parseInt(portConnection.portName.replace("__pos_", ""), 10);
        if (Re[int]) {
          portName = Re[int].name;
          Oe = Re[int].direction === "output";
          _e = true;
        }
      } else {
        if (Q.has(portName)) {
          Oe = Q.get(portName) === "output";
          _e = true;
        }
      }
      if (!portConnection.expression) {
        R.push({
          id: portName,
          name: portName,
          direction: Oe ? "out" : "in",
          bitWidth: 1,
        });
        continue;
      }
      if (!_e) {
        if (
          portConnection.expression.kind === "NumberLiteral" ||
          portConnection.expression.kind === "BinaryExpression" ||
          portConnection.expression.kind === "UnaryExpression" ||
          portConnection.expression.kind === "TernaryExpression" ||
          portConnection.expression.kind === "Concatenation"
        ) {
          Oe = false;
        } else {
          let Ke = "";
          if (portConnection.expression.kind === "Identifier") {
            Ke = portConnection.expression.name;
          } else {
            if (
              portConnection.expression.kind === "BitSelect" ||
              portConnection.expression.kind === "PartSelect"
            ) {
              Ke = baseIdentifier(portConnection.expression)?.name ?? "";
            }
          }
          if (Ke) {
            if (C.has(Ke) || m.signalOutputs.has(Ke)) {
              Oe = false;
            } else {
              if (M.has(Ke) || this.isSignalConsumedInModule(Ke, E, d)) {
                Oe = true;
              } else {
                Oe = false;
              }
            }
          } else {
            Oe = false;
          }
        }
      }
      if (Oe) {
        let Ke = m.lvalueWidth(portConnection.expression);
        let Se = {
          id: portName,
          name: portName,
          direction: "out",
          bitWidth: Ke,
        };
        R.push(Se);
        m.assignLvalue(portConnection.expression, { nodeId: nodeId, pinId: portName, bitWidth: Ke }, false);
      } else {
        let expression = m.elaborateExpression(portConnection.expression);
        let yn = {
          id: portName,
          name: portName,
          direction: "in",
          bitWidth: expression.bitWidth,
        };
        R.push(yn);
        m.connect(expression.nodeId, expression.pinId, nodeId, portName, expression.bitWidth);
      }
    }
    let Qe = {
      id: nodeId,
      type: "SUBMODULE",
      label: `${d.moduleName} (${d.instanceName})`,
      pins: R,
      bitWidth: 1,
      attributes: {
        moduleName: d.moduleName,
        instanceName: d.instanceName,
      },
      span: d.span,
    };
    m.nodes.push(Qe);
  }
  // `leaf u [3:0] (.a(bus))`: one instance per index; a connection as wide as all copies together is sliced,
  // the rightmost index taking the least significant bits.
  expandInstanceArray(d, m, k, E) {
    let msb = m.constValue(d.instanceDims[0].msb);
    let lsb = m.constValue(d.instanceDims[0].lsb);
    let count = msb === undefined || lsb === undefined ? undefined : Math.abs(msb - lsb) + 1;
    if (!count || count > 256) {
      return undefined;
    }
    let portWidths = new Map();
    let ports = [];
    let moduleScope = k?.getModuleScope(d.moduleName);
    for (let symbol of moduleScope?.getSymbols() ?? []) {
      if (symbol.kind === "port" && symbol.direction) {
        portWidths.set(symbol.name, symbol.bitWidth ?? 1);
        ports.push(symbol.name);
      }
    }
    let step = msb >= lsb ? -1 : 1;
    let copies = [];
    for (let index = msb; ; index += step) {
      let position = Math.abs(index - lsb);
      let portConnections = d.portConnections.map((connection, order) => {
        let portName = connection.portName.startsWith("__pos_") ? ports[order] : connection.portName;
        let expr = connection.expression;
        let width = portWidths.get(portName);
        if (!expr || !width || expr.kind !== "Identifier" || m.arrays.has(expr.name)) {
          return connection;
        }
        let total = m.signalWidth(expr.name);
        if (total !== width * count) {
          return connection;
        }
        let high = m.indexAtOffset(expr.name, position * width + width - 1);
        let low = m.indexAtOffset(expr.name, position * width);
        let literal = (value) => ({ kind: "NumberLiteral", raw: String(value), value, span: expr.span });
        return { ...connection, expression: { kind: "PartSelect", target: expr, msb: literal(high), lsb: literal(low), span: expr.span } };
      });
      copies.push({ ...d, instanceDims: undefined, instanceName: `${d.instanceName}[${index}]`, portConnections });
      if (index === lsb) {
        break;
      }
    }
    return copies;
  }
  isSignalConsumedInModule(d, m, k) {
    if (!m) {
      return false;
    }
    for (let item of m.items) {
      if (item !== k) {
        if (
          (item.kind === "PortDeclaration" &&
            item.direction === "output" &&
            item.identifiers.some((C) => C.name === d)) ||
          (item.kind === "ContinuousAssign" && this.expressionContainsIdentifier(item.rhs, d))
        ) {
          return true;
        }
        if (item.kind === "NetDeclaration" && item.assignments) {
          for (let assignment of item.assignments) {
            if (this.expressionContainsIdentifier(assignment.expr, d)) {
              return true;
            }
          }
        }
        if (item.kind === "AlwaysBlock" && this.statementContainsIdentifier(item.statement, d)) {
          return true;
        }
        if (item.kind === "InstanceDeclaration") {
          for (let portConnection of item.portConnections) {
            if (
              portConnection.expression &&
              this.expressionContainsIdentifier(portConnection.expression, d)
            ) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }
  expressionContainsIdentifier(d, m) {
    return d.kind === "Identifier"
      ? d.name === m
      : d.kind === "BitSelect" || d.kind === "PartSelect"
        ? this.expressionContainsIdentifier(d.target, m)
        : d.kind === "BinaryExpression"
          ? this.expressionContainsIdentifier(d.left, m) ||
            this.expressionContainsIdentifier(d.right, m)
          : d.kind === "UnaryExpression"
            ? this.expressionContainsIdentifier(d.argument, m)
            : d.kind === "TernaryExpression"
              ? this.expressionContainsIdentifier(d.condition, m) ||
                this.expressionContainsIdentifier(d.trueExpr, m) ||
                this.expressionContainsIdentifier(d.falseExpr, m)
              : d.kind === "Concatenation"
                ? d.elements.some((k) => this.expressionContainsIdentifier(k, m))
                : false;
  }
  statementContainsIdentifier(d, m) {
    return d.kind === "BlockStatement"
      ? d.statements.some((k) => this.statementContainsIdentifier(k, m))
      : d.kind === "BlockingAssign" || d.kind === "NonBlockingAssign"
        ? this.expressionContainsIdentifier(d.rhs, m)
        : d.kind === "IfStatement"
          ? this.expressionContainsIdentifier(d.condition, m) ||
            this.statementContainsIdentifier(d.thenBranch, m) ||
            (d.elseBranch ? this.statementContainsIdentifier(d.elseBranch, m) : false)
          : d.kind === "CaseStatement"
            ? this.expressionContainsIdentifier(d.expression, m) ||
              d.items.some(
                (k) =>
                  k.patterns.some((E) => this.expressionContainsIdentifier(E, m)) ||
                  this.statementContainsIdentifier(k.statement, m),
              )
            : false;
  }
}
