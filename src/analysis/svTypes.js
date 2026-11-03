// Scopes, data-type layout and constant evaluation for SystemVerilog lowering.

const ATOM_WIDTHS = {
  logic: 1, reg: 1, bit: 1, implicit: 1,
  byte: 8, shortint: 16, int: 32, longint: 64, integer: 32, time: 64,
  real: 64, realtime: 64, shortreal: 32,
};

export class SvScope {
  parent;
  types = new Map();
  values = new Map();
  signals = new Map();
  namedImports = new Map();
  wildcardImports = [];
  constructor(parent) {
    this.parent = parent;
  }
  // Finds a value or signal, innermost scope first; imports rank below local names.
  lookup(name) {
    for (let scope = this; scope; scope = scope.parent) {
      let signal = scope.signals.get(name);
      if (signal) {
        return { kind: "signal", entry: signal };
      }
      let value = scope.values.get(name);
      if (value) {
        return { kind: "value", entry: value };
      }
      let imported = scope.namedImports.get(name);
      if (imported?.values.has(name)) {
        return { kind: "value", entry: imported.values.get(name) };
      }
      for (let pkg of scope.wildcardImports) {
        let hit = pkg.lookupExported(name, "values");
        if (hit) {
          return { kind: "value", entry: hit };
        }
      }
    }
    return undefined;
  }
  lookupType(name) {
    for (let scope = this; scope; scope = scope.parent) {
      if (scope.types.has(name)) {
        return scope.types.get(name);
      }
      let imported = scope.namedImports.get(name);
      if (imported?.types.has(name)) {
        return imported.types.get(name);
      }
      for (let pkg of scope.wildcardImports) {
        let hit = pkg.lookupExported(name, "types");
        if (hit) {
          return hit;
        }
      }
    }
    return undefined;
  }
  lookupExported(name, table) {
    return this[table].get(name);
  }
}

function clog2(value) {
  if (value <= 1) {
    return 0;
  }
  let result = 0;
  let current = value - 1;
  for (; current >= 1; current = Math.floor(current / 2)) {
    result++;
  }
  return result;
}

function bitwise(operator, left, right) {
  let a = BigInt(Math.trunc(left));
  let b = BigInt(Math.trunc(right));
  let result = operator === "&" ? a & b : operator === "|" ? a | b : a ^ b;
  return Number(result);
}

export function evalConst(expr, scope) {
  if (!expr) {
    return undefined;
  }
  switch (expr.kind) {
    case "NumberLiteral":
      return typeof expr.value === "number" && !Number.isNaN(expr.value) ? expr.value : undefined;
    case "Identifier": {
      let hit = scope.lookup(expr.name);
      return hit?.kind === "value" ? hit.entry.value : undefined;
    }
    case "ScopedIdentifier":
      return scope.packageResolver?.(expr.scope)?.values.get(expr.name)?.value ?? lookupPackageValue(expr, scope);
    case "CastExpression":
      return evalConst(expr.expression, scope);
    case "UnaryExpression": {
      let value = evalConst(expr.argument, scope);
      if (value === undefined) {
        return undefined;
      }
      switch (expr.operator) {
        case "+":
          return value;
        case "-":
          return -value;
        case "!":
          return value ? 0 : 1;
        case "~":
          return ~value;
        default:
          return undefined;
      }
    }
    case "BinaryExpression": {
      let left = evalConst(expr.left, scope);
      let right = evalConst(expr.right, scope);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      switch (expr.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right !== 0 ? Math.trunc(left / right) : undefined;
        case "%":
          return right !== 0 ? left % right : undefined;
        case "**":
          return Math.pow(left, right);
        case "<<":
        case "<<<":
          return left * Math.pow(2, right);
        case ">>":
        case ">>>":
          return Math.floor(left / Math.pow(2, right));
        case "&":
        case "|":
        case "^":
          return bitwise(expr.operator, left, right);
        case "==":
        case "===":
          return left === right ? 1 : 0;
        case "!=":
        case "!==":
          return left !== right ? 1 : 0;
        case "<":
          return left < right ? 1 : 0;
        case "<=":
          return left <= right ? 1 : 0;
        case ">":
          return left > right ? 1 : 0;
        case ">=":
          return left >= right ? 1 : 0;
        case "&&":
          return left && right ? 1 : 0;
        case "||":
          return left || right ? 1 : 0;
        default:
          return undefined;
      }
    }
    case "TernaryExpression": {
      let condition = evalConst(expr.condition, scope);
      if (condition === undefined) {
        return undefined;
      }
      return evalConst(condition ? expr.trueExpr : expr.falseExpr, scope);
    }
    case "SystemFunctionCall":
      if (expr.name === "$clog2" && expr.args.length === 1) {
        let value = evalConst(expr.args[0], scope);
        return value === undefined ? undefined : clog2(value);
      }
      if (expr.name === "$bits" && expr.args.length === 1) {
        return widthOfArgument(expr.args[0], scope);
      }
      return undefined;
    default:
      return undefined;
  }
}

function lookupPackageValue(expr, scope) {
  for (let current = scope; current; current = current.parent) {
    let pkg = current.findPackage?.(expr.scope);
    if (pkg) {
      return pkg.values.get(expr.name)?.value;
    }
  }
  return undefined;
}

function widthOfArgument(arg, scope) {
  if (arg.kind === "DataType") {
    return resolveType(arg, scope)?.width;
  }
  if (arg.kind === "Identifier") {
    let type = scope.lookupType(arg.name);
    if (type) {
      return type.width;
    }
  }
  return typeOf(arg, scope)?.width;
}

function dimensionInfo(dim, scope) {
  if (dim.kind === "Range") {
    let msb = evalConst(dim.msb, scope);
    let lsb = evalConst(dim.lsb, scope);
    if (msb === undefined || lsb === undefined) {
      return { count: undefined };
    }
    return { count: Math.abs(msb - lsb) + 1, msb, lsb };
  }
  if (dim.kind === "SizeDimension") {
    let size = evalConst(dim.size, scope);
    return size === undefined ? { count: undefined } : { count: size, msb: size - 1, lsb: 0 };
  }
  return { count: undefined, dynamic: true };
}

// A layout: `width` is the packed width; `packed`/`unpacked` are the indexable dimensions outermost first.
function makeLayout(elementWidth, packed, unpacked, extra) {
  let width = elementWidth;
  for (let dim of packed) {
    width = width === undefined || dim.count === undefined ? undefined : width * dim.count;
  }
  return { elementWidth, width, packed, unpacked, ...extra };
}

function layoutStruct(dataType, scope) {
  let members = new Map();
  let laidOut = dataType.members.map((member) => {
    let layout = resolveType(member.dataType, scope, member.dims);
    return { name: member.name, layout };
  });
  let isUnion = dataType.base === "union";
  let total = 0;
  for (let member of laidOut) {
    let width = member.layout?.width;
    if (width === undefined) {
      total = undefined;
      break;
    }
    total = isUnion ? Math.max(total, width) : total + width;
  }
  if (total !== undefined) {
    let offset = 0;
    for (let index = laidOut.length - 1; index >= 0; index--) {
      let member = laidOut[index];
      members.set(member.name, { offset: isUnion ? 0 : offset, layout: member.layout });
      if (!isUnion) {
        offset += member.layout.width;
      }
    }
  } else {
    for (let member of laidOut) {
      members.set(member.name, { layout: member.layout });
    }
  }
  return { width: total, members };
}

export function registerEnumValues(dataType, scope, target, describe) {
  let next = 0;
  let width = dataType.enumBase ? (resolveType(dataType.enumBase, scope)?.width ?? 32) : 32;
  for (let item of dataType.enumItems) {
    let value = item.value ? evalConst(item.value, scope) : next;
    target.set(item.name, describe(item, value, width));
    next = value === undefined ? undefined : value + 1;
  }
}

export function resolveType(dataType, scope, declaratorDims = []) {
  if (!dataType) {
    return undefined;
  }
  let packed = (dataType.dims ?? []).map((dim) => dimensionInfo(dim, scope));
  let unpacked = declaratorDims.map((dim) => dimensionInfo(dim, scope));
  switch (dataType.base) {
    case "struct":
    case "union": {
      let { width, members } = layoutStruct(dataType, scope);
      return makeLayout(width, packed, unpacked, { members, typeName: dataType.base });
    }
    case "enum": {
      let width = dataType.enumBase ? (resolveType(dataType.enumBase, scope)?.width ?? 32) : 32;
      return makeLayout(width, packed, unpacked, { typeName: "enum" });
    }
    case "named": {
      let named = dataType.scope
        ? findPackage(scope, dataType.scope)?.types.get(dataType.name)
        : scope.lookupType(dataType.name);
      if (!named) {
        return makeLayout(undefined, packed, unpacked, { typeName: dataType.name, unresolved: true });
      }
      return {
        ...named,
        ...makeLayout(named.elementWidth, [...packed, ...named.packed], [...unpacked, ...named.unpacked], {
          typeName: dataType.name,
        }),
        members: named.members,
      };
    }
    case "typeof": {
      let source = dataType.typeofExpr;
      let layout = source?.kind === "DataType" ? resolveType(source, scope) : typeOf(source, scope);
      return layout ?? makeLayout(undefined, packed, unpacked, { unresolved: true });
    }
    default: {
      let atom = ATOM_WIDTHS[dataType.base];
      return makeLayout(atom, packed, unpacked, { typeName: dataType.base, unresolved: atom === undefined });
    }
  }
}

export function findPackage(scope, name) {
  for (let current = scope; current; current = current.parent) {
    let pkg = current.findPackage?.(name);
    if (pkg) {
      return pkg;
    }
  }
  return undefined;
}

// Drops the outermost dimension: what `value[i]` has as a layout.
export function indexLayout(layout) {
  if (!layout) {
    return undefined;
  }
  if (layout.unpacked.length > 0) {
    return { ...layout, unpacked: layout.unpacked.slice(1) };
  }
  if (layout.packed.length > 0) {
    return makeLayout(layout.elementWidth, layout.packed.slice(1), [], { members: layout.members, typeName: layout.typeName });
  }
  return makeLayout(1, [], [], {});
}

export function typeOf(expr, scope) {
  if (!expr) {
    return undefined;
  }
  switch (expr.kind) {
    case "Identifier": {
      let hit = scope.lookup(expr.name);
      if (hit?.kind === "signal") {
        return hit.entry.layout;
      }
      if (hit?.kind === "value") {
        return makeLayout(hit.entry.width, [], [], {});
      }
      return undefined;
    }
    case "ScopedIdentifier": {
      let value = findPackage(scope, expr.scope)?.values.get(expr.name);
      return value ? makeLayout(value.width, [], [], {}) : undefined;
    }
    case "MemberSelect": {
      let target = typeOf(expr.target, scope);
      return target?.members?.get(expr.member)?.layout;
    }
    case "BitSelect":
      return indexLayout(typeOf(expr.target, scope));
    case "PartSelect": {
      let msb = evalConst(expr.msb, scope);
      let lsb = evalConst(expr.lsb, scope);
      return msb === undefined || lsb === undefined ? undefined : makeLayout(Math.abs(msb - lsb) + 1, [], [], {});
    }
    case "IndexedPartSelect": {
      let width = evalConst(expr.width, scope);
      return width === undefined ? undefined : makeLayout(width, [], [], {});
    }
    case "NumberLiteral":
      return expr.bitWidth !== undefined ? makeLayout(expr.bitWidth, [], [], {}) : undefined;
    case "CastExpression":
      return castLayout(expr, scope) ?? typeOf(expr.expression, scope);
    case "TernaryExpression":
      return typeOf(expr.trueExpr, scope) ?? typeOf(expr.falseExpr, scope);
    case "BinaryExpression": {
      if (["==", "!=", "===", "!==", "==?", "!=?", "<", "<=", ">", ">=", "&&", "||", "->", "<->"].includes(expr.operator)) {
        return makeLayout(1, [], [], {});
      }
      let left = typeOf(expr.left, scope)?.width;
      if (["<<", ">>", "<<<", ">>>"].includes(expr.operator)) {
        return left === undefined ? undefined : makeLayout(left, [], [], {});
      }
      let right = typeOf(expr.right, scope)?.width;
      return left === undefined && right === undefined ? undefined : makeLayout(Math.max(left ?? 0, right ?? 0), [], [], {});
    }
    case "UnaryExpression":
      if (["!", "&", "~&", "|", "~|", "^", "~^", "^~"].includes(expr.operator)) {
        return makeLayout(1, [], [], {});
      }
      return typeOf(expr.argument, scope);
    case "Concatenation": {
      let total = 0;
      for (let element of expr.elements) {
        let width = typeOf(element, scope)?.width;
        if (width === undefined) {
          return undefined;
        }
        total += width;
      }
      return makeLayout(total, [], [], {});
    }
    case "AssignmentPattern":
      return expr.dataType ? resolveType(expr.dataType, scope) : undefined;
    default:
      return undefined;
  }
}

export function castLayout(expr, scope) {
  let dataType = expr.dataType;
  if (dataType.base === "castTarget") {
    let target = dataType.target;
    let size = evalConst(target, scope);
    if (size !== undefined) {
      return makeLayout(size, [], [], {});
    }
    if (target.kind === "Identifier") {
      return scope.lookupType(target.name);
    }
    if (target.kind === "ScopedIdentifier") {
      return findPackage(scope, target.scope)?.types.get(target.name);
    }
    return undefined;
  }
  if (dataType.base === "qualifier") {
    return undefined;
  }
  return resolveType(dataType, scope);
}

export function describeType(dataType) {
  if (!dataType) {
    return undefined;
  }
  if (dataType.base === "named") {
    return dataType.scope ? `${dataType.scope}::${dataType.name}` : dataType.name;
  }
  if (dataType.base === "implicit") {
    return undefined;
  }
  if (dataType.base === "struct" || dataType.base === "union") {
    return dataType.packed ? `${dataType.base} packed` : dataType.base;
  }
  return dataType.base;
}
