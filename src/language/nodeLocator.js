export function spanContains(O, d, m) {
  return !(
    O < m.start.line ||
    O > m.end.line ||
    (O === m.start.line && d < m.start.column) ||
    (O === m.end.line && d > m.end.column)
  );
}

export class NodeLocator {
  findNodeAtPosition(d, m, k) {
    for (let moduleItem of d.modules) {
      if (spanContains(m, k, moduleItem.span)) {
        return this.findInModule(moduleItem, m, k);
      }
    }
  }
  findInModule(d, m, k) {
    if (d.nameSpan && spanContains(m, k, d.nameSpan)) {
      return {
        kind: "module_name",
        moduleNode: d,
        span: d.nameSpan,
      };
    }
    for (let item of d.items) {
      if (spanContains(m, k, item.span)) {
        switch (item.kind) {
          case "PortDeclaration": {
            let inPortDeclaration = this.findInPortDeclaration(item, d, m, k);
            if (inPortDeclaration) {
              return inPortDeclaration;
            }
            break;
          }
          case "NetDeclaration": {
            let inNetDeclaration = this.findInNetDeclaration(item, d, m, k);
            if (inNetDeclaration) {
              return inNetDeclaration;
            }
            break;
          }
          case "ParameterDeclaration": {
            let inParameterDeclaration = this.findInParameterDeclaration(item, d, m, k);
            if (inParameterDeclaration) {
              return inParameterDeclaration;
            }
            break;
          }
          case "ContinuousAssign": {
            let inContinuousAssign = this.findInContinuousAssign(item, d, m, k);
            if (inContinuousAssign) {
              return inContinuousAssign;
            }
            break;
          }
          case "AlwaysBlock": {
            let inAlwaysBlock = this.findInAlwaysBlock(item, d, m, k);
            if (inAlwaysBlock) {
              return inAlwaysBlock;
            }
            break;
          }
          case "InstanceDeclaration": {
            let inInstanceDeclaration = this.findInInstanceDeclaration(item, d, m, k);
            if (inInstanceDeclaration) {
              return inInstanceDeclaration;
            }
            break;
          }
        }
      }
    }
  }
  findInPortDeclaration(d, m, k, E) {
    for (let identifier of d.identifiers) {
      if (spanContains(k, E, identifier.span)) {
        return {
          kind: "identifier",
          node: identifier,
          currentModule: m,
          span: identifier.span,
        };
      }
    }
  }
  findInNetDeclaration(d, m, k, E) {
    for (let identifier of d.identifiers) {
      if (spanContains(k, E, identifier.span)) {
        return {
          kind: "identifier",
          node: identifier,
          currentModule: m,
          span: identifier.span,
        };
      }
    }
  }
  findInParameterDeclaration(d, m, k, E) {
    for (let parameter of d.parameters) {
      if (spanContains(k, E, parameter.span)) {
        if (parameter.valueExpr && spanContains(k, E, parameter.valueExpr.span)) {
          let inExpression = this.findInExpression(parameter.valueExpr, m, k, E);
          if (inExpression) {
            return inExpression;
          }
        }
        return {
          kind: "identifier",
          node: {
            kind: "Identifier",
            name: parameter.name,
            span: parameter.span,
          },
          currentModule: m,
          span: parameter.span,
        };
      }
    }
  }
  findInContinuousAssign(d, m, k, E) {
    if (spanContains(k, E, d.lhs.span)) {
      return this.findInExpression(d.lhs, m, k, E);
    }
    if (spanContains(k, E, d.rhs.span)) {
      return this.findInExpression(d.rhs, m, k, E);
    }
  }
  findInAlwaysBlock(d, m, k, E) {
    for (let sensitivity of d.sensitivities) {
      if (sensitivity.signal && spanContains(k, E, sensitivity.signal.span)) {
        return {
          kind: "identifier",
          node: sensitivity.signal,
          currentModule: m,
          span: sensitivity.signal.span,
        };
      }
    }
    return this.findInStatement(d.statement, m, k, E);
  }
  findInInstanceDeclaration(d, m, k, E) {
    if (d.moduleNameSpan && spanContains(k, E, d.moduleNameSpan)) {
      return {
        kind: "instance_module",
        moduleName: d.moduleName,
        instanceNode: d,
        currentModule: m,
        span: d.moduleNameSpan,
      };
    }
    if (d.instanceNameSpan && spanContains(k, E, d.instanceNameSpan)) {
      return {
        kind: "instance_name",
        instanceName: d.instanceName,
        instanceNode: d,
        currentModule: m,
        span: d.instanceNameSpan,
      };
    }
    for (let portConnection of d.portConnections) {
      if (portConnection.portNameSpan && spanContains(k, E, portConnection.portNameSpan)) {
        return {
          kind: "named_port",
          portName: portConnection.portName,
          instanceNode: d,
          currentModule: m,
          span: portConnection.portNameSpan,
        };
      }
      if (portConnection.expression && spanContains(k, E, portConnection.expression.span)) {
        let inExpression = this.findInExpression(portConnection.expression, m, k, E);
        if (inExpression) {
          return inExpression;
        }
      }
    }
  }
  findInStatement(d, m, k, E) {
    if (spanContains(k, E, d.span)) {
      switch (d.kind) {
        case "BlockStatement": {
          for (let localDecl of d.localDecls ?? []) {
            let inLocalDecl = this.findInNetDeclaration(localDecl, m, k, E);
            if (inLocalDecl) {
              return inLocalDecl;
            }
          }
          for (let statement of d.statements) {
            let inStatement = this.findInStatement(statement, m, k, E);
            if (inStatement) {
              return inStatement;
            }
          }
          break;
        }
        case "BlockingAssign":
        case "NonBlockingAssign": {
          if (spanContains(k, E, d.lhs.span)) {
            return this.findInExpression(d.lhs, m, k, E);
          }
          if (spanContains(k, E, d.rhs.span)) {
            return this.findInExpression(d.rhs, m, k, E);
          }
          break;
        }
        case "IfStatement": {
          if (spanContains(k, E, d.condition.span)) {
            return this.findInExpression(d.condition, m, k, E);
          }
          let inStatement2 = this.findInStatement(d.thenBranch, m, k, E);
          if (inStatement2) {
            return inStatement2;
          }
          if (d.elseBranch) {
            let inStatement3 = this.findInStatement(d.elseBranch, m, k, E);
            if (inStatement3) {
              return inStatement3;
            }
          }
          break;
        }
        case "CaseStatement": {
          if (spanContains(k, E, d.expression.span)) {
            return this.findInExpression(d.expression, m, k, E);
          }
          for (let item of d.items) {
            for (let pattern of item.patterns) {
              if (spanContains(k, E, pattern.span)) {
                return this.findInExpression(pattern, m, k, E);
              }
            }
            let inStatement4 = this.findInStatement(item.statement, m, k, E);
            if (inStatement4) {
              return inStatement4;
            }
          }
          break;
        }
      }
    }
  }
  findInExpression(d, m, k, E) {
    if (spanContains(k, E, d.span)) {
      switch (d.kind) {
        case "Identifier":
          return {
            kind: "identifier",
            node: d,
            currentModule: m,
            span: d.span,
          };
        case "BinaryExpression": {
          let inExpression = this.findInExpression(d.left, m, k, E);
          return inExpression || this.findInExpression(d.right, m, k, E);
        }
        case "UnaryExpression":
          return this.findInExpression(d.argument, m, k, E);
        case "TernaryExpression": {
          let inExpression2 = this.findInExpression(d.condition, m, k, E);
          if (inExpression2) {
            return inExpression2;
          }
          let inExpression3 = this.findInExpression(d.trueExpr, m, k, E);
          return inExpression3 || this.findInExpression(d.falseExpr, m, k, E);
        }
        case "BitSelect": {
          let inExpression4 = this.findInExpression(d.target, m, k, E);
          return inExpression4 || this.findInExpression(d.index, m, k, E);
        }
        case "PartSelect": {
          let inExpression5 = this.findInExpression(d.target, m, k, E);
          if (inExpression5) {
            return inExpression5;
          }
          let inExpression6 = this.findInExpression(d.msb, m, k, E);
          return inExpression6 || this.findInExpression(d.lsb, m, k, E);
        }
        case "Concatenation": {
          for (let element of d.elements) {
            let inExpression7 = this.findInExpression(element, m, k, E);
            if (inExpression7) {
              return inExpression7;
            }
          }
          break;
        }
        case "NumberLiteral":
          return;
      }
    }
  }
}
