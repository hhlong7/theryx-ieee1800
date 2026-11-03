// Rewrites a parsed SystemVerilog file into the node kinds shared with the Verilog path,
// so the analyzer, linter and schematic need no knowledge of typedefs, packages or interfaces.
import {
  SvScope,
  evalConst,
  resolveType,
  typeOf,
  indexLayout,
  castLayout,
  registerEnumValues,
  describeType,
  findPackage,
} from "./svTypes.js";

const NET_KEYWORDS = new Set([
  "wire", "tri", "tri0", "tri1", "wand", "wor", "triand", "trior", "trireg", "supply0", "supply1",
  "uwire", "interconnect",
]);

const NUMERIC_BOUND_LIMIT = 1 << 20;

function numberLiteral(value, span) {
  return { kind: "NumberLiteral", raw: String(value), value, span };
}

function sizedLiteral(digit, width, span) {
  let bits = width !== undefined && width > 0 && width <= 4096 ? width : 1;
  let value = digit === "1" ? (bits <= 52 ? Math.pow(2, bits) - 1 : Number.MAX_SAFE_INTEGER) : 0;
  return {
    kind: "NumberLiteral",
    raw: `${bits}'b${digit.repeat(bits)}`,
    value: digit === "x" || digit === "z" ? 0 : value,
    bitWidth: bits,
    span,
  };
}

function numericRange(layout, span) {
  let dim = layout?.packed?.length === 1 ? layout.packed[0] : undefined;
  if (dim?.count !== undefined && layout.elementWidth === 1) {
    if (dim.count === 1 && dim.msb === 0 && dim.lsb === 0) {
      return { kind: "Range", msb: numberLiteral(0, span), lsb: numberLiteral(0, span), span };
    }
    return { kind: "Range", msb: numberLiteral(dim.msb, span), lsb: numberLiteral(dim.lsb, span), span };
  }
  if (layout?.width !== undefined && layout.width > 1) {
    return { kind: "Range", msb: numberLiteral(layout.width - 1, span), lsb: numberLiteral(0, span), span };
  }
  return undefined;
}

function unpackedRanges(layout, span) {
  let ranges = (layout?.unpacked ?? [])
    .filter((dim) => dim.count !== undefined)
    .map((dim) => ({ kind: "Range", msb: numberLiteral(dim.msb, span), lsb: numberLiteral(dim.lsb, span), span }));
  return ranges.length > 0 ? ranges : undefined;
}

class PackageScope extends SvScope {
  name;
  node;
  constructor(parent, node) {
    super(parent);
    this.name = node.name;
    this.node = node;
  }
  // A package only re-exports what it declares itself, not what it imports.
  lookupExported(name, table) {
    return this[table].get(name);
  }
}

class UnitScope extends SvScope {
  lowering;
  constructor(lowering) {
    super(undefined);
    this.lowering = lowering;
  }
  findPackage(name) {
    return this.lowering.getPackage(name);
  }
}

class Lowering {
  ast;
  options;
  diagnostics = [];
  packages = new Map();
  missingPackages = new Set();
  unitScope;
  // Per-module state.
  currentModuleScope;
  currentImported;
  currentOpenScope = false;
  currentFunction;
  constructor(ast, options) {
    this.ast = ast;
    this.options = options;
  }
  run() {
    this.unitScope = new UnitScope(this);
    for (let node of this.ast.packages) {
      this.packages.set(node.name, this.buildPackage(node));
    }
    for (let item of this.ast.unitItems) {
      this.registerDeclarations(item, this.unitScope, { synthetic: true });
    }
    this.ast.modules = this.ast.modules.map((node) => this.lowerModule(node));
    return this.diagnostics;
  }
  getPackage(name) {
    let known = this.packages.get(name);
    if (known) {
      return known;
    }
    if (this.missingPackages.has(name)) {
      return undefined;
    }
    let node = this.options.resolver?.resolvePackage?.(name, this.options.fileUri)?.packageNode;
    if (!node) {
      this.missingPackages.add(name);
      return undefined;
    }
    let scope = this.buildPackage(node);
    this.packages.set(name, scope);
    return scope;
  }
  buildPackage(node) {
    let scope = new PackageScope(this.unitScope, node);
    this.packages.set(node.name, scope);
    for (let item of node.items) {
      this.registerDeclarations(item, scope, { synthetic: true, packageName: node.name });
    }
    return scope;
  }
  // ---- Declarations visible by name

  registerDeclarations(item, scope, flags = {}) {
    switch (item.kind) {
      case "ImportDeclaration":
        this.registerImport(item, scope);
        break;
      case "TypedefDeclaration": {
        this.registerEnumsOf(item.dataType, scope, flags);
        let layout = resolveType(item.dataType, scope, item.dims);
        if (layout) {
          scope.types.set(item.name, layout);
        }
        break;
      }
      case "TypeParameterDeclaration": {
        let layout = item.defaultType ? resolveType(item.defaultType, scope) : undefined;
        scope.types.set(item.name, layout ?? { packed: [], unpacked: [], unresolved: true });
        break;
      }
      case "ParameterDeclaration": {
        this.registerEnumsOf(item.dataType, scope, flags);
        let declared = item.dataType ? resolveType(item.dataType, scope) : undefined;
        for (let parameter of item.parameters) {
          scope.values.set(parameter.name, {
            name: parameter.name,
            value: evalConst(parameter.valueExpr, scope),
            width: declared?.width ?? typeOf(parameter.valueExpr, scope)?.width,
            span: parameter.span,
            synthetic: flags.synthetic === true,
            qualified: flags.packageName ? `${flags.packageName}::${parameter.name}` : undefined,
          });
        }
        break;
      }
      case "DataDeclaration":
        this.registerEnumsOf(item.dataType, scope, flags);
        for (let declarator of item.declarators) {
          scope.signals.set(declarator.name, {
            layout: resolveType(item.dataType, scope, declarator.dims),
          });
        }
        break;
      case "PortDeclaration":
        if (item.dataType) {
          this.registerEnumsOf(item.dataType, scope, flags);
        }
        for (let identifier of item.identifiers) {
          scope.signals.set(identifier.name, {
            layout: this.portLayout(item, scope),
            interfaceRef: item.interfaceRef,
          });
        }
        break;
      case "FunctionDeclaration":
      case "TaskDeclaration":
        if (!flags.packageName) {
          scope.signals.set(item.name, {});
        }
        break;
      case "GenvarDeclaration":
        for (let identifier of item.identifiers) {
          scope.signals.set(identifier.name, {});
        }
        break;
      case "InstanceDeclaration":
        scope.signals.set(item.instanceName, {});
        break;
    }
  }
  portLayout(item, scope) {
    if (item.dataType) {
      return resolveType(item.dataType, scope, item.dimensions ?? []);
    }
    return { elementWidth: 1, width: 1, packed: [], unpacked: [] };
  }
  registerEnumsOf(dataType, scope, flags) {
    if (!dataType) {
      return;
    }
    if (dataType.base === "enum") {
      registerEnumValues(dataType, scope, scope.values, (item, value, width) => ({
        name: item.name,
        value,
        width,
        span: item.nameSpan,
        synthetic: true,
        isEnum: true,
        qualified: flags.packageName ? `${flags.packageName}::${item.name}` : undefined,
      }));
    } else if (dataType.base === "struct" || dataType.base === "union") {
      for (let member of dataType.members) {
        this.registerEnumsOf(member.dataType, scope, flags);
      }
    }
  }
  registerImport(item, scope) {
    for (let entry of item.imports) {
      let pkg = this.getPackage(entry.packageName);
      if (!pkg) {
        this.diagnostics.push({
          message: `Package '${entry.packageName}' not found in this file or the workspace.`,
          severity: "warning",
          span: entry.packageSpan,
          code: "SV-PACKAGE-NOT-FOUND",
        });
        this.currentOpenScope = true;
      } else if (entry.item === "*") {
        scope.wildcardImports.push(pkg);
      } else {
        scope.namedImports.set(entry.item, pkg);
      }
    }
  }

  // ---- Modules

  lowerModule(node) {
    let scope = new SvScope(this.unitScope);
    this.currentModuleScope = scope;
    this.currentImported = new Map();
    this.currentOpenScope = false;
    let flat = this.flattenItems(node.items, scope, new Set());
    let items = [];
    let portNames = node.portNames ? [...node.portNames] : undefined;
    for (let item of flat) {
      this.lowerItem(item, scope, items, node, portNames);
    }
    return {
      ...node,
      items,
      portNames,
      svModports: flat.filter((item) => item.kind === "ModportDeclaration").flatMap((item) => item.modports),
      svImportedSymbols: [...this.currentImported.values()],
      svOpenScope: this.currentOpenScope || undefined,
    };
  }
  // Generate constructs become plain module items: known conditions pick their branch,
  // unknown conditions keep all branches, loops contribute one copy of the body.
  flattenItems(items, scope, seen, inGenerate = false) {
    let out = [];
    for (let item of items) {
      if (!item) {
        continue;
      }
      switch (item.kind) {
        case "GenerateBlock":
        case "GenerateBlockStatement":
          out.push(...this.flattenItems(item.items, scope, seen, true));
          out.push(...this.flattenItems(item.statements, scope, seen, true));
          break;
        case "GenerateLoopStatement":
          out.push(...this.flattenLoop(item, scope, seen));
          break;
        case "GenerateIfStatement":
          out.push(...this.flattenIf(item, scope, seen));
          break;
        case "GenerateCaseStatement":
          out.push(...this.flattenCase(item, scope, seen));
          break;
        default:
          if (!inGenerate || this.isFirstDeclaration(item, seen)) {
            this.registerDeclarations(item, scope);
            out.push(item);
          }
      }
    }
    return out;
  }
  flattenLoop(item, scope, seen) {
    let out = [];
    let loopVar = item.initExpr?.left ?? item.initExpr;
    if (loopVar?.kind === "Identifier" && !scope.signals.has(loopVar.name)) {
      let genvar = {
        kind: "GenvarDeclaration",
        identifiers: [{ kind: "Identifier", name: loopVar.name, span: loopVar.span }],
        span: loopVar.span,
      };
      if (this.isFirstDeclaration(genvar, seen)) {
        this.registerDeclarations(genvar, scope);
        out.push(genvar);
      }
    }
    out.push(...this.flattenItems([item.body], scope, seen, true));
    return out;
  }
  flattenIf(item, scope, seen) {
    let condition = evalConst(item.condition, scope);
    if (condition === undefined) {
      return [
        ...this.flattenItems([item.thenBlock], scope, seen, true),
        ...(item.elseBlock ? this.flattenItems([item.elseBlock], scope, seen, true) : []),
      ];
    }
    let chosen = condition ? item.thenBlock : item.elseBlock;
    return chosen ? this.flattenItems([chosen], scope, seen, true) : [];
  }
  flattenCase(item, scope, seen) {
    let selector = evalConst(item.expression, scope);
    if (selector !== undefined) {
      let fallback;
      for (let entry of item.items) {
        if (entry.isDefault) {
          fallback = entry;
        } else if (entry.patterns.some((pattern) => evalConst(pattern, scope) === selector)) {
          return this.flattenItems([entry.body], scope, seen, true);
        }
      }
      return fallback ? this.flattenItems([fallback.body], scope, seen, true) : [];
    }
    return item.items.flatMap((entry) => this.flattenItems([entry.body], scope, seen, true));
  }
  // Alternative generate branches may declare the same name; only one survives flattening.
  isFirstDeclaration(item, seen) {
    let names = [];
    if (item.kind === "DataDeclaration") {
      let fresh = item.declarators.filter((declarator) => !seen.has(declarator.name));
      if (fresh.length === 0 && item.declarators.length > 0) {
        return false;
      }
      item.declarators = fresh;
      item.identifiers = item.identifiers.filter((identifier) => fresh.some((d) => d.name === identifier.name));
      names = fresh.map((declarator) => declarator.name);
    } else if (item.kind === "InstanceDeclaration") {
      names = [item.instanceName];
    } else if (item.kind === "GenvarDeclaration") {
      names = item.identifiers.map((identifier) => identifier.name);
    } else if (item.kind === "FunctionDeclaration" || item.kind === "TaskDeclaration") {
      names = [item.name];
    } else if (item.kind === "ParameterDeclaration") {
      names = item.parameters.map((parameter) => parameter.name);
    }
    if (item.kind !== "DataDeclaration" && names.some((name) => seen.has(name))) {
      return false;
    }
    for (let name of names) {
      seen.add(name);
    }
    return true;
  }
  lowerItem(item, scope, out, module, portNames) {
    switch (item.kind) {
      case "PortDeclaration":
        this.lowerPort(item, scope, out, portNames);
        break;
      case "DataDeclaration":
        this.lowerDataDeclaration(item, scope, out);
        break;
      case "ParameterDeclaration":
        out.push(this.lowerParameter(item, scope));
        break;
      case "ContinuousAssign": {
        let width = typeOf(item.lhs, scope)?.width;
        out.push({ ...item, lhs: this.lowerExpr(item.lhs, scope), rhs: fitUnsizedLiteral(this.lowerExpr(item.rhs, scope, width), width) });
        break;
      }
      case "AlwaysBlock":
        out.push({
          ...item,
          sensitivities: item.sensitivities.map((entry) => this.lowerSensitivity(entry, scope)),
          statement: this.lowerStatement(item.statement, scope),
        });
        break;
      case "InitialBlock":
        out.push({ ...item, statement: this.lowerStatement(item.statement, scope) });
        break;
      case "FunctionDeclaration":
      case "TaskDeclaration":
        out.push(this.lowerSubroutine(item, scope));
        break;
      case "InstanceDeclaration":
        this.lowerInstance(item, scope, out);
        break;
      case "GateInstantiation":
        out.push({
          ...item,
          instances: item.instances.map((instance) => ({
            ...instance,
            terminals: instance.terminals.map((terminal) => this.lowerExpr(terminal, scope)),
          })),
        });
        break;
      case "GenvarDeclaration":
        out.push(item);
        break;
    }
  }
  lowerSensitivity(entry, scope) {
    if (!entry.signal) {
      return entry;
    }
    let lookup = scope.lookup(entry.signal.name);
    if (!lookup && this.isSystemOrMacro(entry.signal.name)) {
      return { ...entry, signal: undefined };
    }
    return entry;
  }
  isSystemOrMacro(name) {
    return name.startsWith("$") || name.startsWith("`");
  }
  lowerPort(item, scope, out, portNames) {
    if (item.interfaceRef) {
      this.lowerInterfacePort(item, scope, out, portNames);
      return;
    }
    let layout = this.portLayout(item, scope);
    let declared = describeType(item.dataType);
    out.push({
      kind: "PortDeclaration",
      direction: item.direction,
      netType: item.netType && NET_KEYWORDS.has(item.netType) ? item.netType : declared,
      signedness: item.signedness,
      range: numericRange(layout, item.span),
      identifiers: item.identifiers,
      svDimensions: unpackedRanges(layout, item.span),
      span: item.span,
    });
  }
  lowerInterfacePort(item, scope, out, portNames) {
    let identifier = item.identifiers[0];
    let ref = item.interfaceRef;
    let definition = ref.generic ? undefined : this.findInterface(ref.name);
    if (!definition) {
      // Unknown interface: a single opaque port; member accesses stay unchecked.
      out.push({ kind: "PortDeclaration", direction: "inout", netType: ref.name, identifiers: item.identifiers, span: item.span });
      return;
    }
    let directions = new Map();
    let modport = definition.svModports?.find((entry) => entry.name === ref.modport);
    for (let port of modport?.ports ?? []) {
      directions.set(port.name, port.direction);
    }
    let signals = interfaceSignals(definition);
    let entry = scope.signals.get(identifier.name);
    if (entry) {
      entry.interfaceSignals = signals;
    }
    let index = portNames?.indexOf(identifier.name) ?? -1;
    let flatNames = [];
    for (let signal of signals) {
      if (modport && !directions.has(signal.name)) {
        continue;
      }
      let flatName = `${identifier.name}.${signal.name}`;
      flatNames.push(flatName);
      scope.signals.set(flatName, { layout: signal.layout });
      out.push({
        kind: "PortDeclaration",
        direction: directions.get(signal.name) ?? "inout",
        netType: signal.netType,
        range: signal.range,
        identifiers: [{ kind: "Identifier", name: flatName, span: identifier.span }],
        svInterfacePort: identifier.name,
        span: item.span,
      });
    }
    if (index >= 0) {
      portNames.splice(index, 1, ...flatNames);
    }
  }
  findInterface(name) {
    return this.findModuleDefinition(name, "interface");
  }
  findModuleDefinition(name, designUnit) {
    let matches = (node) => node?.name === name && (!designUnit || node.designUnit === designUnit);
    let local = this.ast.modules.find(matches);
    if (local) {
      // Modules are lowered in order; a later definition in the same file is lowered on demand.
      return local.svModports ? local : this.lowerSibling(local);
    }
    let found = this.options.resolver?.resolveModule(name, this.options.fileUri);
    return found?.found && matches(found.moduleNode) ? found.moduleNode : undefined;
  }
  lowerSibling(node) {
    let saved = {
      moduleScope: this.currentModuleScope,
      imported: this.currentImported,
      open: this.currentOpenScope,
      fn: this.currentFunction,
    };
    let lowered = this.lowerModule(node);
    this.currentModuleScope = saved.moduleScope;
    this.currentImported = saved.imported;
    this.currentOpenScope = saved.open;
    this.currentFunction = saved.fn;
    return lowered;
  }
  lowerDataDeclaration(item, scope, out) {
    let isNet = item.netType !== undefined;
    let declared = isNet ? item.netType : (describeType(item.dataType) ?? "logic");
    let groups = item.declarators.some((d) => d.dims.length > 0)
      ? item.declarators.map((d) => [d])
      : [item.declarators];
    for (let group of groups) {
      if (group.length === 0) {
        continue;
      }
      let layout = resolveType(item.dataType, scope, group[0].dims);
      let assignments = [];
      for (let declarator of group) {
        if (declarator.init) {
          let expr = this.lowerExpr(declarator.init, scope, layout?.width, layout);
          assignments.push({ name: declarator.name, nameSpan: declarator.nameSpan, expr });
        }
      }
      out.push({
        kind: "NetDeclaration",
        netType: declared,
        svVariable: !isNet,
        svWidth: layout?.width,
        signedness: item.dataType?.signedness,
        range: numericRange(layout, item.span),
        identifiers: group.map((d) => ({ kind: "Identifier", name: d.name, span: d.nameSpan })),
        dimensions: unpackedRanges(layout, item.span),
        assignments: assignments.length > 0 ? assignments : undefined,
        span: item.span,
      });
    }
  }
  lowerParameter(item, scope) {
    let layout = item.dataType ? resolveType(item.dataType, scope) : undefined;
    return {
      kind: "ParameterDeclaration",
      isLocal: item.isLocal,
      range: numericRange(layout, item.span),
      parameters: item.parameters.map((parameter) => {
        let value = evalConst(parameter.valueExpr, scope);
        let span = parameter.valueExpr?.span ?? parameter.span;
        return {
          name: parameter.name,
          span: parameter.span,
          valueExpr:
            value !== undefined && Math.abs(value) < Number.MAX_SAFE_INTEGER
              ? numberLiteral(value, span)
              : parameter.valueExpr
                ? this.lowerExpr(parameter.valueExpr, scope, layout?.width, layout)
                : undefined,
        };
      }),
      span: item.span,
    };
  }
  lowerInstance(item, scope, out) {
    let definition = this.findInterface(item.moduleName);
    if (definition) {
      this.lowerInterfaceInstance(item, definition, scope, out);
      return;
    }
    let connections = item.portConnections;
    let needsChild = connections.some(
      (connection) =>
        connection.kind === "WildcardPortConnection" ||
        (connection.expression?.kind === "Identifier" && scope.signals.get(connection.expression.name)?.interfaceSignals),
    );
    let child = needsChild ? this.findModuleDefinition(item.moduleName) : undefined;
    let lowered = [];
    let named = new Set();
    for (let connection of connections) {
      if (connection.kind === "WildcardPortConnection") {
        continue;
      }
      named.add(connection.portName);
      let expression = connection.expression;
      let interfaceEntry = expression?.kind === "Identifier" ? scope.signals.get(expression.name) : undefined;
      if (interfaceEntry?.interfaceSignals && child) {
        lowered.push(...expandInterfaceConnection(connection, expression.name, child));
        continue;
      }
      lowered.push({
        ...connection,
        expression: expression ? this.lowerExpr(expression, scope, this.childPortWidth(child, connection.portName)) : undefined,
      });
    }
    if (child && connections.some((connection) => connection.kind === "WildcardPortConnection")) {
      for (let port of portsOf(child)) {
        if (named.has(port.name) || lowered.some((connection) => connection.portName === port.name)) {
          continue;
        }
        let local = this.wildcardLocalName(port.name, scope);
        if (local) {
          lowered.push({
            kind: "NamedPortConnection",
            portName: port.name,
            portNameSpan: item.instanceNameSpan,
            implicit: true,
            expression: { kind: "Identifier", name: local, span: item.instanceNameSpan },
            span: item.instanceNameSpan,
          });
        }
      }
    }
    out.push({ ...item, portConnections: lowered });
  }
  wildcardLocalName(portName, scope) {
    if (portName.includes(".")) {
      let [port, member] = portName.split(".");
      let entry = scope.signals.get(port);
      return entry?.interfaceSignals ? `${port}.${member}` : undefined;
    }
    return scope.lookup(portName)?.kind === "signal" ? portName : undefined;
  }
  childPortWidth(child, portName) {
    if (!child) {
      return undefined;
    }
    let port = child.items.find(
      (item) => item.kind === "PortDeclaration" && item.identifiers.some((identifier) => identifier.name === portName),
    );
    return port?.range ? Math.abs(port.range.msb.value - port.range.lsb.value) + 1 : undefined;
  }
  lowerInterfaceInstance(item, definition, scope, out) {
    let signals = interfaceSignals(definition);
    let entry = scope.signals.get(item.instanceName) ?? {};
    entry.interfaceSignals = signals;
    scope.signals.set(item.instanceName, entry);
    for (let signal of signals) {
      let flatName = `${item.instanceName}.${signal.name}`;
      scope.signals.set(flatName, { layout: signal.layout });
      out.push({
        kind: "NetDeclaration",
        netType: signal.netType ?? "logic",
        svVariable: true,
        range: signal.range,
        identifiers: [{ kind: "Identifier", name: flatName, span: item.instanceNameSpan }],
        span: item.span,
      });
    }
  }
  lowerSubroutine(item, scope) {
    let inner = new SvScope(scope);
    let ports = [];
    for (let port of item.ports) {
      this.registerDeclarations(port, inner);
      let layout = this.portLayout(port, inner);
      ports.push({
        kind: "PortDeclaration",
        direction: port.direction,
        netType: describeType(port.dataType) ?? port.netType,
        signedness: port.signedness,
        range: numericRange(layout, port.span),
        identifiers: port.identifiers,
        svLocal: true,
        span: port.span,
      });
    }
    let savedFunction = this.currentFunction;
    this.currentFunction = item.kind === "FunctionDeclaration" ? item : undefined;
    let { statements, localDecls } = this.lowerStatementList(item.statements, inner);
    this.currentFunction = savedFunction;
    let body = localDecls.length > 0 ? [{ kind: "BlockStatement", statements, localDecls, span: item.span }] : statements;
    let lowered = { ...item, ports, statements: body };
    if (item.kind === "FunctionDeclaration") {
      let layout = item.returnDataType ? resolveType(item.returnDataType, inner) : undefined;
      lowered.range = numericRange(layout, item.span);
      lowered.returnType = describeType(item.returnDataType);
    }
    return lowered;
  }

  // ---- Statements

  lowerStatementList(statements, scope) {
    let lowered = [];
    let localDecls = [];
    for (let statement of statements) {
      if (statement.kind === "LocalVarDeclaration") {
        this.lowerLocalVariable(statement, scope, lowered, localDecls);
      } else if (statement.kind === "LocalItemStatement") {
        if (statement.item) {
          for (let item of Array.isArray(statement.item) ? statement.item : [statement.item]) {
            this.registerDeclarations(item, scope, { synthetic: true });
          }
        }
      } else {
        lowered.push(this.lowerStatement(statement, scope));
      }
    }
    return { statements: lowered, localDecls };
  }
  lowerLocalVariable(statement, scope, lowered, localDecls) {
    this.registerDeclarations({ ...statement, kind: "DataDeclaration" }, scope, { synthetic: true });
    let out = [];
    this.lowerDataDeclaration({ ...statement, netType: undefined }, scope, out);
    for (let declaration of out) {
      localDecls.push({ ...declaration, assignments: undefined });
      for (let assignment of declaration.assignments ?? []) {
        lowered.push({
          kind: "BlockingAssign",
          lhs: { kind: "Identifier", name: assignment.name, span: assignment.nameSpan },
          rhs: assignment.expr,
          span: assignment.nameSpan,
        });
      }
    }
  }
  lowerStatement(statement, scope) {
    if (!statement) {
      return statement;
    }
    switch (statement.kind) {
      case "BlockStatement": {
        let inner = new SvScope(scope);
        let { statements, localDecls } = this.lowerStatementList(statement.statements, inner);
        return { ...statement, statements, localDecls: localDecls.length > 0 ? localDecls : undefined };
      }
      case "BlockingAssign":
      case "NonBlockingAssign": {
        let layout = typeOf(statement.lhs, scope);
        return {
          ...statement,
          svLocalTarget: this.isLocalTarget(statement.lhs, scope) || undefined,
          lhs: this.lowerExpr(statement.lhs, scope),
          rhs: fitUnsizedLiteral(this.lowerExpr(statement.rhs, scope, layout?.width, layout), layout?.width),
        };
      }
      case "IfStatement":
        return {
          ...statement,
          condition: this.lowerExpr(statement.condition, scope),
          thenBranch: this.lowerStatement(statement.thenBranch, scope),
          elseBranch: statement.elseBranch ? this.lowerStatement(statement.elseBranch, scope) : undefined,
        };
      case "CaseStatement": {
        let width = typeOf(statement.expression, scope)?.width;
        return {
          ...statement,
          expression: this.lowerExpr(statement.expression, scope),
          items: statement.items.map((item) => ({
            ...item,
            patterns: item.patterns.map((pattern) => this.lowerCasePattern(pattern, scope, width)),
            statement: this.lowerStatement(item.statement, scope),
          })),
        };
      }
      case "LoopStatement":
        return this.lowerLoop(statement, scope);
      case "ForeachStatement":
        return this.lowerForeach(statement, scope);
      case "ReturnStatement":
        return this.lowerReturn(statement, scope);
      case "DelayStatement":
        return { ...statement, delayExpr: statement.delayExpr ? this.lowerExpr(statement.delayExpr, scope) : undefined };
      case "SystemTaskCall":
        return { ...statement, args: statement.args.map((arg) => this.lowerExpr(arg, scope)) };
      case "TaskCallStatement":
        return { ...statement, target: undefined, args: statement.args.map((arg) => this.lowerExpr(arg, scope)) };
      case "ExpressionStatement": {
        let expression = this.lowerExpr(statement.expression, scope);
        if (expression.kind === "FunctionCall") {
          return { kind: "TaskCallStatement", name: expression.name, args: expression.args, span: statement.span };
        }
        return { kind: "EmptyStatement", span: statement.span };
      }
      case "EventControlStatement":
        return { ...statement, sensitivities: statement.sensitivities.map((entry) => this.lowerSensitivity(entry, scope)) };
      case "JumpStatement":
      case "AssertionStatement":
      case "WaitStatement":
      case "LocalVarDeclaration":
      case "LocalItemStatement":
        return { kind: "EmptyStatement", span: statement.span };
      default:
        return statement;
    }
  }
  isLocalTarget(lhs, scope) {
    let root = lhs;
    for (; root.kind === "BitSelect" || root.kind === "PartSelect" || root.kind === "IndexedPartSelect" || root.kind === "MemberSelect";) {
      root = root.target;
    }
    if (root.kind !== "Identifier") {
      return false;
    }
    for (let current = scope; current && current !== this.currentModuleScope; current = current.parent) {
      if (current.signals.has(root.name)) {
        return true;
      }
    }
    return false;
  }
  lowerCasePattern(pattern, scope, width) {
    if (pattern.kind === "ValueRange") {
      return this.rangeCheck(pattern, undefined, scope);
    }
    return this.lowerExpr(pattern, scope, width);
  }
  lowerLoop(statement, scope) {
    let inner = new SvScope(scope);
    let localDecls = [];
    let lowered = [];
    for (let local of statement.localVars ?? []) {
      let declaration = {
        kind: "LocalVarDeclaration",
        dataType: local.dataType ?? { kind: "DataType", base: "int", dims: [], span: local.nameSpan },
        identifiers: [{ kind: "Identifier", name: local.name, span: local.nameSpan }],
        declarators: [{ ...local, init: undefined }],
        qualifiers: [],
        span: local.nameSpan,
      };
      this.lowerLocalVariable(declaration, inner, lowered, localDecls);
    }
    let lowerOptional = (expr, width) => (expr ? this.lowerExpr(expr, inner, width) : undefined);
    return {
      ...statement,
      localVars: undefined,
      localDecls: localDecls.length > 0 ? localDecls : undefined,
      initExpr: lowerOptional(statement.initExpr),
      extraInits: undefined,
      condition: lowerOptional(statement.condition),
      stepExpr: lowerOptional(statement.stepExpr),
      extraSteps: undefined,
      countExpr: lowerOptional(statement.countExpr),
      body: this.lowerStatement(statement.body, inner),
    };
  }
  lowerForeach(statement, scope) {
    let inner = new SvScope(scope);
    let localDecls = [];
    let vars = statement.loopVars.filter(Boolean);
    let layout = typeOf(statement.array, scope);
    for (let variable of vars) {
      inner.signals.set(variable.name, { layout: { elementWidth: 32, width: 32, packed: [], unpacked: [] } });
      localDecls.push({
        kind: "NetDeclaration",
        netType: "int",
        svVariable: true,
        range: numericRange({ width: 32, elementWidth: 32, packed: [] }, variable.span),
        identifiers: [{ kind: "Identifier", name: variable.name, span: variable.span }],
        span: variable.span,
      });
    }
    let array = this.lowerExpr(statement.array, scope);
    let first = vars[0];
    let span = statement.span;
    void layout;
    return {
      kind: "LoopStatement",
      loopKind: "for",
      localDecls: localDecls.length > 0 ? localDecls : undefined,
      initExpr: first
        ? { kind: "BinaryExpression", operator: "=", left: variableRef(first), right: numberLiteral(0, span), span: first.span }
        : undefined,
      condition: first
        ? {
            kind: "BinaryExpression",
            operator: "<",
            left: variableRef(first),
            right: { kind: "SystemFunctionCall", name: "$size", args: [array], span },
            span: first.span,
          }
        : undefined,
      stepExpr: first
        ? {
            kind: "BinaryExpression",
            operator: "=",
            left: variableRef(first),
            right: {
              kind: "BinaryExpression",
              operator: "+",
              left: variableRef(first),
              right: numberLiteral(1, span),
              span: first.span,
            },
            span: first.span,
          }
        : undefined,
      body: this.lowerStatement(statement.body, inner),
      span,
    };
  }
  lowerReturn(statement, scope) {
    if (!statement.value || !this.currentFunction) {
      if (statement.value) {
        this.lowerExpr(statement.value, scope);
      }
      return { kind: "EmptyStatement", span: statement.span };
    }
    let layout = this.currentFunction.returnDataType ? resolveType(this.currentFunction.returnDataType, scope) : undefined;
    return {
      kind: "BlockingAssign",
      lhs: { kind: "Identifier", name: this.currentFunction.name, span: this.currentFunction.nameSpan ?? statement.span },
      rhs: this.lowerExpr(statement.value, scope, layout?.width, layout),
      svReturn: true,
      span: statement.span,
    };
  }

  // ---- Expressions

  lowerExpr(expr, scope, width, layout) {
    if (!expr) {
      return expr;
    }
    switch (expr.kind) {
      case "Identifier":
        this.noteIdentifier(expr, scope);
        return expr;
      case "ScopedIdentifier":
        return this.lowerScoped(expr, scope);
      case "NumberLiteral":
        return expr.unbased !== undefined ? sizedLiteral(expr.unbased, width, expr.span) : expr;
      case "BinaryExpression":
        return this.lowerBinary(expr, scope, width);
      case "UnaryExpression":
        return { ...expr, argument: this.lowerExpr(expr.argument, scope, width) };
      case "TernaryExpression":
        return {
          ...expr,
          condition: this.lowerExpr(expr.condition, scope),
          trueExpr: this.lowerExpr(expr.trueExpr, scope, width, layout),
          falseExpr: this.lowerExpr(expr.falseExpr, scope, width, layout),
        };
      case "BitSelect":
        return this.lowerBitSelect(expr, scope);
      case "PartSelect":
        return {
          ...expr,
          target: this.lowerExpr(expr.target, scope),
          msb: this.lowerBound(expr.msb, scope),
          lsb: this.lowerBound(expr.lsb, scope),
        };
      case "IndexedPartSelect":
        return this.lowerIndexedPartSelect(expr, scope);
      case "MemberSelect":
        return this.lowerMember(expr, scope);
      case "Concatenation":
        return { ...expr, elements: expr.elements.map((element) => this.lowerExpr(element, scope)) };
      case "ReplicationExpression":
        return {
          ...expr,
          multiplier: this.lowerBound(expr.multiplier, scope),
          elements: expr.elements.map((element) => this.lowerExpr(element, scope)),
        };
      case "FunctionCall":
        return { ...expr, target: undefined, args: expr.args.map((arg) => this.lowerExpr(arg, scope)) };
      case "SystemFunctionCall":
        return this.lowerSystemCall(expr, scope);
      case "CastExpression":
        return this.lowerCast(expr, scope);
      case "InsideExpression":
        return this.lowerInside(expr, scope);
      case "AssignmentPattern":
        return this.lowerPattern(expr, scope, width, layout);
      case "IncDecExpression":
        return this.lowerExpr(expr.argument, scope);
      case "DataType":
      case "ValueRange":
        return { kind: "OpaqueExpression", text: expr.kind, span: expr.span };
      default:
        return expr;
    }
  }
  noteIdentifier(expr, scope) {
    let hit = scope.lookup(expr.name);
    if (hit?.kind === "value" && hit.entry.synthetic) {
      this.currentImported?.set(expr.name, { ...hit.entry, name: expr.name });
    }
  }
  lowerScoped(expr, scope) {
    let pkg = findPackage(scope, expr.scope);
    let value = pkg?.values.get(expr.name);
    if (!value) {
      return { kind: "OpaqueExpression", text: `${expr.scope}::${expr.name}`, span: expr.span };
    }
    let name = `${expr.scope}::${expr.name}`;
    this.currentImported?.set(name, { ...value, name });
    return { kind: "Identifier", name, span: expr.span };
  }
  lowerBinary(expr, scope, width) {
    let leftWidth = typeOf(expr.left, scope)?.width;
    let rightWidth = typeOf(expr.right, scope)?.width;
    let comparison = ["==", "!=", "===", "!==", "==?", "!=?", "<", "<=", ">", ">="].includes(expr.operator);
    let contextWidth = comparison ? undefined : width;
    let operator = expr.operator === "==?" ? "==" : expr.operator === "!=?" ? "!=" : expr.operator;
    if (operator === "->" || operator === "<->") {
      operator = "||";
    }
    return {
      ...expr,
      operator,
      left: fitUnsizedLiteral(this.lowerExpr(expr.left, scope, rightWidth ?? contextWidth), rightWidth),
      right: fitUnsizedLiteral(this.lowerExpr(expr.right, scope, leftWidth ?? contextWidth), leftWidth),
    };
  }
  lowerBound(expr, scope) {
    let value = evalConst(expr, scope);
    if (value !== undefined && Math.abs(value) < NUMERIC_BOUND_LIMIT) {
      return numberLiteral(value, expr.span);
    }
    return this.lowerExpr(expr, scope);
  }
  lowerBitSelect(expr, scope) {
    let layout = typeOf(expr.target, scope);
    let target = this.lowerExpr(expr.target, scope);
    let isPackedIndex = layout && layout.unpacked.length === 0 && layout.packed.length > 0;
    let element = indexLayout(layout);
    let index = evalConst(expr.index, scope);
    if (isPackedIndex && element?.width > 1) {
      let lsb = layout.packed[0].lsb ?? 0;
      if (index !== undefined) {
        let low = (index - lsb) * element.width;
        return this.sliceOf(target, low, element.width, expr.span);
      }
      let indexExpr = this.lowerExpr(expr.index, scope);
      let low = {
        kind: "BinaryExpression",
        operator: "*",
        left: indexExpr,
        right: numberLiteral(element.width, expr.span),
        span: expr.span,
      };
      return {
        kind: "PartSelect",
        target,
        msb: { kind: "BinaryExpression", operator: "+", left: low, right: numberLiteral(element.width - 1, expr.span), span: expr.span },
        lsb: low,
        svWidth: element.width,
        span: expr.span,
      };
    }
    return {
      ...expr,
      target,
      index: this.lowerBound(expr.index, scope),
      svWidth: element?.width,
      svWidthUnknown: element?.width === undefined || undefined,
    };
  }
  sliceOf(target, low, width, span) {
    if (target.kind === "PartSelect" && target.lsb.kind === "NumberLiteral" && target.msb.kind === "NumberLiteral") {
      let base = target.lsb.value + low;
      return { ...target, msb: numberLiteral(base + width - 1, span), lsb: numberLiteral(base, span), span };
    }
    if (width === 1) {
      return { kind: "BitSelect", target, index: numberLiteral(low, span), span };
    }
    return { kind: "PartSelect", target, msb: numberLiteral(low + width - 1, span), lsb: numberLiteral(low, span), span };
  }
  lowerIndexedPartSelect(expr, scope) {
    let target = this.lowerExpr(expr.target, scope);
    let base = evalConst(expr.base, scope);
    let width = evalConst(expr.width, scope);
    let span = expr.span;
    if (base !== undefined && width !== undefined) {
      let low = expr.direction === "+:" ? base : base - width + 1;
      return { kind: "PartSelect", target, msb: numberLiteral(low + width - 1, span), lsb: numberLiteral(low, span), span };
    }
    let baseExpr = this.lowerExpr(expr.base, scope);
    let widthExpr = this.lowerExpr(expr.width, scope);
    let offset = {
      kind: "BinaryExpression",
      operator: "-",
      left: widthExpr,
      right: numberLiteral(1, span),
      span,
    };
    let other = {
      kind: "BinaryExpression",
      operator: expr.direction === "+:" ? "+" : "-",
      left: baseExpr,
      right: offset,
      span,
    };
    return {
      kind: "PartSelect",
      target,
      msb: expr.direction === "+:" ? other : baseExpr,
      lsb: expr.direction === "+:" ? baseExpr : other,
      svWidth: width,
      span,
    };
  }
  lowerMember(expr, scope) {
    let flatName = dottedName(expr);
    if (flatName && scope.lookup(flatName)?.kind === "signal") {
      return { kind: "Identifier", name: flatName, span: expr.span };
    }
    let layout = typeOf(expr.target, scope);
    let member = layout?.members?.get(expr.member);
    let target = this.lowerExpr(expr.target, scope);
    if (member && member.offset !== undefined && member.layout?.width !== undefined) {
      let slice = this.sliceOf(target, member.offset, member.layout.width, expr.span);
      slice.svMember = expr.member;
      slice.svMemberSpan = expr.memberSpan;
      return slice;
    }
    // Hierarchical reference, class member or an unresolved type: keep the name without judging it.
    return { kind: "OpaqueExpression", text: flatName ?? expr.member, inner: target, span: expr.span };
  }
  lowerSystemCall(expr, scope) {
    let value = evalConst(expr, scope);
    if (value !== undefined) {
      return { ...numberLiteral(value, expr.span), svConstantOf: expr.name };
    }
    let isTypeQuery = expr.name === "$bits" || expr.name === "$typename";
    return {
      ...expr,
      args: expr.args.map((arg) =>
        isTypeQuery && arg.kind === "Identifier" && !scope.lookup(arg.name)
          ? { kind: "OpaqueExpression", text: arg.name, span: arg.span }
          : this.lowerExpr(arg, scope),
      ),
    };
  }
  lowerCast(expr, scope) {
    let layout = castLayout(expr, scope);
    let inner = this.lowerExpr(expr.expression, scope, layout?.width, layout);
    return layout?.width === undefined ? inner : { ...inner, svWidth: layout.width };
  }
  rangeCheck(range, subject, scope) {
    let low = this.lowerExpr(range.low, scope);
    let high = this.lowerExpr(range.high, scope);
    if (!subject) {
      return low;
    }
    let span = range.span;
    return {
      kind: "BinaryExpression",
      operator: "&&",
      left: { kind: "BinaryExpression", operator: ">=", left: subject, right: low, span },
      right: { kind: "BinaryExpression", operator: "<=", left: subject, right: high, span },
      span,
    };
  }
  lowerInside(expr, scope) {
    let subject = this.lowerExpr(expr.expression, scope);
    let width = typeOf(expr.expression, scope)?.width;
    let result;
    for (let item of expr.items) {
      let check =
        item.kind === "ValueRange"
          ? this.rangeCheck(item, subject, scope)
          : {
              kind: "BinaryExpression",
              operator: "==",
              left: subject,
              right: this.lowerExpr(item, scope, width),
              span: item.span,
            };
      result = result ? { kind: "BinaryExpression", operator: "||", left: result, right: check, span: expr.span } : check;
    }
    return result ?? numberLiteral(0, expr.span);
  }
  lowerPattern(expr, scope, width, layout) {
    let resolved = expr.dataType ? resolveType(expr.dataType, scope) : layout;
    let total = resolved?.width ?? width;
    let defaults = expr.items.find((item) => item.isDefault);
    if (defaults && expr.items.length === 1) {
      return this.lowerExpr(defaults.value, scope, total);
    }
    let members = resolved?.members;
    let keyed = expr.items.some((item) => item.key);
    let elements = [];
    if (members && keyed) {
      let byKey = new Map();
      for (let item of expr.items) {
        if (item.key?.kind === "Identifier") {
          byKey.set(item.key.name, item.value);
        }
      }
      // members were laid out from the LSB up; a concatenation lists the MSB first.
      for (let [name, member] of [...members.entries()].reverse()) {
        let value = byKey.get(name) ?? defaults?.value;
        elements.push(
          value ? this.lowerExpr(value, scope, member.layout?.width, member.layout) : sizedLiteral("0", member.layout?.width, expr.span),
        );
      }
    } else {
      let ordered = members ? [...members.values()].reverse() : [];
      expr.items.forEach((item, position) => {
        if (item.count) {
          for (let value of item.values) {
            elements.push({
              kind: "ReplicationExpression",
              multiplier: this.lowerBound(item.count, scope),
              elements: [this.lowerExpr(value, scope)],
              span: value.span,
            });
          }
          return;
        }
        let member = ordered[position];
        elements.push(this.lowerExpr(item.value, scope, member?.layout?.width, member?.layout));
      });
    }
    return { kind: "Concatenation", elements, span: expr.span };
  }
}

// `x + 1` is not a width mismatch: an unsized literal that fits takes the other operand's width.
function fitUnsizedLiteral(expr, width) {
  if (
    expr.kind === "NumberLiteral" &&
    width !== undefined &&
    expr.bitWidth === undefined &&
    !expr.raw.includes("'") &&
    expr.value >= 0 &&
    (width >= 32 || expr.value < Math.pow(2, width))
  ) {
    return { ...expr, svWidth: width };
  }
  return expr;
}

function variableRef(variable) {
  return { kind: "Identifier", name: variable.name, span: variable.span };
}

function dottedName(expr) {
  if (expr.kind === "Identifier") {
    return expr.name;
  }
  if (expr.kind === "MemberSelect") {
    let target = dottedName(expr.target);
    return target ? `${target}.${expr.member}` : undefined;
  }
  return undefined;
}

function portsOf(module) {
  return module.items
    .filter((item) => item.kind === "PortDeclaration")
    .flatMap((item) => item.identifiers.map((identifier) => ({ name: identifier.name, item })));
}

function interfaceSignals(definition) {
  let signals = [];
  for (let item of definition.items) {
    if (item.kind === "NetDeclaration" || item.kind === "PortDeclaration") {
      for (let identifier of item.identifiers) {
        signals.push({
          name: identifier.name,
          netType: item.netType,
          range: item.range,
          layout: layoutFromRange(item.range),
        });
      }
    }
  }
  return signals;
}

function layoutFromRange(range) {
  if (!range) {
    return { elementWidth: 1, width: 1, packed: [], unpacked: [] };
  }
  let msb = range.msb.value;
  let lsb = range.lsb.value;
  return {
    elementWidth: 1,
    width: Math.abs(msb - lsb) + 1,
    packed: [{ count: Math.abs(msb - lsb) + 1, msb, lsb }],
    unpacked: [],
  };
}

function expandInterfaceConnection(connection, localName, child) {
  let prefix = `${connection.portName}.`;
  return portsOf(child)
    .filter((port) => port.name.startsWith(prefix))
    .map((port) => ({
      kind: "NamedPortConnection",
      portName: port.name,
      portNameSpan: connection.portNameSpan,
      expression: {
        kind: "Identifier",
        name: `${localName}.${port.name.slice(prefix.length)}`,
        span: connection.expression.span,
      },
      span: connection.span,
    }));
}

export function lowerSourceFile(ast, options = {}) {
  return new Lowering(ast, options).run();
}
