import { SymbolTable } from "./symbolTable.js";
import { ModuleResolver } from "../workspace/moduleResolver.js";
import { scalarSymbol, vectorSymbol } from "../lint/rtlCheckers.js";

export class SemanticAnalyzer {
  symbolTable = new SymbolTable();
  diagnostics = [];
  currentModuleName = "";
  currentFileUri = "";
  moduleResolver;
  constructor(d) {
    this.moduleResolver = d ?? new ModuleResolver();
  }
  analyze(d) {
    this.symbolTable = new SymbolTable();
    this.diagnostics = [];
    this.currentModuleName = "";
    this.currentFileUri = d.span.fileUri ?? "";
    this.isSystemVerilog = d.isSystemVerilog === true;
    for (let moduleItem of d.modules) {
      let k = scalarSymbol(moduleItem.name, "module", moduleItem.span);
      if (!this.symbolTable.globalScope.define(k)) {
        this.addDiagnostic(
          `Duplicate module '${moduleItem.name}'`,
          moduleItem.span,
          "error",
          "SEM-DUPLICATE-MODULE",
        );
      }
    }
    this.symbolTable.attachSource(d);
    for (let moduleItem2 of d.modules) {
      this.analyzeModule(moduleItem2);
    }
    return {
      symbolTable: this.symbolTable,
      diagnostics: this.diagnostics,
    };
  }
  analyzeModule(d) {
    this.currentModuleName = d.name;
    let enterScope = this.symbolTable.enterScope(d.name);
    this.openScope = d.svOpenScope === true;
    for (let imported of d.svImportedSymbols ?? []) {
      this.defineImportedSymbol(imported, enterScope);
    }
    for (let item of d.items) {
      if (item.kind === "ParameterDeclaration") {
        let E = item.range ? this.evaluateRange(item.range, enterScope) : undefined;
        for (let parameter of item.parameters) {
          let M = 1;
          let v = 0;
          let R = 0;
          if (E && E.isVector) {
            M = Math.abs(E.msb - E.lsb) + 1;
            v = E.msb;
            R = E.lsb;
          } else if (parameter.valueExpr) {
            let inferExpressionWidth = this.inferExpressionWidth(parameter.valueExpr, enterScope);
            if (inferExpressionWidth !== undefined && inferExpressionWidth > 0) {
              M = inferExpressionWidth;
              v = inferExpressionWidth - 1;
              R = 0;
            }
          }
          let J =
            M > 1
              ? vectorSymbol(parameter.name, "parameter", v, R, parameter.span)
              : scalarSymbol(parameter.name, "parameter", parameter.span);
          if (((J.bitWidth = M), (J.msb = v), (J.lsb = R), parameter.valueExpr)) {
            let constantExpr = this.evaluateConstantExpr(parameter.valueExpr, enterScope);
            if (constantExpr !== undefined) {
              J.value = constantExpr;
            } else {
              if (parameter.valueExpr.kind === "NumberLiteral") {
                J.value = parameter.valueExpr.raw ?? parameter.valueExpr.value;
              } else {
                if (parameter.valueExpr.kind === "Identifier") {
                  J.value = parameter.valueExpr.name;
                }
              }
            }
          }
          if (!enterScope.define(J)) {
            this.addDiagnostic(
              `Duplicate parameter identifier '${parameter.name}'`,
              parameter.span,
              "error",
              "SEM-DUPLICATE-PARAMETER",
            );
          }
        }
      }
    }
    for (let item2 of d.items) {
      if (item2.kind === "PortDeclaration") {
        this.declarePort(item2, enterScope);
      } else if (item2.kind === "NetDeclaration") {
        this.declareNet(item2, enterScope);
      } else if (item2.kind === "VariableDeclaration") {
        this.declareVariable(item2, enterScope);
      } else if (item2.kind === "GenvarDeclaration") {
        for (let identifier of item2.identifiers) {
          if (!enterScope.define(scalarSymbol(identifier.name, "reg", identifier.span))) {
            this.addDiagnostic(
              `Duplicate genvar identifier '${identifier.name}'`,
              identifier.span,
              "error",
              "SEM-DUPLICATE-GENVAR",
            );
          }
        }
      } else if (item2.kind === "TaskDeclaration") {
        if (!enterScope.define(scalarSymbol(item2.name, "task", item2.span ?? item2.nameSpan))) {
          this.addDiagnostic(
            `Duplicate task identifier '${item2.name}'`,
            item2.span,
            "error",
            "SEM-DUPLICATE-TASK",
          );
        }
      } else if (item2.kind === "FunctionDeclaration") {
        if (
          !enterScope.define(scalarSymbol(item2.name, "function", item2.span ?? item2.nameSpan))
        ) {
          this.addDiagnostic(
            `Duplicate function identifier '${item2.name}'`,
            item2.span,
            "error",
            "SEM-DUPLICATE-FUNCTION",
          );
        }
      } else if (item2.kind === "GenerateBlock") {
        for (let item3 of item2.items) {
          if (item3.kind === "NetDeclaration") {
            this.declareNet(item3, enterScope);
          } else if (item3.kind === "VariableDeclaration") {
            this.declareVariable(item3, enterScope);
          } else if (item3.kind === "GenvarDeclaration") {
            for (let identifier2 of item3.identifiers) {
              enterScope.define(scalarSymbol(identifier2.name, "reg", identifier2.span));
            }
          }
        }
      } else if (item2.kind === "InstanceDeclaration") {
        let E = scalarSymbol(item2.instanceName, "instance", item2.span);
        if (!enterScope.define(E)) {
          this.addDiagnostic(
            `Duplicate instance identifier '${item2.instanceName}'`,
            item2.span,
            "error",
            "SEM-DUPLICATE-INSTANCE",
          );
        }
        let resolve = this.symbolTable.globalScope.resolve(item2.moduleName);
        if (!resolve) {
          let M = this.moduleResolver.resolveModule(item2.moduleName, this.currentFileUri);
          if (M.found && M.moduleNode) {
            resolve = scalarSymbol(M.moduleNode.name, "module", M.moduleNode.span);
            this.symbolTable.globalScope.define(resolve);
            let currentScope = this.symbolTable.currentScope;
            this.symbolTable.currentScope = this.symbolTable.globalScope;
            this.symbolTable.enterScope(M.moduleNode.name);
            for (let item4 of M.moduleNode.items) {
              if (item4.kind === "PortDeclaration") {
                this.declarePort(item4);
              }
            }
            this.symbolTable.exitScope();
            this.symbolTable.currentScope = currentScope;
          } else {
            let v = M.searchDir ? `in the same folder ('${M.searchDir}')` : "in the same folder";
            this.addDiagnostic(
              `Module '${item2.moduleName}' not found. Resolution rule: ensure that file '${item2.moduleName}${/\.svh?$/i.test(this.currentFileUri) ? ".sv" : ".v"}' is ${v} as the current file (convention: one module per file).`,
              item2.span,
              "error",
              "SEM-MODULE-NOT-FOUND",
            );
          }
        }
      }
    }
    for (let item5 of d.items) {
      if (item5.kind === "ContinuousAssign") {
        this.checkContinuousAssign(item5);
      } else if (item5.kind === "NetDeclaration" && item5.assignments) {
        for (let assignment of item5.assignments) {
          this.checkExpressionIdentifiers(assignment.expr);
        }
      } else if (item5.kind === "AlwaysBlock") {
        this.checkAlwaysBlock(item5);
      } else if (item5.kind === "InitialBlock") {
        this.checkStatement(item5.statement);
      } else if (item5.kind === "TaskDeclaration") {
        this.checkSubroutineBody(item5.name, item5.ports, item5.statements);
      } else if (item5.kind === "FunctionDeclaration") {
        this.checkSubroutineBody(item5.name, item5.ports, item5.statements);
      } else if (item5.kind === "GenerateBlock") {
        for (let item6 of item5.items) {
          if (item6.kind === "ContinuousAssign") {
            this.checkContinuousAssign(item6);
          } else {
            if (item6.kind === "AlwaysBlock") {
              this.checkAlwaysBlock(item6);
            } else {
              if (item6.kind === "InitialBlock") {
                this.checkStatement(item6.statement);
              }
            }
          }
        }
      } else if (item5.kind === "GateInstantiation") {
        for (let instance of item5.instances) {
          for (let terminal of instance.terminals) {
            this.checkExpressionIdentifiers(terminal);
          }
        }
      }
    }
    this.symbolTable.exitScope();
  }
  // Enum members and package parameters a module uses, named by the SystemVerilog lowering.
  defineImportedSymbol(d, m) {
    let k = (d.width ?? 1) > 1;
    let E = k
      ? vectorSymbol(d.name, "parameter", d.width - 1, 0, d.span)
      : scalarSymbol(d.name, "parameter", d.span);
    if (d.value !== undefined) {
      E.value = d.value;
    }
    m.define(E);
  }
  // SystemVerilog block-scoped variables shadow outer names instead of clashing with them.
  checkScopedStatement(d, m) {
    let moduleScope = this.symbolTable.getModuleScope(this.currentModuleName);
    let enterScope = this.symbolTable.enterScope(`${this.currentModuleName}$block`);
    for (let E of d) {
      let { msb: C, lsb: M, isVector: v } = this.evaluateRange(E.range, enterScope);
      for (let identifier of E.identifiers) {
        let R = v
          ? vectorSymbol(identifier.name, "reg", C, M, identifier.span, undefined, E.netType)
          : scalarSymbol(identifier.name, "reg", identifier.span, undefined, E.netType);
        enterScope.define(R);
        // Editor features look names up from the module scope; block scopes are gone by then.
        if (moduleScope) {
          moduleScope.svLocals ??= new Map();
          moduleScope.svLocals.set(identifier.name, R);
        }
      }
    }
    m();
    this.symbolTable.exitScope();
  }
  declarePort(d, m) {
    let k = m ?? this.symbolTable.currentScope;
    let { msb: E, lsb: C, isVector: M } = this.evaluateRange(d.range, k);
    for (let identifier of d.identifiers) {
      let resolve = d.svLocal ? k.symbols.get(identifier.name) : k.resolve(identifier.name);
      if (resolve && resolve.kind === "port") {
        this.addDiagnostic(
          `Duplicate port identifier '${identifier.name}' in module '${this.currentModuleName}'`,
          identifier.span,
          "error",
          "SEM-DUPLICATE-PORT",
        );
        continue;
      }
      let J = M
        ? vectorSymbol(identifier.name, "port", E, C, identifier.span, d.direction, d.netType)
        : scalarSymbol(identifier.name, "port", identifier.span, d.direction, d.netType);
      // Subroutine arguments are local copies, so even an input may be written.
      J.svLocal = d.svLocal;
      k.define(J);
    }
  }
  checkSubroutineBody(d, m, k) {
    let enterScope = this.symbolTable.enterScope(d);
    for (let C of m) {
      this.declarePort(C, enterScope);
    }
    for (let C of k) {
      this.checkStatement(C);
    }
    this.symbolTable.exitScope();
  }
  declareVariable(d, m) {
    let k = m ?? this.symbolTable.currentScope;
    let { msb: E, lsb: C, isVector: M } = this.evaluateRange(d.range, k);
    for (let identifier of d.identifiers) {
      if (k.resolve(identifier.name)) {
        this.addDiagnostic(
          `Duplicate identifier '${identifier.name}' in module '${this.currentModuleName}'`,
          identifier.span,
          "error",
          "SEM-DUPLICATE-IDENTIFIER",
        );
        continue;
      }
      let R;
      if (M) {
        R = vectorSymbol(identifier.name, "reg", E, C, identifier.span);
      } else {
        let J = d.dataType === "integer" ? 32 : 64;
        R = vectorSymbol(identifier.name, "reg", J - 1, 0, identifier.span);
      }
      if (d.initExpr) {
        let constantExpr = this.evaluateConstantExpr(d.initExpr, k);
        if (constantExpr !== undefined) {
          R.value = constantExpr;
        }
      }
      k.define(R);
    }
  }
  declareNet(d, m) {
    let k = m ?? this.symbolTable.currentScope;
    let { msb: E, lsb: C, isVector: M } = this.evaluateRange(d.range, k);
    let v = d.netType === "reg" || d.svVariable ? "reg" : "wire";
    for (let identifier of d.identifiers) {
      let resolve = k.resolve(identifier.name);
      // Module names live in their own name space: `module test; logic test;` is fine.
      if (this.isSystemVerilog && resolve?.kind === "module") {
        resolve = undefined;
      }
      if (resolve) {
        if (resolve.kind === "port") {
          resolve.netType = d.netType;
          if (M && resolve.bitWidth === 1) {
            resolve.msb = E;
            resolve.lsb = C;
            resolve.bitWidth = Math.abs(E - C) + 1;
          }
          continue;
        }
        this.addDiagnostic(
          `Duplicate net identifier '${identifier.name}' in module '${this.currentModuleName}'`,
          identifier.span,
          "error",
          "SEM-DUPLICATE-NET",
        );
        continue;
      }
      let X = M
        ? vectorSymbol(identifier.name, v, E, C, identifier.span, undefined, d.netType)
        : scalarSymbol(identifier.name, v, identifier.span, undefined, d.netType);
      k.define(X);
    }
  }
  checkContinuousAssign(d) {
    let primaryIdentifier = this.getPrimaryIdentifier(d.lhs);
    if (primaryIdentifier) {
      let resolve = this.symbolTable.currentScope.resolve(primaryIdentifier.name);
      if (resolve) {
        if (resolve.direction === "input" && !resolve.svLocal) {
          this.addDiagnostic(
            `Cannot assign to input port '${primaryIdentifier.name}'`,
            primaryIdentifier.span,
            "error",
            "SEM-ASSIGN-TO-INPUT",
          );
        }
      } else {
        this.addDiagnostic(
          `Undeclared identifier '${primaryIdentifier.name}' in continuous assignment`,
          primaryIdentifier.span,
          "error",
          "SEM-UNDECLARED-LHS",
        );
      }
    }
    this.checkExpressionIdentifiers(d.rhs);
  }
  checkAlwaysBlock(d) {
    for (let sensitivity of d.sensitivities) {
      if (sensitivity.signal) {
        if (!this.symbolTable.currentScope.resolve(sensitivity.signal.name)) {
          this.addDiagnostic(
            `Undeclared sensitivity signal '${sensitivity.signal.name}'`,
            sensitivity.signal.span,
            "error",
            "SEM-UNDECLARED-SENSITIVITY",
          );
        }
      }
    }
    this.checkStatement(d.statement);
  }
  checkStatement(d) {
    switch (d.kind) {
      case "BlockStatement":
        if (d.localDecls) {
          this.checkScopedStatement(d.localDecls, () => {
            for (let statement of d.statements) {
              this.checkStatement(statement);
            }
          });
          break;
        }
        for (let statement of d.statements) {
          this.checkStatement(statement);
        }
        break;
      case "BlockingAssign":
      case "NonBlockingAssign": {
        let primaryIdentifier = this.getPrimaryIdentifier(d.lhs);
        if (primaryIdentifier) {
          let resolve = this.symbolTable.currentScope.resolve(primaryIdentifier.name);
          if (resolve) {
            if (resolve.direction === "input" && !resolve.svLocal) {
              this.addDiagnostic(
                `Cannot assign to input port '${primaryIdentifier.name}'`,
                primaryIdentifier.span,
                "error",
                "SEM-ASSIGN-TO-INPUT",
              );
            } else {
              if (resolve.kind === "wire" && resolve.netType !== "reg") {
                this.addDiagnostic(
                  `Procedural assignment to wire '${primaryIdentifier.name}' is illegal (must be reg)`,
                  primaryIdentifier.span,
                  "error",
                  "SEM-ASSIGN-TO-WIRE",
                );
              }
            }
          } else {
            this.addDiagnostic(
              `Undeclared identifier '${primaryIdentifier.name}' in procedural assignment`,
              primaryIdentifier.span,
              "error",
              "SEM-UNDECLARED-LHS",
            );
          }
        }
        this.checkExpressionIdentifiers(d.rhs);
        break;
      }
      case "IfStatement":
        this.checkExpressionIdentifiers(d.condition);
        this.checkStatement(d.thenBranch);
        if (d.elseBranch) {
          this.checkStatement(d.elseBranch);
        }
        break;
      case "CaseStatement":
        this.checkExpressionIdentifiers(d.expression);
        for (let item of d.items) {
          for (let pattern of item.patterns) {
            this.checkExpressionIdentifiers(pattern);
          }
          this.checkStatement(item.statement);
        }
        break;
      case "EmptyStatement":
        break;
      case "LoopStatement":
        if (d.localDecls) {
          this.checkScopedStatement(d.localDecls, () => this.checkStatement({ ...d, localDecls: undefined }));
          break;
        }
        if (d.initExpr) {
          this.checkExpressionIdentifiers(d.initExpr);
        }
        if (d.condition) {
          this.checkExpressionIdentifiers(d.condition);
        }
        if (d.stepExpr) {
          this.checkExpressionIdentifiers(d.stepExpr);
        }
        if (d.countExpr) {
          this.checkExpressionIdentifiers(d.countExpr);
        }
        this.checkStatement(d.body);
        break;
      case "EventControlStatement":
        break;
      case "DelayStatement":
        if (d.delayExpr) {
          this.checkExpressionIdentifiers(d.delayExpr);
        }
        break;
      case "SystemTaskCall":
        for (let arg of d.args) {
          this.checkExpressionIdentifiers(arg);
        }
        break;
      case "TaskCallStatement":
        for (let arg2 of d.args) {
          this.checkExpressionIdentifiers(arg2);
        }
        break;
    }
  }
  checkExpressionIdentifiers(d) {
    switch (d.kind) {
      case "Identifier": {
        if (!this.symbolTable.currentScope.resolve(d.name)) {
          this.addDiagnostic(
            `Undeclared identifier '${d.name}'`,
            d.span,
            "error",
            "SEM-UNDECLARED",
          );
        }
        break;
      }
      case "BinaryExpression":
        this.checkExpressionIdentifiers(d.left);
        this.checkExpressionIdentifiers(d.right);
        break;
      case "UnaryExpression":
        this.checkExpressionIdentifiers(d.argument);
        break;
      case "TernaryExpression":
        this.checkExpressionIdentifiers(d.condition);
        this.checkExpressionIdentifiers(d.trueExpr);
        this.checkExpressionIdentifiers(d.falseExpr);
        break;
      case "BitSelect":
        this.checkExpressionIdentifiers(d.target);
        this.checkExpressionIdentifiers(d.index);
        break;
      case "PartSelect":
        this.checkExpressionIdentifiers(d.target);
        this.checkExpressionIdentifiers(d.msb);
        this.checkExpressionIdentifiers(d.lsb);
        break;
      case "Concatenation":
        for (let element of d.elements) {
          this.checkExpressionIdentifiers(element);
        }
        break;
      case "ReplicationExpression":
        this.checkExpressionIdentifiers(d.multiplier);
        for (let element2 of d.elements) {
          this.checkExpressionIdentifiers(element2);
        }
        break;
      case "NumberLiteral":
        break;
      case "StringLiteral":
        break;
      case "SystemFunctionCall":
        for (let arg of d.args) {
          this.checkExpressionIdentifiers(arg);
        }
        break;
      case "FunctionCall":
        for (let arg2 of d.args) {
          this.checkExpressionIdentifiers(arg2);
        }
        break;
    }
  }
  getPrimaryIdentifier(d) {
    return d.kind === "Identifier"
      ? {
          name: d.name,
          span: d.span,
        }
      : d.kind === "BitSelect" || d.kind === "PartSelect"
        ? this.getPrimaryIdentifier(d.target)
        : null;
  }
  evaluateConstantExpr(d, m) {
    switch (d.kind) {
      case "NumberLiteral":
        return d.value;
      case "Identifier": {
        let resolve = m.resolve(d.name);
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
        return;
      }
      case "BinaryExpression": {
        let constantExpr = this.evaluateConstantExpr(d.left, m);
        let constantExpr2 = this.evaluateConstantExpr(d.right, m);
        if (constantExpr === undefined || constantExpr2 === undefined) {
          return;
        }
        switch (d.operator) {
          case "+":
            return constantExpr + constantExpr2;
          case "-":
            return constantExpr - constantExpr2;
          case "*":
            return constantExpr * constantExpr2;
          case "/":
            return constantExpr2 !== 0 ? Math.floor(constantExpr / constantExpr2) : 0;
          case "%":
            return constantExpr2 !== 0 ? constantExpr % constantExpr2 : 0;
          case "<<":
            return constantExpr << constantExpr2;
          case ">>":
            return constantExpr >> constantExpr2;
          default:
            return;
        }
      }
      case "UnaryExpression": {
        let constantExpr3 = this.evaluateConstantExpr(d.argument, m);
        if (constantExpr3 === undefined) {
          return;
        }
        switch (d.operator) {
          case "+":
            return constantExpr3;
          case "-":
            return -constantExpr3;
          case "~":
            return ~constantExpr3;
          default:
            return;
        }
      }
      default:
        return;
    }
  }
  evaluateRange(d, m) {
    if (!d) {
      return {
        msb: 0,
        lsb: 0,
        isVector: false,
      };
    }
    let k = m ?? this.symbolTable.currentScope;
    let E =
      this.evaluateConstantExpr(d.msb, k) ?? (d.msb.kind === "NumberLiteral" ? d.msb.value : 0);
    let C =
      this.evaluateConstantExpr(d.lsb, k) ?? (d.lsb.kind === "NumberLiteral" ? d.lsb.value : 0);
    return {
      msb: E,
      lsb: C,
      isVector: true,
    };
  }
  inferExpressionWidth(d, m) {
    switch (d.kind) {
      case "NumberLiteral": {
        if (d.bitWidth !== undefined) {
          return d.bitWidth;
        }
        let index = d.raw.indexOf("'");
        if (index > 0) {
          let int = parseInt(d.raw.slice(0, index).replace(/_/g, ""), 10);
          if (!isNaN(int)) {
            return int;
          }
        }
        return 32;
      }
      case "Identifier":
        return m.resolve(d.name)?.bitWidth;
      case "BitSelect":
        return 1;
      case "PartSelect": {
        let constantExpr = this.evaluateConstantExpr(d.msb, m);
        let constantExpr2 = this.evaluateConstantExpr(d.lsb, m);
        return constantExpr !== undefined && constantExpr2 !== undefined
          ? Math.abs(constantExpr - constantExpr2) + 1
          : undefined;
      }
      case "Concatenation": {
        let k = 0;
        for (let element of d.elements) {
          let inferExpressionWidth = this.inferExpressionWidth(element, m);
          if (inferExpressionWidth === undefined) {
            return;
          }
          k += inferExpressionWidth;
        }
        return k;
      }
      case "ReplicationExpression": {
        let k = 1;
        let constantExpr3 = this.evaluateConstantExpr(d.multiplier, m);
        if (constantExpr3 !== undefined && constantExpr3 > 0) {
          k = constantExpr3;
        }
        let C = 0;
        for (let element2 of d.elements) {
          let inferExpressionWidth2 = this.inferExpressionWidth(element2, m);
          if (inferExpressionWidth2 === undefined) {
            return;
          }
          C += inferExpressionWidth2;
        }
        return C * k;
      }
      case "BinaryExpression": {
        if (["==", "!=", "===", "!==", "<", ">", "<=", ">=", "&&", "||"].includes(d.operator)) {
          return 1;
        }
        if (["<<", ">>", "<<<", ">>>"].includes(d.operator)) {
          return this.inferExpressionWidth(d.left, m);
        }
        let inferExpressionWidth3 = this.inferExpressionWidth(d.left, m);
        let inferExpressionWidth4 = this.inferExpressionWidth(d.right, m);
        return inferExpressionWidth3 !== undefined && inferExpressionWidth4 !== undefined
          ? Math.max(inferExpressionWidth3, inferExpressionWidth4)
          : (inferExpressionWidth3 ?? inferExpressionWidth4);
      }
      case "UnaryExpression":
        return ["&", "~&", "|", "~|", "^", "~^", "^~", "!"].includes(d.operator)
          ? 1
          : this.inferExpressionWidth(d.argument, m);
      case "TernaryExpression": {
        let inferExpressionWidth5 = this.inferExpressionWidth(d.trueExpr, m);
        let inferExpressionWidth6 = this.inferExpressionWidth(d.falseExpr, m);
        return inferExpressionWidth5 !== undefined && inferExpressionWidth6 !== undefined
          ? Math.max(inferExpressionWidth5, inferExpressionWidth6)
          : (inferExpressionWidth5 ?? inferExpressionWidth6);
      }
      default:
        return;
    }
  }
  addDiagnostic(d, m, k = "error", E) {
    if (this.openScope && E?.startsWith("SEM-UNDECLARED")) {
      return;
    }
    this.diagnostics.push({
      message: d,
      severity: k,
      span: m,
      code: E,
    });
  }
}
