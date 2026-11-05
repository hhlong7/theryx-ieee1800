// IEEE 1800 rules the shared analyzer cannot see, because they need the SystemVerilog AST:
// names and types, packages, instance connections, subroutine calls, drivers, constants.
// Reports only what is certain: anything that depends on a file this pass could not read stays silent.

const BUILTIN_TYPES = new Set(["mailbox", "semaphore", "process", "uvm_void"]);
const BUILTIN_SCOPES = new Set(["std", "$unit", "local", "this", "super"]);
const BUILTIN_CALLS = new Set(["randomize", "srandom", "get_randstate", "set_randstate"]);
const CONSTANT_QUERY_FUNCTIONS = new Set([
  "$bits", "$size", "$dimensions", "$unpacked_dimensions", "$left", "$right", "$low", "$high", "$increment", "$typename",
]);
const NET_KEYWORDS = new Set([
  "wire", "tri", "tri0", "tri1", "wand", "wor", "triand", "trior", "trireg", "supply0", "supply1", "uwire", "interconnect",
]);
const TWO_STATE_TYPES = new Set(["bit", "byte", "shortint", "int", "longint"]);
const REAL_TYPES = new Set(["real", "shortreal", "realtime"]);
const ATOM_WIDTHS = { byte: 8, shortint: 16, int: 32, longint: 64, integer: 32, time: 64 };
const GENERIC_WALK_SKIP = new Set(["span", "nameSpan", "memberSpan", "portNameSpan", "key"]);
const NAMED_REGION_KINDS = {
  covergroup: "type",
  nettype: "type",
  let: "function",
  property: "region",
  sequence: "region",
  clocking: "region",
  checker: "type",
  typedef: "type",
  specparam: "specparam",
};
// Kinds the shared analyzer does not report duplicates for.
const OWN_DUPLICATE_KINDS = new Set(["type", "enum", "block"]);

class NameScope {
  names = new Map();
  wildcard = [];
  named = new Map();
  constructor(parent, checker, strict = false) {
    this.parent = parent;
    this.checker = checker;
    this.strict = strict;
  }
  lookup(name) {
    for (let scope = this; scope; scope = scope.parent) {
      let entry = scope.names.get(name) ?? scope.importedEntry(name);
      if (entry) {
        return entry;
      }
    }
    return undefined;
  }
  importedEntry(name) {
    let source = this.named.get(name);
    if (source) {
      return this.checker.packageEntries(source).get(name);
    }
    for (let pkg of this.wildcard) {
      let entry = this.checker.packageEntries(pkg).get(name);
      if (entry) {
        return entry;
      }
    }
    return undefined;
  }
}

export class SvChecker {
  diagnostics = [];
  seen = new Set();
  packageCache = new Map();
  rawModules = new Map();
  classNames = new Set();
  constructor(ast, lowering) {
    this.ast = ast;
    this.lowering = lowering;
    this.resolver = lowering.options.resolver;
    this.fileUri = lowering.options.fileUri;
    // Unresolved includes, undefined macros and missing packages can declare anything.
    this.open = Boolean(ast.svUnresolvedSource) || this.hasMissingImport();
  }
  run() {
    for (let node of this.ast.modules) {
      if (!this.rawModules.has(node.name)) {
        this.rawModules.set(node.name, node);
      }
    }
    for (let node of this.ast.classes ?? []) {
      this.checkDuplicateClass(node);
    }
    this.unitScope = new NameScope(undefined, this, true);
    this.declareItems(this.ast.unitItems, this.unitScope);
    this.checkPackages();
    this.checkItems(this.ast.unitItems, this.unitScope, { reportUndeclared: true });
    for (let node of this.ast.classes ?? []) {
      this.checkClassBase(node, this.unitScope);
    }
    for (let node of this.ast.modules) {
      this.checkModule(node);
    }
    return this.diagnostics;
  }
  error(message, span, code) {
    let key = `${message}@${span?.start?.line}:${span?.start?.column}`;
    if (!this.seen.has(key)) {
      this.seen.add(key);
      this.diagnostics.push({ message, severity: "error", span, code });
    }
  }
  hasMissingImport() {
    let missing = false;
    let visit = (items) => {
      for (let item of items ?? []) {
        if (item?.kind === "ImportDeclaration") {
          missing ||= item.imports.some((entry) => !BUILTIN_SCOPES.has(entry.packageName) && !this.lowering.getPackage(entry.packageName));
        } else if (item?.items) {
          visit(item.items);
        }
      }
    };
    visit(this.ast.unitItems);
    visit(this.ast.packages);
    visit(this.ast.modules);
    return missing;
  }
  checkDuplicateClass(node) {
    if (this.classNames.has(node.name)) {
      this.error(`Duplicate class '${node.name}'`, node.nameSpan, "SEM-DUPLICATE-CLASS");
    }
    this.classNames.add(node.name);
  }

  // ---- Packages

  checkPackages() {
    let names = new Set();
    for (let node of this.ast.packages) {
      if (names.has(node.name)) {
        this.error(`Duplicate package '${node.name}'`, node.nameSpan, "SEM-DUPLICATE-PACKAGE");
      }
      names.add(node.name);
      let scope = new NameScope(this.unitScope, this, true);
      this.declareItems(node.items, scope);
      this.checkItems(node.items, scope, { reportUndeclared: true });
    }
  }
  // Everything a package makes visible to `import` and `::`.
  packageEntries(pkg, visiting = new Set()) {
    let cached = this.packageCache.get(pkg);
    if (cached) {
      return cached;
    }
    let entries = new Map();
    if (visiting.has(pkg) || !pkg.node) {
      return entries;
    }
    visiting.add(pkg);
    let silent = new NameScope(undefined, this);
    silent.quiet = true;
    let imports = [];
    this.collectNames(pkg.node.items, silent, imports);
    for (let [name, entry] of silent.names) {
      entries.set(name, entry);
    }
    for (let item of pkg.node.items) {
      if (item.kind !== "ExportDeclaration") {
        continue;
      }
      for (let exported of item.exports) {
        let sources = exported.packageName === "*" ? imports : [this.lowering.getPackage(exported.packageName)];
        for (let source of sources.filter(Boolean)) {
          for (let [name, entry] of this.packageEntries(source, visiting)) {
            if (exported.item === "*" || exported.item === name) {
              entries.set(name, entry);
            }
          }
        }
      }
    }
    this.packageCache.set(pkg, entries);
    return entries;
  }

  // ---- Declarations

  declare(scope, name, entry) {
    let existing = scope.names.get(name);
    if (existing?.isForward || entry.isForward) {
      scope.names.set(name, existing && entry.isForward ? existing : entry);
      return;
    }
    if (existing && !scope.quiet && (scope.strict || OWN_DUPLICATE_KINDS.has(entry.kind) || OWN_DUPLICATE_KINDS.has(existing.kind))) {
      this.error(`Duplicate declaration of '${name}'`, entry.span, "SEM-DUPLICATE-DECLARATION");
    }
    scope.names.set(name, entry);
  }
  declareItems(items, scope) {
    this.collectNames(items, scope, []);
    for (let [name, entry] of scope.names) {
      if (entry.isForward && !this.typeDeclaredElsewhere(name) && !this.classNames.has(name) && !this.isUnitType(name)) {
        this.error(`Forward typedef '${name}' is never defined`, entry.span, "SEM-UNKNOWN-TYPE");
      }
    }
  }
  isUnitType(name) {
    return this.unitScope?.names.has(name) && !this.unitScope.names.get(name).isForward;
  }
  collectNames(items, scope, imports) {
    for (let item of items ?? []) {
      if (!item) {
        continue;
      }
      switch (item.kind) {
        case "ImportDeclaration":
          for (let entry of item.imports) {
            let pkg = this.lowering.getPackage(entry.packageName);
            if (!pkg) {
              continue;
            }
            imports.push(pkg);
            if (entry.item === "*") {
              scope.wildcard.push(pkg);
            } else {
              scope.named.set(entry.item, pkg);
            }
          }
          break;
        case "TypedefDeclaration":
          this.declare(scope, item.name, { kind: "type", dataType: item.dataType, dims: item.dims, span: item.nameSpan });
          this.declareEnumMembers(item.dataType, scope);
          break;
        case "ClassDeclaration":
          this.declare(scope, item.name, { kind: "type", isClass: true, span: item.nameSpan });
          break;
        case "NamedRegion":
          this.declare(scope, item.name, {
            kind: NAMED_REGION_KINDS[item.regionKind] ?? "region",
            isForward: item.isForward,
            span: item.nameSpan,
          });
          break;
        case "TypeParameterDeclaration":
          this.declare(scope, item.name, { kind: "type", span: item.span });
          break;
        case "ParameterDeclaration":
          this.declareEnumMembers(item.dataType, scope);
          for (let parameter of item.parameters) {
            this.declare(scope, parameter.name, { kind: "param", span: parameter.span, dataType: item.dataType, valueExpr: parameter.valueExpr });
          }
          break;
        case "DataDeclaration":
        case "LocalVarDeclaration":
          this.declareEnumMembers(item.dataType, scope);
          for (let declarator of item.declarators) {
            this.declare(scope, declarator.name, {
              kind: "signal",
              dataType: item.dataType,
              dims: declarator.dims,
              span: declarator.nameSpan,
              isNet: item.netType !== undefined,
            });
          }
          break;
        case "PortDeclaration":
          this.declareEnumMembers(item.dataType, scope);
          for (let identifier of item.identifiers) {
            let previous = scope.names.get(identifier.name);
            scope.names.set(identifier.name, previous ?? {
              kind: "signal",
              dataType: item.dataType,
              dims: item.dimensions,
              span: identifier.span,
              direction: item.direction,
            });
          }
          break;
        case "FunctionDeclaration":
        case "TaskDeclaration":
          this.declare(scope, item.name, {
            kind: item.kind === "TaskDeclaration" ? "task" : "function",
            node: item,
            span: item.nameSpan ?? item.span,
          });
          break;
        case "InstanceDeclaration":
          this.declare(scope, item.instanceName, { kind: "instance", span: item.instanceNameSpan });
          break;
        case "GenvarDeclaration":
          for (let identifier of item.identifiers) {
            scope.names.set(identifier.name, { kind: "genvar", span: identifier.span });
          }
          break;
        case "GenerateBlock":
          this.collectNames(item.items, scope, imports);
          this.declareGenerateLabels(item.statements, scope);
          break;
        case "GenerateBlockStatement":
        case "GenerateIfStatement":
        case "GenerateCaseStatement":
        case "GenerateLoopStatement":
          this.declareGenerateLabels([item], scope);
          break;
      }
    }
  }
  // Alternative branches of one construct may reuse a label; separate constructs may not.
  declareGenerateLabels(items, scope) {
    for (let item of items ?? []) {
      if (!item) {
        continue;
      }
      let labels = new Set();
      this.collectBranchLabels(item, labels);
      for (let label of labels) {
        this.declare(scope, label, { kind: "block", span: item.span });
      }
    }
  }
  collectBranchLabels(item, labels) {
    if (!item) {
      return;
    }
    switch (item.kind) {
      case "GenerateBlockStatement":
        if (item.name) {
          labels.add(item.name);
        } else {
          // An unnamed `begin` is transparent for declarations that follow it.
          for (let child of item.statements ?? []) {
            this.collectBranchLabels(child, labels);
          }
        }
        break;
      case "GenerateIfStatement":
        this.collectBranchLabels(item.thenBlock, labels);
        this.collectBranchLabels(item.elseBlock, labels);
        break;
      case "GenerateCaseStatement":
        for (let entry of item.items) {
          this.collectBranchLabels(entry.body, labels);
        }
        break;
      case "GenerateLoopStatement":
        this.collectBranchLabels(item.body, labels);
        break;
    }
  }
  declareEnumMembers(dataType, scope) {
    if (!dataType) {
      return;
    }
    if (dataType.base === "enum") {
      for (let member of dataType.enumItems ?? []) {
        this.declare(scope, member.name, { kind: "enum", span: member.nameSpan });
      }
    } else if (dataType.base === "struct" || dataType.base === "union") {
      for (let member of dataType.members ?? []) {
        this.declareEnumMembers(member.dataType, scope);
      }
    }
  }

  // ---- Design units

  checkModule(node) {
    if (node.designUnit === "primitive") {
      return;
    }
    let scope = new NameScope(this.unitScope, this);
    this.declareItems(node.items, scope);
    this.checkPortList(node);
    this.checkItems(node.items, scope, { unit: node });
    if (node.designUnit === "module" || node.designUnit === "interface" || node.designUnit === "program") {
      new DriverCheck(this, node.items).run();
    }
  }
  checkPortList(node) {
    let listed = new Set(node.portNames ?? []);
    let declared = new Set();
    for (let item of node.items) {
      if (item?.kind !== "PortDeclaration") {
        continue;
      }
      for (let identifier of item.identifiers) {
        declared.add(identifier.name);
        if (!listed.has(identifier.name) && node.svPortExpressions !== true) {
          this.error(`Port '${identifier.name}' is not in the port list of '${node.name}'`, identifier.span, "SEM-PORT-NOT-IN-LIST");
        }
      }
    }
    let usesPortExpressions = node.svPortExpressions === true;
    if (!usesPortExpressions) {
      for (let name of listed) {
        if (!declared.has(name)) {
          this.error(`Port '${name}' has no direction declaration in '${node.name}'`, node.nameSpan, "SEM-PORT-NOT-DECLARED");
        }
      }
    }
  }
  checkItems(items, scope, ctx) {
    for (let item of items ?? []) {
      if (item) {
        this.checkItem(item, scope, ctx);
      }
    }
  }
  checkItem(item, scope, ctx) {
    switch (item.kind) {
      case "ImportDeclaration":
        this.checkImport(item);
        break;
      case "TypedefDeclaration":
        this.checkType(item.dataType, scope, ctx);
        this.checkDimensions(item.dims, scope, ctx);
        break;
      case "ParameterDeclaration":
        this.checkType(item.dataType, scope, ctx);
        for (let parameter of item.parameters) {
          this.checkDimensions(parameter.dims, scope, ctx);
          this.walk(parameter.valueExpr, scope, ctx);
          this.checkConstant(parameter.valueExpr, scope, "A parameter value");
        }
        break;
      case "TypeParameterDeclaration":
        this.checkType(item.defaultType, scope, ctx);
        break;
      case "DataDeclaration":
      case "LocalVarDeclaration":
        this.checkType(item.dataType, scope, ctx);
        for (let declarator of item.declarators) {
          this.checkDimensions(declarator.dims, scope, ctx);
          this.checkArrayPattern(declarator);
          this.walk(declarator.init, scope, ctx);
        }
        break;
      case "PortDeclaration":
        this.checkPortDeclaration(item, scope, ctx);
        break;
      case "ContinuousAssign":
        this.checkAssignTarget(item.lhs, item.rhs, scope);
        this.walk(item.lhs, scope, ctx);
        this.walk(item.rhs, scope, ctx);
        break;
      case "AlwaysBlock":
        this.checkAlways(item);
        this.walk(item.statement, scope, ctx);
        for (let entry of item.sensitivities ?? []) {
          this.checkEdge(entry, scope);
        }
        break;
      case "InitialBlock":
        this.walk(item.statement, scope, ctx);
        break;
      case "FunctionDeclaration":
      case "TaskDeclaration":
        this.checkSubroutine(item, scope, ctx);
        break;
      case "InstanceDeclaration":
        this.checkInstance(item, scope);
        break;
      case "ClassDeclaration":
        this.checkClassBase(item, scope);
        break;
      case "ModportDeclaration":
        this.checkModport(item, scope);
        break;
      case "GenerateBlock":
        this.checkItems(item.items, scope, ctx);
        this.checkGenerateList(item.statements, scope, ctx);
        break;
      case "GenerateBlockStatement":
      case "GenerateIfStatement":
      case "GenerateCaseStatement":
      case "GenerateLoopStatement":
        this.checkGenerate(item, scope, ctx);
        break;
    }
  }
  checkGenerateList(items, scope, ctx) {
    for (let item of items ?? []) {
      if (item) {
        this.checkGenerate(item, scope, ctx);
      }
    }
  }
  checkGenerate(item, scope, ctx) {
    switch (item.kind) {
      case "GenerateBlockStatement": {
        let inner = new NameScope(scope, this);
        this.declareItems(item.items, inner);
        this.declareGenerateLabels(item.statements, inner);
        this.checkItems(item.items, inner, ctx);
        this.checkGenerateList(item.statements, inner, ctx);
        break;
      }
      case "GenerateIfStatement":
        this.checkConstant(item.condition, scope, "A generate condition");
        this.checkGenerate(item.thenBlock, scope, ctx);
        if (item.elseBlock) {
          this.checkGenerate(item.elseBlock, scope, ctx);
        }
        break;
      case "GenerateCaseStatement":
        this.checkConstant(item.expression, scope, "A generate case expression");
        for (let entry of item.items) {
          this.checkGenerate(entry.body, scope, ctx);
        }
        break;
      case "GenerateLoopStatement": {
        let inner = new NameScope(scope, this);
        let loopVar = item.initExpr?.left ?? item.initExpr;
        if (loopVar?.kind === "Identifier") {
          if (item.declaresGenvar) {
            inner.names.set(loopVar.name, { kind: "genvar", span: loopVar.span });
          } else if (scope.lookup(loopVar.name)?.kind !== "genvar" && !this.open) {
            this.error(`Generate loop variable '${loopVar.name}' is not a genvar`, loopVar.span, "SEM-GENVAR");
          }
        }
        this.checkGenerate(item.body, inner, ctx);
        break;
      }
      default:
        this.checkItem(item, scope, ctx);
    }
  }
  checkImport(item) {
    for (let entry of item.imports) {
      if (entry.item === "*") {
        continue;
      }
      let pkg = this.lowering.getPackage(entry.packageName);
      if (pkg && !this.packageEntries(pkg).has(entry.item)) {
        this.error(`Package '${entry.packageName}' has no member '${entry.item}'`, entry.itemSpan ?? entry.packageSpan, "SEM-UNKNOWN-PACKAGE-MEMBER");
      }
    }
  }
  // `int a[2] = '{1, 2, 3}`: one positional item per element of the outermost dimension.
  checkArrayPattern(declarator) {
    let dim = declarator.dims?.[0];
    let pattern = declarator.init;
    if (!dim || pattern?.kind !== "AssignmentPattern" || pattern.items.some((item) => item.value === undefined || item.key || item.isDefault)) {
      return;
    }
    let size;
    if (dim.kind === "SizeDimension" && dim.size?.kind === "NumberLiteral") {
      size = dim.size.value;
    } else if (dim.kind === "Range" && dim.msb?.kind === "NumberLiteral" && dim.lsb?.kind === "NumberLiteral") {
      size = Math.abs(dim.msb.value - dim.lsb.value) + 1;
    }
    if (size !== undefined && pattern.items.length !== size) {
      this.error(`Array '${declarator.name}' has ${size} element(s) but the pattern gives ${pattern.items.length}`, pattern.span, "SEM-PATTERN-SIZE");
    }
  }
  checkPortDeclaration(item, scope, ctx) {
    if (item.interfaceRef && !item.interfaceRef.generic) {
      let definition = this.findDefinition(item.interfaceRef.name);
      if (definition && item.interfaceRef.modport) {
        let modports = this.modportsOf(definition);
        if (!modports.some((entry) => entry.name === item.interfaceRef.modport)) {
          this.error(`Interface '${item.interfaceRef.name}' has no modport '${item.interfaceRef.modport}'`, item.interfaceRef.span ?? item.span, "SEM-UNKNOWN-MODPORT");
        }
      } else if (!definition && !this.typeDeclaredElsewhere(item.interfaceRef.name)) {
        this.error(`Interface '${item.interfaceRef.name}' not found`, item.interfaceRef.span ?? item.span, "SEM-UNKNOWN-TYPE");
      }
      return;
    }
    this.checkType(item.dataType, scope, ctx);
    this.checkDimensions(item.dimensions, scope, ctx);
    this.walk(item.initExpr, scope, ctx);
  }
  modportsOf(definition) {
    return definition.svModports ?? (definition.items ?? []).filter((item) => item?.kind === "ModportDeclaration").flatMap((item) => item.modports);
  }
  checkModport(item, scope) {
    for (let modport of item.modports) {
      for (let port of modport.ports) {
        if (port.direction === "import" || port.direction === "export" || port.direction === "clocking" || port.isExpression) {
          continue;
        }
        if (!scope.lookup(port.name) && !this.open) {
          this.error(`Modport '${modport.name}' lists unknown signal '${port.name}'`, modport.nameSpan, "SEM-MODPORT-SIGNAL");
        }
      }
    }
  }
  checkClassBase(item, scope) {
    let base = item.baseName;
    if (base && !scope.lookup(base.text) && !this.classNames.has(base.text) && !this.typeDeclaredElsewhere(base.text)) {
      this.error(`Unknown base class '${base.text}'`, base.span, "SEM-UNKNOWN-TYPE");
    }
  }
  checkAlways(item) {
    if ((item.alwaysKind === "always_comb" || item.alwaysKind === "always_latch") && item.hasEventControl) {
      this.error(`${item.alwaysKind} must not have an event control`, item.span, "SEM-TIMING-CONTROL");
    }
    if (item.alwaysKind === "always_ff" && (item.sensitivities ?? []).length === 0 && !this.startsWithEvent(item.statement)) {
      this.error("always_ff must have an event control", item.span, "SEM-ALWAYS-FF-EVENT");
    }
    if (item.alwaysKind === "always_ff" || item.alwaysKind === "always_comb" || item.alwaysKind === "always_latch") {
      this.forbidTiming(item.statement, `${item.alwaysKind} must not contain blocking timing controls`);
    }
  }
  startsWithEvent(statement) {
    return statement?.kind === "BlockStatement" && statement.blockKind === "event";
  }
  forbidTiming(node, message, allowDetachedFork = false) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => this.forbidTiming(child, message, allowDetachedFork));
      return;
    }
    if (allowDetachedFork && node.kind === "BlockStatement" && node.joinKind === "join_none") {
      return;
    }
    if (node.kind === "EventControlStatement" || node.kind === "DelayStatement" || node.kind === "WaitStatement" ||
        (node.kind === "BlockStatement" && (node.blockKind === "event" || node.blockKind === "fork"))) {
      this.error(message, node.span, "SEM-TIMING-CONTROL");
      return;
    }
    for (let [key, value] of Object.entries(node)) {
      if (!GENERIC_WALK_SKIP.has(key) && value && typeof value === "object") {
        this.forbidTiming(value, message, allowDetachedFork);
      }
    }
  }
  checkEdge(entry, scope) {
    if (!entry.signal?.name || entry.edge === "all" || entry.edge === "none") {
      return;
    }
    let dataType = scope.lookup(entry.signal.name)?.dataType;
    if (dataType && REAL_TYPES.has(dataType.base)) {
      this.error(`An edge event cannot use real variable '${entry.signal.name}'`, entry.span, "SEM-REAL-EDGE");
    }
  }

  // ---- Types and constants

  checkType(dataType, scope, ctx) {
    if (!dataType || dataType.kind !== "DataType") {
      return;
    }
    this.checkDimensions(dataType.dims, scope, ctx);
    switch (dataType.base) {
      case "named":
        this.checkNamedType(dataType, scope);
        break;
      case "struct":
      case "union":
        this.checkStruct(dataType, scope, ctx);
        break;
      case "enum":
        this.checkType(dataType.enumBase, scope, ctx);
        this.checkEnum(dataType, scope);
        break;
    }
  }
  checkNamedType(dataType, scope) {
    if (dataType.scope) {
      this.checkScopeMember(dataType.scope, dataType.name, dataType.span, scope);
      return;
    }
    let entry = scope.lookup(dataType.name);
    if (entry || BUILTIN_TYPES.has(dataType.name) || this.classNames.has(dataType.name) || this.findDefinition(dataType.name)) {
      return;
    }
    if (!dataType.name.startsWith("`") && !this.typeDeclaredElsewhere(dataType.name)) {
      this.error(`Unknown type '${dataType.name}'`, dataType.span, "SEM-UNKNOWN-TYPE");
    }
  }
  typeDeclaredElsewhere(name) {
    return this.open || this.resolver?.workspaceDeclaresType?.(name, this.fileUri) === true;
  }
  checkScopeMember(scopeName, name, span, scope) {
    if (BUILTIN_SCOPES.has(scopeName) || scopeName.startsWith("`")) {
      return;
    }
    let pkg = this.lowering.getPackage(scopeName);
    if (pkg) {
      if (!this.packageEntries(pkg).has(name)) {
        this.error(`Package '${scopeName}' has no member '${name}'`, span, "SEM-UNKNOWN-PACKAGE-MEMBER");
      }
      return;
    }
    if (scope.lookup(scopeName) || this.classNames.has(scopeName) || BUILTIN_TYPES.has(scopeName)) {
      return;
    }
    if (!this.typeDeclaredElsewhere(scopeName)) {
      this.error(`Unknown package or class '${scopeName}'`, span, "SEM-UNKNOWN-PACKAGE");
    }
  }
  checkStruct(dataType, scope, ctx) {
    let names = new Set();
    for (let member of dataType.members ?? []) {
      this.checkType(member.dataType, scope, ctx);
      if (names.has(member.name)) {
        this.error(`Duplicate struct member '${member.name}'`, member.nameSpan ?? dataType.span, "SEM-DUPLICATE-MEMBER");
      }
      names.add(member.name);
      if (dataType.packed && member.init) {
        this.error("Members of a packed struct cannot have default values", member.nameSpan ?? dataType.span, "SEM-PACKED-MEMBER");
      }
      if (dataType.packed && member.dataType?.base === "string") {
        this.error("A packed struct cannot contain a string member", member.nameSpan ?? dataType.span, "SEM-PACKED-MEMBER");
      }
    }
  }
  checkEnum(dataType, scope) {
    let base = this.enumBaseInfo(dataType.enumBase, scope);
    let used = new Map();
    let next = 0n;
    let afterUnknown = false;
    for (let member of dataType.enumItems ?? []) {
      let literal = member.value ? this.literalOf(member.value) : undefined;
      if (member.value && !literal && this.containsUnknownBits(member.value)) {
        literal = { unknown: true };
      }
      if (member.value && !literal) {
        next = undefined;
        afterUnknown = false;
        continue;
      }
      if (literal?.unknown) {
        if (base.twoState) {
          this.error(`Enum member '${member.name}' uses x or z in a 2-state type`, member.nameSpan, "SEM-ENUM-VALUE");
        }
        afterUnknown = true;
        next = undefined;
        continue;
      }
      if (!member.value && afterUnknown) {
        this.error(`Enum member '${member.name}' needs an explicit value after an x or z member`, member.nameSpan, "SEM-ENUM-VALUE");
        afterUnknown = false;
        continue;
      }
      afterUnknown = false;
      let value = literal ? literal.value : next;
      if (value === undefined) {
        continue;
      }
      if (base.width !== undefined && value >= 1n << BigInt(base.width)) {
        this.error(`Enum member '${member.name}' does not fit in ${base.width} bits`, member.nameSpan, "SEM-ENUM-VALUE");
      }
      if (literal?.width !== undefined && base.width !== undefined && literal.width !== base.width) {
        this.error(`Enum member '${member.name}' has a ${literal.width}-bit value in a ${base.width}-bit enum`, member.nameSpan, "SEM-ENUM-VALUE");
      }
      if (used.has(value)) {
        this.error(`Enum member '${member.name}' repeats the value of '${used.get(value)}'`, member.nameSpan, "SEM-ENUM-VALUE");
      }
      used.set(value, member.name);
      next = value + 1n;
    }
  }
  enumBaseInfo(enumBase, scope) {
    if (!enumBase) {
      return { width: 32, twoState: true };
    }
    let dim = enumBase.dims?.[0];
    let width = ATOM_WIDTHS[enumBase.base];
    if (dim?.kind === "Range" && dim.msb?.kind === "NumberLiteral" && dim.lsb?.kind === "NumberLiteral") {
      width = Math.abs(dim.msb.value - dim.lsb.value) + 1;
    } else if (dim) {
      width = undefined;
    } else if (enumBase.base === "logic" || enumBase.base === "bit" || enumBase.base === "reg") {
      width = 1;
    }
    let resolved = enumBase.base === "named" ? scope.lookup(enumBase.name)?.dataType : undefined;
    return { width: enumBase.base === "named" ? undefined : width, twoState: TWO_STATE_TYPES.has(resolved?.base ?? enumBase.base) };
  }
  literalValue(expr, scope) {
    if (expr?.kind === "Identifier") {
      let entry = scope.lookup(expr.name);
      return entry?.kind === "param" ? this.literalOf(entry.valueExpr)?.value : undefined;
    }
    return this.literalOf(expr)?.value;
  }
  containsUnknownBits(expr) {
    if (!expr || typeof expr !== "object") {
      return false;
    }
    if (Array.isArray(expr)) {
      return expr.some((child) => this.containsUnknownBits(child));
    }
    if (expr.kind === "NumberLiteral") {
      return this.literalOf(expr)?.unknown === true;
    }
    return Object.entries(expr).some(([key, value]) => !GENERIC_WALK_SKIP.has(key) && this.containsUnknownBits(value));
  }
  // Parses a plain or based number literal; undefined for anything else.
  literalOf(expr) {
    if (expr?.kind !== "NumberLiteral") {
      return undefined;
    }
    let raw = String(expr.raw ?? expr.value).replace(/_/g, "");
    let based = /^(\d+)?'[sS]?([bBoOdDhH])(.+)$/.exec(raw);
    if (!based) {
      return /^\d+$/.test(raw) ? { value: BigInt(raw) } : undefined;
    }
    let width = based[1] ? Number(based[1]) : undefined;
    let digits = based[3];
    if (/[xXzZ?]/.test(digits)) {
      return { unknown: true, width };
    }
    let prefix = { b: "0b", o: "0o", d: "", h: "0x" }[based[2].toLowerCase()];
    try {
      return { value: BigInt(prefix + digits), width };
    } catch {
      return undefined;
    }
  }
  checkDimensions(dims, scope, ctx) {
    for (let dim of dims ?? []) {
      if (dim.kind === "Range") {
        this.checkBound(dim.msb, scope, ctx);
        this.checkBound(dim.lsb, scope, ctx);
      } else if (dim.kind === "SizeDimension") {
        // A bare type name here declares an associative array.
        if (dim.size?.kind !== "Identifier" || scope.lookup(dim.size.name)?.kind !== "type") {
          this.checkBound(dim.size, scope, ctx);
        }
      }
    }
  }
  checkBound(expr, scope, ctx) {
    this.walk(expr, scope, ctx);
    this.checkConstant(expr, scope, "A dimension bound");
    if (expr?.kind === "NumberLiteral" && /^\d*\.\d|^\d+[eE]/.test(String(expr.raw ?? ""))) {
      this.error("A dimension bound must be an integer", expr.span, "SEM-NOT-CONSTANT");
    }
  }
  checkConstant(expr, scope, what) {
    if (!expr || typeof expr !== "object") {
      return;
    }
    switch (expr.kind) {
      case "Identifier": {
        let kind = scope.lookup(expr.name)?.kind;
        if (kind === "signal") {
          this.error(`${what} must be constant, but '${expr.name}' is a variable`, expr.span, "SEM-NOT-CONSTANT");
        } else if (kind === "specparam" && what === "A parameter value") {
          this.error(`A parameter value cannot use specparam '${expr.name}'`, expr.span, "SEM-NOT-CONSTANT");
        }
        return;
      }
      case "BinaryExpression":
        this.checkConstant(expr.left, scope, what);
        this.checkConstant(expr.right, scope, what);
        return;
      case "UnaryExpression":
        this.checkConstant(expr.argument, scope, what);
        return;
      case "TernaryExpression":
        this.checkConstant(expr.condition, scope, what);
        this.checkConstant(expr.trueExpr, scope, what);
        this.checkConstant(expr.falseExpr, scope, what);
        return;
      case "SystemFunctionCall":
        if (!CONSTANT_QUERY_FUNCTIONS.has(expr.name)) {
          expr.args?.forEach((arg) => this.checkConstant(arg, scope, what));
        }
        return;
    }
  }

  // ---- Statements and expressions

  walk(node, scope, ctx) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => this.walk(child, scope, ctx));
      return;
    }
    switch (node.kind) {
      case "BlockStatement":
        this.walkBlock(node, scope, ctx);
        return;
      case "LoopStatement":
        this.walkLoop(node, scope, ctx);
        return;
      case "ForeachStatement": {
        let inner = new NameScope(scope, this);
        for (let loopVar of node.loopVars ?? []) {
          if (loopVar) {
            inner.names.set(loopVar.name, { kind: "signal", span: loopVar.span });
          }
        }
        this.walk(node.array, scope, ctx);
        this.walk(node.body, inner, { ...ctx, inLoop: true });
        return;
      }
      case "ReturnStatement":
        this.checkReturn(node, ctx);
        this.walk(node.value, scope, ctx);
        return;
      case "JumpStatement":
        if (!ctx.inLoop) {
          this.error(`'${node.jump}' must be inside a loop`, node.span, "SEM-JUMP");
        }
        return;
      case "CaseStatement":
        this.checkCase(node);
        break;
      case "BlockingAssign":
      case "NonBlockingAssign":
        this.checkAssignTarget(node.lhs, node.rhs, scope);
        break;
      case "LocalVarDeclaration":
      case "LocalItemStatement": {
        let item = node.kind === "LocalItemStatement" ? node.item : node;
        if (Array.isArray(item)) {
          item.forEach((entry) => this.checkItem(entry, scope, ctx));
        } else if (item) {
          this.checkItem(item, scope, ctx);
        }
        return;
      }
      case "DataType":
        this.checkType(node, scope, ctx);
        return;
      case "ScopedIdentifier":
        this.checkScopeMember(node.scope, node.name, node.span, scope);
        return;
      case "FunctionCall":
      case "TaskCallStatement":
        this.checkCall(node, scope, ctx);
        this.walk(node.args, scope, ctx);
        if (node.target && node.target.kind === "MemberSelect") {
          this.walk(node.target.target, scope, ctx);
        }
        return;
      case "Identifier":
        if (ctx.reportUndeclared && !node.name.startsWith("`") && !scope.lookup(node.name) && !this.open) {
          this.error(`Undeclared identifier '${node.name}'`, node.span, "SEM-UNDECLARED-IDENTIFIER");
        }
        return;
      case "MemberSelect":
        this.walk(node.target, scope, ctx);
        return;
      case "BitSelect":
      case "PartSelect":
      case "IndexedPartSelect":
        this.checkRealSelect(node, scope);
        break;
      case "CastExpression":
        if (node.dataType?.base !== "castTarget") {
          this.checkType(node.dataType, scope, ctx);
        }
        this.walk(node.expression, scope, ctx);
        return;
    }
    for (let [key, value] of Object.entries(node)) {
      if (!GENERIC_WALK_SKIP.has(key) && value && typeof value === "object") {
        this.walk(value, scope, ctx);
      }
    }
  }
  walkBlock(node, scope, ctx) {
    let inner = new NameScope(scope, this);
    for (let statement of node.statements ?? []) {
      if (statement?.kind === "LocalVarDeclaration") {
        this.declareItems([statement], inner);
      } else if (statement?.kind === "LocalItemStatement") {
        this.declareItems(Array.isArray(statement.item) ? statement.item : [statement.item], inner);
      }
    }
    let childCtx = node.blockKind === "fork" ? { ...ctx, inLoop: false, inFork: true } : ctx;
    this.walk(node.statements, inner, childCtx);
  }
  walkLoop(node, scope, ctx) {
    let inner = new NameScope(scope, this);
    for (let local of node.localVars ?? []) {
      inner.names.set(local.name, { kind: "signal", dataType: local.dataType, span: local.nameSpan });
    }
    for (let [key, value] of Object.entries(node)) {
      if (GENERIC_WALK_SKIP.has(key) || key === "localVars" || !value || typeof value !== "object") {
        continue;
      }
      this.walk(value, inner, key === "body" ? { ...ctx, inLoop: true } : ctx);
    }
  }
  checkReturn(node, ctx) {
    if (ctx.inFork) {
      this.error("'return' cannot leave a fork-join block", node.span, "SEM-RETURN");
    } else if (!ctx.subroutine) {
      this.error("'return' must be inside a task or function", node.span, "SEM-RETURN");
    } else if (node.value && (ctx.subroutine.kind === "TaskDeclaration" || ctx.subroutine.returnDataType?.base === "void")) {
      this.error("A void function or task cannot return a value", node.span, "SEM-RETURN");
    }
  }
  checkCase(node) {
    let defaults = (node.items ?? []).filter((item) => item.isDefault);
    if (defaults.length > 1) {
      this.error("A case statement can have only one default item", defaults[1].span, "SEM-CASE-DEFAULT");
    }
  }
  baseIdentifier(expr) {
    let current = expr;
    for (; current && (current.kind === "BitSelect" || current.kind === "PartSelect" || current.kind === "IndexedPartSelect");) {
      current = current.target;
    }
    return current?.kind === "Identifier" ? current : undefined;
  }
  checkAssignTarget(lhs, rhs, scope) {
    if (lhs?.kind === "Concatenation") {
      for (let element of lhs.elements ?? []) {
        this.checkAssignTarget(element, undefined, scope);
      }
      return;
    }
    let base = this.baseIdentifier(lhs);
    if (!base) {
      return;
    }
    let entry = scope.lookup(base.name);
    if (entry?.kind === "param" || entry?.kind === "enum") {
      this.error(`Cannot assign to ${entry.kind === "enum" ? "enum member" : "parameter"} '${base.name}'`, base.span, "SEM-ASSIGN-CONSTANT");
    } else if (entry?.kind === "signal" && lhs === base && rhs && this.isEnumEntry(entry, scope) && this.isBareNumber(rhs)) {
      this.error(`Assigning a number to enum variable '${base.name}' needs a cast`, rhs.span, "SEM-ENUM-ASSIGN");
    }
  }
  isBareNumber(expr) {
    return expr.kind === "NumberLiteral" || (expr.kind === "BinaryExpression" && (this.isEnumArithmetic(expr)));
  }
  isEnumArithmetic(expr) {
    return ["+", "-", "*", "/"].includes(expr.operator) && (expr.left?.kind === "NumberLiteral" || expr.right?.kind === "NumberLiteral");
  }
  isEnumEntry(entry, scope) {
    let dataType = entry.dataType;
    for (let hops = 0; dataType && hops < 16; hops++) {
      if (dataType.base === "enum") {
        return !(entry.dims?.length > 0);
      }
      if (dataType.base !== "named" || dataType.scope) {
        return false;
      }
      dataType = scope.lookup(dataType.name)?.dataType;
    }
    return false;
  }
  checkRealSelect(node, scope) {
    if (node.kind === "BitSelect" && node.index?.kind === "Identifier") {
      let index = scope.lookup(node.index.name);
      if (index?.kind === "signal" && REAL_TYPES.has(index.dataType?.base)) {
        this.error(`Real variable '${node.index.name}' cannot be used as a bit-select index`, node.index.span, "SEM-REAL-SELECT");
      }
    }
    if (node.kind === "IndexedPartSelect" && this.literalValue(node.width, scope) === 0n) {
      this.error("A part-select width must be positive", node.span, "SEM-PART-SELECT");
    }
    let base = this.baseIdentifier(node.target);
    let entry = base ? scope.lookup(base.name) : undefined;
    if (entry?.kind === "signal" && REAL_TYPES.has(entry.dataType?.base) && !(entry.dims?.length > 0)) {
      this.error(`Real variable '${base.name}' cannot be bit- or part-selected`, node.span, "SEM-REAL-SELECT");
    }
  }

  // ---- Calls

  checkSubroutine(item, scope, ctx) {
    this.checkType(item.returnDataType, scope, ctx);
    let inner = new NameScope(scope, this);
    this.declareItems(item.ports, inner);
    inner.names.set(item.name, { kind: "signal", dataType: item.returnDataType, span: item.nameSpan ?? item.span });
    for (let port of item.ports ?? []) {
      this.checkType(port.dataType, inner, ctx);
    }
    for (let statement of item.statements ?? []) {
      if (statement?.kind === "LocalVarDeclaration") {
        this.declareItems([statement], inner);
      } else if (statement?.kind === "LocalItemStatement") {
        this.declareItems(Array.isArray(statement.item) ? statement.item : [statement.item], inner);
      }
    }
    let bodyCtx = { ...ctx, subroutine: item, inLoop: false, inFork: false };
    this.walk(item.statements, inner, bodyCtx);
    if (item.kind === "FunctionDeclaration") {
      this.forbidTiming(item.statements, "A function must not contain timing controls", true);
    }
  }
  checkCall(node, scope, ctx) {
    if (node.scope) {
      this.checkScopeMember(node.scope, node.name, node.span, scope);
      let pkg = this.lowering.getPackage(node.scope);
      let entry = pkg ? this.packageEntries(pkg).get(node.name) : undefined;
      if (entry?.node) {
        this.checkArguments(node, entry.node);
      }
      return;
    }
    if (node.target && node.target.kind !== "Identifier") {
      return;
    }
    if (node.name === undefined || node.name.startsWith("`") || node.name.startsWith("$") || node.name === "<call>" || BUILTIN_CALLS.has(node.name)) {
      return;
    }
    let entry = scope.lookup(node.name);
    if (!entry) {
      if (!this.open && !this.findDefinition(node.name) && !this.typeDeclaredElsewhere(node.name)) {
        this.error(`Undeclared task or function '${node.name}'`, node.span, "SEM-UNDECLARED-SUBROUTINE");
      }
      return;
    }
    if (entry.kind === "task" && ctx.subroutine?.kind === "FunctionDeclaration" && !ctx.inFork) {
      this.error(`Function '${ctx.subroutine.name}' cannot call task '${node.name}'`, node.span, "SEM-TASK-IN-FUNCTION");
    }
    if (entry.node) {
      this.checkArguments(node, entry.node);
    }
  }
  checkArguments(call, declaration) {
    let formals = (declaration.ports ?? []).flatMap((port) =>
      port.identifiers.map((identifier) => ({ name: identifier.name, hasDefault: port.hasDefault === true })),
    );
    let names = new Set(formals.map((formal) => formal.name));
    let args = call.args ?? [];
    let namedArgs = args.filter((arg) => arg?.svArgName);
    let positional = args.length - namedArgs.length + (args.svSkipped ?? 0);
    if (positional > formals.length) {
      this.error(`'${declaration.name}' takes ${formals.length} argument(s) but is given ${positional}`, call.span, "SEM-CALL-ARGUMENTS");
      return;
    }
    let supplied = new Set(formals.slice(0, positional).map((formal) => formal.name));
    for (let name of args.svNames ?? []) {
      if (!names.has(name)) {
        this.error(`'${declaration.name}' has no argument named '${name}'`, call.span, "SEM-CALL-ARGUMENTS");
        return;
      }
      if (supplied.has(name)) {
        this.error(`Argument '${name}' of '${declaration.name}' is given twice`, call.span, "SEM-CALL-ARGUMENTS");
        return;
      }
      supplied.add(name);
    }
    let missing = formals.find((formal) => !supplied.has(formal.name) && !formal.hasDefault);
    if (missing) {
      this.error(`Missing argument '${missing.name}' in call to '${declaration.name}'`, call.span, "SEM-CALL-ARGUMENTS");
    }
  }

  // ---- Instances

  findDefinition(name) {
    let local = this.rawModules.get(name);
    if (local) {
      return local;
    }
    let found = this.resolver?.resolveModule(name, this.fileUri);
    return found?.found ? found.moduleNode : undefined;
  }
  portsOf(definition) {
    let names = [];
    let add = (name) => {
      let base = name.split(".")[0];
      if (!names.includes(base)) {
        names.push(base);
      }
    };
    (definition.portNames ?? []).forEach(add);
    if (names.length === 0) {
      for (let item of definition.items ?? []) {
        if (item?.kind === "PortDeclaration") {
          item.identifiers.forEach((identifier) => add(identifier.name));
        }
      }
    }
    return names;
  }
  portHasDefault(definition, name) {
    return (definition.items ?? []).some(
      (item) => item?.kind === "PortDeclaration" && item.initExpr && item.identifiers.some((identifier) => identifier.name === name),
    );
  }
  checkInstance(item, scope) {
    let definition = this.findDefinition(item.moduleName);
    if (!definition) {
      return;
    }
    if (definition.designUnit !== "primitive") {
      this.checkConnections(item, definition, scope);
    }
    this.checkOverrides(item, definition);
  }
  checkConnections(item, definition, scope) {
    let ports = this.portsOf(definition);
    let connected = new Set();
    let positional = 0;
    for (let connection of item.portConnections) {
      if (connection.kind === "WildcardPortConnection") {
        continue;
      }
      if (connection.portName.startsWith("__pos_")) {
        positional++;
        continue;
      }
      if (!ports.includes(connection.portName)) {
        this.error(`Module '${item.moduleName}' has no port '${connection.portName}'`, connection.portNameSpan ?? connection.span, "SEM-UNKNOWN-PORT");
      } else if (connected.has(connection.portName)) {
        this.error(`Port '${connection.portName}' is connected twice`, connection.portNameSpan ?? connection.span, "SEM-DUPLICATE-CONNECTION");
      } else if (connection.implicit && !scope.lookup(connection.portName) && !this.open) {
        this.error(`Implicit connection '.${connection.portName}' has no matching declaration`, connection.span, "SEM-IMPLICIT-CONNECTION");
      }
      connected.add(connection.portName);
    }
    if (positional > ports.length) {
      this.error(`Module '${item.moduleName}' has ${ports.length} port(s) but ${positional} are connected`, item.instanceNameSpan, "SEM-TOO-MANY-CONNECTIONS");
    }
    if (item.portConnections.some((connection) => connection.kind === "WildcardPortConnection") && !this.open) {
      for (let port of ports) {
        if (!connected.has(port) && !scope.lookup(port) && !this.portHasDefault(definition, port)) {
          this.error(`'.*' finds no declaration for port '${port}' of '${item.moduleName}'`, item.instanceNameSpan, "SEM-IMPLICIT-CONNECTION");
        }
      }
    }
  }
  checkOverrides(item, definition) {
    let overrides = item.parameterOverrides ?? [];
    // Type parameters do not survive lowering, so only same-file definitions can be judged.
    if (overrides.length === 0 || this.rawModules.get(item.moduleName) !== definition) {
      return;
    }
    let names = new Set();
    let open = [];
    for (let entry of definition.items ?? []) {
      if (entry?.kind === "TypeParameterDeclaration") {
        names.add(entry.name);
        if (!entry.isLocal) {
          open.push(entry.name);
        }
      } else if (entry?.kind === "ParameterDeclaration") {
        for (let parameter of entry.parameters) {
          names.add(parameter.name);
          if (!entry.isLocal) {
            open.push(parameter.name);
          }
        }
      }
    }
    let positional = 0;
    for (let override of overrides) {
      if (override.name === undefined) {
        positional++;
      } else if (!names.has(override.name)) {
        this.error(`Module '${item.moduleName}' has no parameter '${override.name}'`, item.moduleNameSpan, "SEM-UNKNOWN-PARAMETER");
      }
    }
    if (positional > open.length) {
      this.error(`Module '${item.moduleName}' has ${open.length} parameter(s) but ${positional} are given`, item.moduleNameSpan, "SEM-UNKNOWN-PARAMETER");
    }
  }
}

// IEEE 1800 6.5 and 9.2.2: who may write a variable.
class DriverCheck {
  drivers = new Map();
  variables = new Set();
  constructor(checker, items) {
    this.checker = checker;
    this.items = items;
  }
  run() {
    for (let item of this.items) {
      if (item?.kind === "DataDeclaration" && item.netType === undefined) {
        item.declarators.forEach((declarator) => {
          this.variables.add(declarator.name);
          if (declarator.init) {
            this.add(declarator.name, "initializer", declarator.nameSpan, "initializer");
          }
        });
      } else if (item?.kind === "PortDeclaration" && this.isVariablePort(item)) {
        item.identifiers.forEach((identifier) => this.variables.add(identifier.name));
      }
    }
    let processId = 0;
    for (let item of this.items) {
      if (item?.kind === "ContinuousAssign") {
        this.targets(item.lhs).forEach((target) => this.add(target.name, "assign", target.span, `assign${processId++}`));
      } else if (item?.kind === "AlwaysBlock") {
        let id = `always${processId++}`;
        let kind = item.alwaysKind === "always" ? "always" : item.alwaysKind;
        this.collect(item.statement, new Set()).forEach((target) => this.add(target.name, kind, target.span, id));
      }
    }
    for (let [name, writes] of this.drivers) {
      if (this.variables.has(name)) {
        this.judge(name, writes);
      }
    }
  }
  isVariablePort(item) {
    if (item.direction === "input" || !item.dataType || NET_KEYWORDS.has(item.netType)) {
      return false;
    }
    return item.dataType.base !== "implicit" && item.dataType.base !== "named";
  }
  add(name, kind, span, process) {
    let list = this.drivers.get(name) ?? [];
    list.push({ kind, span, process });
    this.drivers.set(name, list);
  }
  judge(name, writes) {
    let assigns = writes.filter((write) => write.kind === "assign");
    let processes = new Set(writes.filter((write) => write.kind !== "initializer" && write.kind !== "assign").map((write) => write.process));
    let initializer = writes.find((write) => write.kind === "initializer");
    if (assigns.length > 1) {
      this.checker.error(`Variable '${name}' has more than one continuous assignment`, assigns[1].span, "SEM-MULTIPLE-DRIVERS");
    } else if (assigns.length === 1 && (processes.size > 0 || initializer)) {
      this.checker.error(`Variable '${name}' cannot have both a continuous and a procedural assignment`, assigns[0].span, "SEM-MULTIPLE-DRIVERS");
    } else if (processes.size > 1) {
      let strict = writes.find((write) => write.kind === "always_ff" || write.kind === "always_comb" || write.kind === "always_latch");
      if (strict) {
        let other = writes.find((write) => write.process !== strict.process && write.kind !== "initializer");
        this.checker.error(`Variable '${name}' is written by ${strict.kind} and must not be written by another process`, other.span, "SEM-MULTIPLE-DRIVERS");
      }
    }
  }
  // Whole-variable targets only: separate bits may legally come from separate drivers.
  targets(lhs) {
    if (lhs?.kind === "Identifier") {
      return [lhs];
    }
    if (lhs?.kind === "Concatenation") {
      return (lhs.elements ?? []).flatMap((element) => this.targets(element));
    }
    return [];
  }
  collect(node, locals, out = []) {
    if (!node || typeof node !== "object") {
      return out;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => this.collect(child, locals, out));
      return out;
    }
    if (node.kind === "LocalVarDeclaration") {
      node.declarators.forEach((declarator) => locals.add(declarator.name));
      return out;
    }
    if (node.kind === "LoopStatement") {
      (node.localVars ?? []).forEach((local) => locals.add(local.name));
    }
    if (node.kind === "BlockingAssign" || node.kind === "NonBlockingAssign") {
      out.push(...this.targets(node.lhs).filter((target) => !locals.has(target.name)));
      return out;
    }
    for (let [key, value] of Object.entries(node)) {
      if (!GENERIC_WALK_SKIP.has(key) && value && typeof value === "object") {
        this.collect(value, locals, out);
      }
    }
    return out;
  }
}
