class ReferenceCollector {
  constructor(name, moduleName) {
    this.name = name;
    this.moduleName = moduleName;
  }
  name;
  moduleName;
  results = [];
  collect(d) {
    for (let moduleItem of d.modules) {
      if (!(this.moduleName !== undefined && moduleItem.name !== this.moduleName)) {
        this.visitModule(moduleItem);
      }
    }
    return this.results;
  }
  add(d, m = false) {
    if (d) {
      this.results.push({
        span: d,
        isDeclaration: m,
      });
    }
  }
  addIdentifier(d, m, k = false) {
    if (d === this.name) {
      this.add(m, k);
    }
  }
  nameSpanAtStart(d, m) {
    return {
      fileUri: m.fileUri,
      start: m.start,
      end: {
        line: m.start.line,
        column: m.start.column + d.length,
      },
    };
  }
  visitModule(d) {
    this.addIdentifier(d.name, d.nameSpan, true);
    for (let item of d.items) {
      this.visitModuleItem(item);
    }
  }
  visitModuleItem(d) {
    switch (d.kind) {
      case "PortDeclaration":
        for (let identifier of d.identifiers) {
          this.addIdentifier(identifier.name, identifier.span, true);
        }
        this.visitRange(d.range);
        break;
      case "NetDeclaration":
        for (let identifier2 of d.identifiers) {
          this.addIdentifier(identifier2.name, identifier2.span, true);
        }
        this.visitRange(d.range);
        for (let m of d.dimensions ?? []) {
          this.visitRange(m);
        }
        for (let m of d.assignments ?? []) {
          this.visitExpression(m.expr);
        }
        break;
      case "ParameterDeclaration":
        for (let parameter of d.parameters) {
          this.addIdentifier(parameter.name, parameter.span, true);
          this.visitExpression(parameter.valueExpr);
        }
        this.visitRange(d.range);
        break;
      case "ContinuousAssign":
        this.visitExpression(d.lhs);
        this.visitExpression(d.rhs);
        break;
      case "AlwaysBlock":
        this.visitSensitivities(d.sensitivities);
        this.visitExpression(d.delayExpr);
        this.visitStatement(d.statement);
        break;
      case "InstanceDeclaration":
        this.addIdentifier(d.moduleName, d.moduleNameSpan);
        this.addIdentifier(d.instanceName, d.instanceNameSpan, true);
        for (let portConnection of d.portConnections) {
          this.visitExpression(portConnection.expression);
        }
        break;
      case "GenerateBlock":
        for (let item of d.items) {
          this.visitModuleItem(item);
        }
        for (let statement of d.statements) {
          this.visitStatement(statement);
        }
        break;
      case "GenvarDeclaration":
        for (let identifier3 of d.identifiers) {
          this.addIdentifier(identifier3.name, identifier3.span, true);
        }
        break;
      case "FunctionDeclaration":
        this.addIdentifier(d.name, d.nameSpan, true);
        this.visitRange(d.range);
        for (let port of d.ports) {
          this.visitModuleItem(port);
        }
        for (let statement2 of d.statements) {
          this.visitStatement(statement2);
        }
        break;
      case "TaskDeclaration":
        this.addIdentifier(d.name, d.nameSpan, true);
        for (let port2 of d.ports) {
          this.visitModuleItem(port2);
        }
        for (let statement3 of d.statements) {
          this.visitStatement(statement3);
        }
        break;
      case "InitialBlock":
        this.visitStatement(d.statement);
        break;
      case "VariableDeclaration":
        for (let identifier4 of d.identifiers) {
          this.addIdentifier(identifier4.name, identifier4.span, true);
        }
        this.visitRange(d.range);
        this.visitExpression(d.initExpr);
        break;
      case "GateInstantiation":
        for (let instance of d.instances) {
          this.addIdentifier(instance.name, instance.nameSpan, true);
          this.visitRange(instance.range);
          for (let terminal of instance.terminals) {
            this.visitExpression(terminal);
          }
        }
        break;
    }
  }
  visitStatement(d) {
    switch (d.kind) {
      case "BlockStatement":
        for (let statement of d.statements) {
          this.visitStatement(statement);
        }
        break;
      case "BlockingAssign":
      case "NonBlockingAssign":
        this.visitExpression(d.lhs);
        this.visitExpression(d.rhs);
        break;
      case "IfStatement":
        this.visitExpression(d.condition);
        this.visitStatement(d.thenBranch);
        if (d.elseBranch) {
          this.visitStatement(d.elseBranch);
        }
        break;
      case "CaseStatement":
        this.visitExpression(d.expression);
        for (let item of d.items) {
          this.visitCaseItem(item);
        }
        break;
      case "EmptyStatement":
        break;
      case "LoopStatement":
        this.visitExpression(d.initExpr);
        this.visitExpression(d.condition);
        this.visitExpression(d.stepExpr);
        this.visitExpression(d.countExpr);
        this.visitStatement(d.body);
        break;
      case "EventControlStatement":
        this.visitSensitivities(d.sensitivities);
        break;
      case "DelayStatement":
        this.visitExpression(d.delayExpr);
        break;
      case "SystemTaskCall":
        for (let arg of d.args) {
          this.visitExpression(arg);
        }
        break;
      case "TaskCallStatement":
        this.addIdentifier(d.name, this.nameSpanAtStart(d.name, d.span));
        for (let arg2 of d.args) {
          this.visitExpression(arg2);
        }
        break;
      case "GenerateLoopStatement":
        this.visitExpression(d.initExpr);
        this.visitExpression(d.condition);
        this.visitExpression(d.stepExpr);
        this.visitExpression(d.countExpr);
        this.visitStatement(d.body);
        break;
      case "GenerateBlockStatement":
        for (let item2 of d.items) {
          this.visitModuleItem(item2);
        }
        for (let statement2 of d.statements) {
          this.visitStatement(statement2);
        }
        break;
    }
  }
  visitCaseItem(d) {
    for (let pattern of d.patterns) {
      this.visitExpression(pattern);
    }
    this.visitStatement(d.statement);
  }
  visitSensitivities(d) {
    for (let m of d) {
      if (m.signal) {
        this.addIdentifier(m.signal.name, m.signal.span);
      }
    }
  }
  visitRange(d) {
    if (d) {
      this.visitExpression(d.msb);
      this.visitExpression(d.lsb);
    }
  }
  visitExpression(d) {
    if (d) {
      switch (d.kind) {
        case "Identifier":
          this.addIdentifier(d.name, d.span);
          break;
        case "BinaryExpression":
          this.visitExpression(d.left);
          this.visitExpression(d.right);
          break;
        case "UnaryExpression":
          this.visitExpression(d.argument);
          break;
        case "TernaryExpression":
          this.visitExpression(d.condition);
          this.visitExpression(d.trueExpr);
          this.visitExpression(d.falseExpr);
          break;
        case "BitSelect":
          this.visitExpression(d.target);
          this.visitExpression(d.index);
          break;
        case "PartSelect":
          this.visitExpression(d.target);
          this.visitExpression(d.msb);
          this.visitExpression(d.lsb);
          break;
        case "Concatenation":
          for (let element of d.elements) {
            this.visitExpression(element);
          }
          break;
        case "ReplicationExpression":
          this.visitExpression(d.multiplier);
          for (let element2 of d.elements) {
            this.visitExpression(element2);
          }
          break;
        case "NumberLiteral":
          break;
        case "StringLiteral":
          break;
        case "SystemFunctionCall":
          for (let arg of d.args) {
            this.visitExpression(arg);
          }
          break;
        case "FunctionCall":
          this.addIdentifier(d.name, this.nameSpanAtStart(d.name, d.span));
          for (let arg2 of d.args) {
            this.visitExpression(arg2);
          }
          break;
      }
    }
  }
}

export function collectReferences(O, d, m) {
  return d ? new ReferenceCollector(d, m).collect(O) : [];
}

export function identifierTokenAt(O, d, m) {
  return O.find(
    (k) =>
      k.type === "Identifier" &&
      k.span.start.line === d &&
      m >= k.span.start.column &&
      m < k.span.end.column,
  );
}

export function moduleNameAtLine(O, d) {
  return O.modules.find((m) => m.span.start.line <= d && m.span.end.line >= d)?.name;
}
