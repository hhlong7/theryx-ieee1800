import { baseIdentifier } from "../lint/rtlCheckers.js";

const MAX_DRAWN_REPLICATION = 4096;
// Unpacked arrays with more elements than this are memories: their accesses are not drawn element by element.
const MAX_ARRAY_ELEMENTS = 1024;
// A variable index into an array this size or smaller is drawn as a mux over its elements.
const MAX_MUXED_ARRAY_READ = 16;
const MAX_INLINE_DEPTH = 8;

export class ExpressionElaborator {
  nodes = [];
  connections = [];
  signalOutputs = new Map();
  sourceSignalNames = new Map();
  placeholderNodes = new Map();
  nodeIdCounter = 0;
  connectionIdCounter = 0;
  scope;
  // Unpacked dimensions by signal name (including partly indexed names such as `m[1]`), as [{ low, count }].
  arrays = new Map();
  // Element signal name -> the declared array it belongs to.
  elementOf = new Map();
  functions = new Map();
  // Inside a clocked block, reads of variables assigned with `<=` see the register output, not the new value.
  readOverrides;
  // Widths of names local to an inlined function (formals, locals and the return value).
  localWidths;
  inlineDepth = 0;
  alwaysElaborator;
  constructor(scope) {
    this.scope = scope;
  }
  // Records unpacked array dimensions and function declarations from a module's items.
  registerDeclarations(items) {
    for (let item of items ?? []) {
      if (item.kind === "FunctionDeclaration") {
        this.functions.set(item.svKey ?? item.name, item);
        continue;
      }
      let ranges = item.kind === "NetDeclaration" ? item.dimensions : item.kind === "PortDeclaration" ? item.svDimensions : undefined;
      if (!ranges?.length) {
        continue;
      }
      let dims = [];
      for (let range of ranges) {
        let msb = this.constValue(range.msb);
        let lsb = this.constValue(range.lsb);
        if (msb === undefined || lsb === undefined) {
          dims = undefined;
          break;
        }
        dims.push({ low: Math.min(msb, lsb), count: Math.abs(msb - lsb) + 1 });
      }
      if (dims) {
        for (let identifier of item.identifiers ?? []) {
          this.arrays.set(identifier.name, dims);
        }
      }
    }
    this.scanMemoryWrites(items);
  }
  isMemory(name) {
    let declared = this.elementOf.get(name) ?? name;
    let dims = this.arrays.get(declared);
    if (!dims) {
      return false;
    }
    return this.dynamicallyWritten?.has(declared) || dims.reduce((total, dim) => total * dim.count, 1) > MAX_ARRAY_ELEMENTS;
  }
  // Finds one-dimensional arrays written with a run-time index (`mem[addr] <= d`); those are drawn as memories.
  scanMemoryWrites(items) {
    this.dynamicallyWritten ??= new Set();
    let loopVars = new Set();
    let dynamic = (expr) => {
      if (!expr || typeof expr !== "object") {
        return false;
      }
      if (Array.isArray(expr)) {
        return expr.some(dynamic);
      }
      if (expr.kind === "Identifier") {
        return !loopVars.has(expr.name) && this.constValue(expr) === undefined;
      }
      return Object.keys(expr).some((key) => key !== "span" && dynamic(expr[key]));
    };
    let visit = (node) => {
      if (!node || typeof node !== "object") {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node.kind === "LoopStatement") {
        let loopVar = node.initExpr?.left ?? node.initExpr;
        if (loopVar?.kind === "Identifier") {
          loopVars.add(loopVar.name);
        }
        for (let decl of node.localDecls ?? []) {
          for (let identifier of decl.identifiers ?? []) {
            loopVars.add(identifier.name);
          }
        }
      }
      if ((node.kind === "BlockingAssign" || node.kind === "NonBlockingAssign" || node.kind === "ContinuousAssign") &&
        node.lhs?.kind === "BitSelect" && node.lhs.target?.kind === "Identifier" &&
        this.arrays.get(node.lhs.target.name)?.length === 1 && dynamic(node.lhs.index)) {
        this.dynamicallyWritten.add(node.lhs.target.name);
      }
      for (let key of Object.keys(node)) {
        if (key !== "span" && typeof node[key] === "object") {
          visit(node[key]);
        }
      }
    };
    visit(items);
  }
  signalWidth(name) {
    let local = this.localWidths?.get(name);
    if (local !== undefined) {
      return local;
    }
    return this.scope?.resolve(this.elementOf.get(name) ?? name)?.bitWidth ?? 1;
  }
  // The value of a constant expression (literals, parameters, loop variables in `env`), or undefined.
  constValue(expr, env) {
    if (!expr) {
      return undefined;
    }
    switch (expr.kind) {
      case "NumberLiteral":
        return typeof expr.value === "number" && Number.isFinite(expr.value) ? expr.value : undefined;
      case "Identifier": {
        if (env?.has(expr.name)) {
          return env.get(expr.name);
        }
        if (this.localWidths?.has(expr.name)) {
          return undefined;
        }
        let symbol = this.scope?.resolve(expr.name);
        if (symbol?.kind !== "parameter") {
          return undefined;
        }
        if (typeof symbol.value === "number" && Number.isFinite(symbol.value)) {
          return symbol.value;
        }
        return typeof symbol.value === "string" && /^-?\d+$/.test(symbol.value.trim()) ? Number(symbol.value.trim()) : undefined;
      }
      case "UnaryExpression": {
        let value = this.constValue(expr.argument, env);
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
        let left = this.constValue(expr.left, env);
        let right = this.constValue(expr.right, env);
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
            return left & right;
          case "|":
            return left | right;
          case "^":
            return left ^ right;
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
        let condition = this.constValue(expr.condition, env);
        return condition === undefined ? undefined : this.constValue(condition ? expr.trueExpr : expr.falseExpr, env);
      }
      default:
        return undefined;
    }
  }
  // Copies a statement or expression with a loop variable replaced by its value, folding what becomes constant.
  substitute(node, name, value) {
    let copy = (current) => {
      if (Array.isArray(current)) {
        let touched = false;
        let items = current.map((item) => {
          let [out, hit] = copy(item);
          touched ||= hit;
          return out;
        });
        return [items, touched];
      }
      if (!current || typeof current !== "object") {
        return [current, false];
      }
      if (current.kind === "Identifier" && current.name === name) {
        return [{ kind: "NumberLiteral", raw: String(value), value, bitWidth: 32, span: current.span }, true];
      }
      let out = {};
      let touched = false;
      for (let key of Object.keys(current)) {
        if (key === "span" || key.endsWith("Span")) {
          out[key] = current[key];
          continue;
        }
        let [child, hit] = copy(current[key]);
        out[key] = child;
        touched ||= hit;
      }
      if (touched && (out.kind === "BinaryExpression" || out.kind === "UnaryExpression")) {
        let folded = this.constValue(out);
        if (folded !== undefined) {
          return [{ kind: "NumberLiteral", raw: String(folded), value: folded, bitWidth: out.svWidth ?? 32, span: out.span }, true];
        }
      }
      if (touched && out.kind === "TernaryExpression") {
        let condition = this.constValue(out.condition);
        if (condition !== undefined) {
          return [condition ? out.trueExpr : out.falseExpr, true];
        }
      }
      return [out, touched];
    };
    return copy(node)[0];
  }
  registerSignalSource(d, m) {
    if (this.isMemoryPort(d)) {
      // Internal write-port values must not rename the nets they come from.
      this.signalOutputs.set(d, m);
      return;
    }
    // An alias (`b = a`) must not rename the net it reads: the first name given to a source wins.
    let source = m.signalName && m.signalName !== d ? { ...m, signalName: d } : m;
    source.signalName = d;
    this.signalOutputs.set(d, source);
    if (!this.sourceSignalNames.has(`${m.nodeId}:${m.pinId}`)) {
      this.sourceSignalNames.set(`${m.nodeId}:${m.pinId}`, d);
    }
    if (!this.sourceSignalNames.has(m.nodeId)) {
      this.sourceSignalNames.set(m.nodeId, d);
    }
  }
  tagNet(source, name) {
    let node = this.nodes.find((C) => C.id === source.nodeId);
    if (node) {
      if (!node.attributes) {
        node.attributes = {};
      }
      if (!node.attributes.netName) {
        node.attributes.netName = name;
      }
    }
  }
  elaborateAssign(d) {
    let elements = this.expandArrayAssign(d);
    if (elements) {
      for (let element of elements) {
        this.elaborateAssign(element);
      }
      return;
    }
    let expression = this.elaborateExpression(d.rhs);
    this.assignLvalue(d.lhs, expression, false);
  }
  // `arr = other_arr`, `arr <= '{default: 0}`, `arr = c ? a : b`: one assignment per element, or undefined
  // when the target is not a whole unpacked array drawn element by element.
  expandArrayAssign(statement) {
    let lhs = statement.lhs;
    let arrayName = lhs?.kind === "Identifier" || lhs?.kind === "BitSelect" ? this.arrayName(lhs) : undefined;
    if (!arrayName || this.isMemory(arrayName)) {
      return undefined;
    }
    let dims = this.arrays.get(arrayName);
    let out = [];
    for (let k = 0; k < dims[0].count; k++) {
      let index = dims[0].low + k;
      let element = {
        ...statement,
        lhs: { kind: "BitSelect", target: lhs, index: { kind: "NumberLiteral", raw: String(index), value: index, span: lhs.span }, span: lhs.span },
        rhs: this.arrayElementExpr(statement.rhs, k, dims[0].count),
      };
      out.push(...(this.expandArrayAssign(element) ?? [element]));
    }
    return out;
  }
  arrayElementExpr(rhs, k, count) {
    let source = rhs?.kind === "Identifier" || rhs?.kind === "BitSelect" ? this.arrayName(rhs) : undefined;
    let dims = source ? this.arrays.get(source) : undefined;
    if (dims?.[0].count === count) {
      let index = dims[0].low + k;
      return { kind: "BitSelect", target: rhs, index: { kind: "NumberLiteral", raw: String(index), value: index, span: rhs.span }, span: rhs.span };
    }
    if (rhs?.kind === "TernaryExpression") {
      return { ...rhs, trueExpr: this.arrayElementExpr(rhs.trueExpr, k, count), falseExpr: this.arrayElementExpr(rhs.falseExpr, k, count) };
    }
    if (rhs?.kind === "Concatenation" && rhs.elements.length === count) {
      return rhs.elements[k];
    }
    return rhs;
  }
  // Drives an assignment target: a whole signal, an array element, or a slice merged into the rest of the signal.
  assignLvalue(lhs, source, sequential) {
    if (lhs.kind === "Concatenation") {
      this.driveConcatLhs(lhs, source, sequential);
      return;
    }
    let memory = this.memoryWriteTarget(lhs);
    if (memory) {
      let width = this.signalWidth(memory);
      this.registerSignalSource(`${memory}#we`, this.createConstantSource(1, 1));
      this.registerSignalSource(`${memory}#waddr`, this.elaborateExpression(lhs.index));
      this.registerSignalSource(`${memory}#wdata`, this.fitWidth(source, width));
      if (!this.alwaysElaborator?.inAlways) {
        this.addMemoryWritePort(memory, undefined);
      }
      return;
    }
    let target = this.lvalueTarget(lhs);
    if (!target?.name) {
      return;
    }
    if (target.unknown) {
      this.registerSignalSource(
        target.name,
        this.createUnsupportedSource(
          target.name,
          this.isMemory(target.name)
            ? `'${target.name}' is a memory; writes to it are not drawn element by element`
            : `Assignment to '${target.name}[...]' with a non-constant index is not drawn`,
        ),
      );
      return;
    }
    if (target.width === undefined) {
      this.registerSignalSource(target.name, source);
      this.tagNet(source, target.name);
      return;
    }
    let total = this.signalWidth(target.name);
    if (!sequential && !this.alwaysElaborator?.inAlways) {
      // Continuous assigns to slices of one signal are joined into a single concatenation at the end.
      this.continuousSlices ??= new Map();
      let slices = this.continuousSlices.get(target.name) ?? [];
      slices.push({ offset: target.offset, width: target.width, source: this.fitWidth(source, target.width), span: lhs.span });
      this.continuousSlices.set(target.name, slices);
      return;
    }
    let base = this.writeBase(target.name, total, sequential);
    let merged = this.splice(base, target.offset, target.width, source, total, lhs.span);
    this.registerSignalSource(target.name, merged);
    this.tagNet(merged, target.name);
  }
  finishContinuousSlices() {
    for (let [name, slices] of this.continuousSlices ?? []) {
      let total = this.signalWidth(name);
      let parts = [];
      let next = total;
      for (let slice of [...slices].sort((a, b) => b.offset - a.offset)) {
        let top = slice.offset + slice.width;
        if (top > next) {
          continue; // overlaps a slice already placed
        }
        if (top < next) {
          parts.push(this.createConstantSource(0, next - top, `${next - top}'bx`));
        }
        parts.push(slice.source);
        next = slice.offset;
      }
      if (next > 0) {
        parts.push(this.createConstantSource(0, next, `${next}'bx`));
      }
      let merged = parts.length === 1 ? parts[0] : this.concatSources(parts, slices[0].span);
      this.registerSignalSource(name, merged);
      this.tagNet(merged, name);
    }
    this.continuousSlices = undefined;
  }
  // The value a partial assignment is merged into: the register output in a clocked block, otherwise what is
  // already assigned, or an undriven constant.
  writeBase(name, width, sequential) {
    let current = this.signalOutputs.get(name);
    if (current && (sequential || this.placeholderNodes.get(current.nodeId) !== name)) {
      return current;
    }
    if (sequential) {
      return this.elaborateIdentifier({ kind: "Identifier", name });
    }
    return this.createConstantSource(0, width, `${width}'bx`);
  }
  splice(base, offset, width, value, total, span) {
    if (offset === 0 && width === total) {
      return this.fitWidth(value, width);
    }
    // Splicing into an earlier splice reuses its pieces, so `y[0] = ..; y[1] = ..;` builds one concatenation.
    let pieces = this.bitPieces(base);
    let take = (lo, hi) => {
      let out = [];
      for (let piece of pieces) {
        let a = Math.max(lo, piece.at);
        let b = Math.min(hi, piece.at + piece.width);
        if (a < b) {
          let next = { source: piece.source, lo: piece.lo + (a - piece.at), width: b - a };
          let last = out[out.length - 1];
          if (last && last.source.nodeId === next.source.nodeId && last.source.pinId === next.source.pinId && last.lo === next.lo + next.width) {
            last.lo = next.lo;
            last.width += next.width;
          } else {
            out.push(next);
          }
        }
      }
      return out.map((part) => this.sliceSource(part.source, part.lo, part.width, span));
    };
    let parts = [...take(offset + width, total), this.fitWidth(value, width), ...take(0, offset)];
    return this.concatSources(parts, span);
  }
  // A source as { source, lo, width, at } pieces, most significant first: the inputs of a concatenation
  // (seen through bit slices), or the source itself.
  bitPieces(source) {
    let node = this.nodes.find((candidate) => candidate.id === source.nodeId);
    if (node?.type === "SPLIT" && node.attributes?.lsb !== undefined) {
      let input = this.connections.find((wire) => wire.targetNodeId === node.id && wire.targetPinId === "in");
      let from = input && this.nodes.find((candidate) => candidate.id === input.sourceNodeId);
      if (from) {
        let inner = { nodeId: input.sourceNodeId, pinId: input.sourcePinId, bitWidth: input.bitWidth };
        return [{ source: inner, lo: node.attributes.lsb, width: source.bitWidth, at: 0 }];
      }
    }
    if (node?.type !== "CONCAT" || source.pinId !== "out") {
      return [{ source, lo: 0, width: source.bitWidth, at: 0 }];
    }
    let inputs = node.pins.filter((pin) => pin.direction === "in");
    let pieces = [];
    let at = source.bitWidth;
    for (let pin of inputs) {
      let wire = this.connections.find((candidate) => candidate.targetNodeId === node.id && candidate.targetPinId === pin.id);
      if (!wire) {
        return [{ source, lo: 0, width: source.bitWidth, at: 0 }];
      }
      at -= pin.bitWidth;
      for (let piece of this.bitPieces({ nodeId: wire.sourceNodeId, pinId: wire.sourcePinId, bitWidth: pin.bitWidth })) {
        pieces.push({ ...piece, at: at + piece.at });
      }
    }
    return pieces;
  }
  // Removes slices, concatenations and constants that ended up driving nothing.
  pruneDeadNodes() {
    let prunable = new Set(["CONCAT", "SPLIT", "CONSTANT"]);
    for (;;) {
      let live = new Set(this.connections.map((wire) => wire.sourceNodeId));
      for (let source of this.signalOutputs.values()) {
        live.add(source.nodeId);
      }
      let dead = new Set(this.nodes.filter((node) => prunable.has(node.type) && !live.has(node.id)).map((node) => node.id));
      if (dead.size === 0) {
        return;
      }
      this.nodes = this.nodes.filter((node) => !dead.has(node.id));
      this.connections = this.connections.filter((wire) => !dead.has(wire.targetNodeId));
    }
  }
  fitWidth(source, width) {
    if (!source || width === undefined || source.bitWidth === width) {
      return source;
    }
    if (source.bitWidth > width) {
      return this.sliceSource(source, 0, width);
    }
    return { nodeId: source.nodeId, pinId: source.pinId, bitWidth: width };
  }
  concatSources(parts, span) {
    if (parts.length === 1) {
      return parts[0];
    }
    let total = parts.reduce((sum, part) => sum + part.bitWidth, 0);
    let nodeId = this.createNodeId("concat");
    this.nodes.push({
      id: nodeId,
      type: "CONCAT",
      label: "{ }",
      pins: [
        ...parts.map((part, index) => ({ id: `in${index}`, name: `in${index}`, direction: "in", bitWidth: part.bitWidth })),
        { id: "out", name: "Y", direction: "out", bitWidth: total },
      ],
      bitWidth: total,
      span,
    });
    parts.forEach((part, index) => this.connect(part.nodeId, part.pinId, nodeId, `in${index}`, part.bitWidth));
    return { nodeId, pinId: "out", bitWidth: total };
  }
  // What an assignment target writes: { name } for a whole signal or array element, { name, offset, width } for
  // a constant slice, { name, unknown } when the written bits depend on a run-time index.
  // `mem[addr]` on a whole one-dimensional memory: the memory's name, else undefined.
  memoryWriteTarget(lhs) {
    if (lhs?.kind !== "BitSelect" || lhs.target?.kind !== "Identifier") {
      return undefined;
    }
    let name = lhs.target.name;
    return this.arrays.get(name)?.length === 1 && this.isMemory(name) && !this.localWidths?.has(name) ? name : undefined;
  }
  isMemoryPort(name) {
    return /#(we|waddr|wdata)$/.test(name);
  }
  // One block per memory; reads and writes add ports to it.
  memoryNode(name) {
    this.memoryNodes ??= new Map();
    let node = this.memoryNodes.get(name);
    if (!node) {
      let depth = this.arrays.get(name)[0].count;
      let width = this.signalWidth(name);
      node = {
        id: this.createNodeId("memory"),
        type: "SUBMODULE",
        label: `memory ${name} [${depth}x${width}]`,
        pins: [],
        bitWidth: width,
        // An empty module name keeps double-click from trying to open a module called "memory ...".
        attributes: { memory: true, moduleName: "", memoryName: name, depth, readPorts: 0, writePorts: 0 },
      };
      this.nodes.push(node);
      this.memoryNodes.set(name, node);
    }
    return node;
  }
  readMemory(name, indexExpr, span) {
    let node = this.memoryNode(name);
    let address = this.elaborateExpression(indexExpr);
    let k = node.attributes.readPorts++;
    let width = this.signalWidth(name);
    node.pins.push(
      { id: `raddr${k}`, name: `RADDR${k}`, direction: "in", bitWidth: address.bitWidth },
      { id: `rdata${k}`, name: `RDATA${k}`, direction: "out", bitWidth: width },
    );
    this.connect(address.nodeId, address.pinId, node.id, `raddr${k}`, address.bitWidth);
    return { nodeId: node.id, pinId: `rdata${k}`, bitWidth: width };
  }
  // Turns the pending `name#we/#waddr/#wdata` values into a write port; `clock` is set for clocked writes.
  addMemoryWritePort(name, clock) {
    let we = this.signalOutputs.get(`${name}#we`);
    let address = this.signalOutputs.get(`${name}#waddr`);
    let data = this.signalOutputs.get(`${name}#wdata`);
    for (let port of ["we", "waddr", "wdata"]) {
      this.signalOutputs.delete(`${name}#${port}`);
    }
    if (!address || !data) {
      return;
    }
    let node = this.memoryNode(name);
    let k = node.attributes.writePorts++;
    let pins = [
      { id: `we${k}`, name: `WE${k}`, direction: "in", bitWidth: 1 },
      { id: `waddr${k}`, name: `WADDR${k}`, direction: "in", bitWidth: address.bitWidth },
      { id: `wdata${k}`, name: `WDATA${k}`, direction: "in", bitWidth: data.bitWidth },
    ];
    if (clock) {
      pins.unshift({ id: `clk${k}`, name: `CLK${k}`, direction: "in", bitWidth: 1 });
      this.connect(clock.nodeId, clock.pinId, node.id, `clk${k}`, 1);
    }
    node.pins.push(...pins);
    if (we) {
      this.connect(we.nodeId, we.pinId, node.id, `we${k}`, 1);
    }
    this.connect(address.nodeId, address.pinId, node.id, `waddr${k}`, address.bitWidth);
    this.connect(data.nodeId, data.pinId, node.id, `wdata${k}`, data.bitWidth);
  }
  lvalueTarget(lhs) {
    switch (lhs?.kind) {
      case "Identifier":
        return { name: lhs.name };
      case "BitSelect":
      case "PartSelect": {
        if (lhs.kind === "BitSelect") {
          let arrayName = this.arrayName(lhs.target);
          if (arrayName) {
            let element = this.isMemory(arrayName) ? undefined : this.elementName(arrayName, lhs.index);
            return element ? { name: element } : { name: this.elementOf.get(arrayName) ?? arrayName, unknown: true };
          }
        }
        let inner = this.lvalueTarget(lhs.target);
        if (!inner?.name || inner.unknown || inner.width !== undefined) {
          return inner?.name ? { name: inner.name, unknown: true } : undefined;
        }
        let total = this.signalWidth(inner.name);
        let low;
        let width;
        if (lhs.kind === "BitSelect") {
          let index = this.constValue(lhs.index);
          low = index === undefined ? undefined : this.bitOffset(inner.name, index);
          width = 1;
        } else {
          let msb = this.constValue(lhs.msb);
          let lsb = this.constValue(lhs.lsb);
          if (msb !== undefined && lsb !== undefined) {
            low = Math.min(this.bitOffset(inner.name, msb), this.bitOffset(inner.name, lsb));
            width = Math.abs(msb - lsb) + 1;
          }
        }
        if (low === undefined || low < 0 || low + width > total) {
          return { name: inner.name, unknown: true };
        }
        return { name: inner.name, offset: low, width };
      }
      default:
        return undefined;
    }
  }
  // The declared index of the bit `offset` places above the least significant one.
  indexAtOffset(name, offset) {
    let symbol = this.elementOf.has(name) || this.localWidths?.has(name) ? undefined : this.scope?.resolve(name);
    if (!symbol || symbol.msb === undefined || symbol.lsb === undefined) {
      return offset;
    }
    return symbol.msb >= symbol.lsb ? symbol.lsb + offset : symbol.lsb - offset;
  }
  // Position of bit `index` counted from the least significant bit of the declared range.
  bitOffset(name, index) {
    if (this.elementOf.has(name) || this.localWidths?.has(name)) {
      return index;
    }
    let symbol = this.scope?.resolve(name);
    if (!symbol || typeof symbol.msb !== "number" || typeof symbol.lsb !== "number") {
      return index;
    }
    return symbol.msb >= symbol.lsb ? index - symbol.lsb : symbol.lsb - index;
  }
  // The array (or partly indexed array) an expression names, if any.
  arrayName(expr) {
    if (expr?.kind === "Identifier") {
      return this.arrays.has(expr.name) && !this.localWidths?.has(expr.name) ? expr.name : undefined;
    }
    if (expr?.kind === "BitSelect") {
      let outer = this.arrayName(expr.target);
      let element = outer && !this.isMemory(outer) ? this.elementName(outer, expr.index) : undefined;
      return element && this.arrays.has(element) ? element : undefined;
    }
    return undefined;
  }
  // `name[k]` for a constant in-range index, registering it as a signal of its own.
  elementName(arrayName, indexExpr) {
    let dims = this.arrays.get(arrayName);
    let index = this.constValue(indexExpr);
    if (!dims?.length || index === undefined || index < dims[0].low || index >= dims[0].low + dims[0].count) {
      return undefined;
    }
    let element = `${arrayName}[${index}]`;
    this.elementOf.set(element, this.elementOf.get(arrayName) ?? arrayName);
    if (dims.length > 1) {
      this.arrays.set(element, dims.slice(1));
    }
    return element;
  }
  // Reads an unpacked array element; undefined when the expression is not an array access.
  elaborateArrayRead(d) {
    let arrayName = this.arrayName(d.target);
    if (!arrayName) {
      return undefined;
    }
    let declared = this.elementOf.get(arrayName) ?? arrayName;
    if (this.isMemory(arrayName)) {
      if (arrayName === declared && this.arrays.get(declared).length === 1) {
        return this.readMemory(declared, d.index, d.span);
      }
      this.elaborateExpression(d.index);
      return this.createUnsupportedSource(`${declared}[...]`, `Reads of multi-dimensional memory '${declared}' are not drawn`, this.signalWidth(declared));
    }
    let element = this.elementName(arrayName, d.index);
    if (element) {
      let port = this.signalOutputs.get(declared);
      let dims = this.arrays.get(arrayName);
      if (arrayName === declared && dims.length === 1 && port && this.isInputPort(declared)) {
        let width = this.signalWidth(declared);
        return this.sliceSource(port, (this.constValue(d.index) - dims[0].low) * width, width, d.span);
      }
      return this.elaborateIdentifier({ kind: "Identifier", name: element, span: d.span });
    }
    let dims = this.arrays.get(arrayName);
    if (this.constValue(d.index) !== undefined || dims[0].count > MAX_MUXED_ARRAY_READ || dims.length > 1) {
      return this.createUnsupportedSource(`${declared}[...]`, `This read of '${declared}' is not drawn`, this.signalWidth(declared));
    }
    let index = this.elaborateExpression(d.index);
    let result;
    for (let k = 0; k < dims[0].count; k++) {
      let value = dims[0].low + k;
      let elementSource = this.elaborateArrayRead({ ...d, index: { kind: "NumberLiteral", raw: String(value), value, span: d.span } });
      if (!result) {
        result = elementSource;
        continue;
      }
      let match = this.createBinaryNode("COMPARE_EQ", "==", index, this.createConstantSource(value, index.bitWidth), 1, d.span, {
        isExpandable: true,
        macroType: "compare",
        operator: "==",
      });
      result = this.createMuxNode(match, elementSource, result, d.span);
    }
    return result;
  }
  isInputPort(name) {
    let symbol = this.scope?.resolve(name);
    return symbol?.kind === "port" && symbol.direction === "input";
  }
  createBinaryNode(type, label, left, right, width, span, attributes) {
    let nodeId = this.createNodeId(type.toLowerCase());
    this.nodes.push({
      id: nodeId,
      type,
      label,
      pins: [
        { id: "in0", name: "A", direction: "in", bitWidth: left.bitWidth },
        { id: "in1", name: "B", direction: "in", bitWidth: right.bitWidth },
        { id: "out", name: "Y", direction: "out", bitWidth: width },
      ],
      bitWidth: width,
      span,
      attributes,
    });
    this.connect(left.nodeId, left.pinId, nodeId, "in0", left.bitWidth);
    this.connect(right.nodeId, right.pinId, nodeId, "in1", right.bitWidth);
    return { nodeId, pinId: "out", bitWidth: width };
  }
  createMuxNode(select, whenTrue, whenFalse, span) {
    let width = Math.max(whenTrue.bitWidth, whenFalse.bitWidth);
    let nodeId = this.createNodeId("mux");
    this.nodes.push({
      id: nodeId,
      type: "MUX",
      label: "MUX",
      pins: [
        { id: "in0", name: "0", direction: "in", bitWidth: whenFalse.bitWidth },
        { id: "in1", name: "1", direction: "in", bitWidth: whenTrue.bitWidth },
        { id: "sel", name: "SEL", direction: "select", bitWidth: 1 },
        { id: "out", name: "Y", direction: "out", bitWidth: width },
      ],
      bitWidth: width,
      span,
      attributes: { isExpandable: true, macroType: "mux" },
    });
    this.connect(whenFalse.nodeId, whenFalse.pinId, nodeId, "in0", whenFalse.bitWidth);
    this.connect(whenTrue.nodeId, whenTrue.pinId, nodeId, "in1", whenTrue.bitWidth);
    this.connect(select.nodeId, select.pinId, nodeId, "sel", 1);
    return { nodeId, pinId: "out", bitWidth: width };
  }
  // `value[index +: width]` for a run-time index: a right shift followed by the low bits.
  dynamicSelect(value, indexExpr, width, span) {
    let index = this.elaborateExpression(indexExpr);
    let shifted = this.createBinaryNode("SHIFT_RIGHT", ">>", value, index, value.bitWidth, span, { macroType: "shift", operator: ">>" });
    return this.sliceSource(shifted, 0, Math.min(width, value.bitWidth), span);
  }
  // Inlines a call to a function declared in this module, drawing its body as combinational logic.
  inlineFunction(call) {
    let fn = this.functions.get(call.svFunction ?? call.name);
    let always = this.alwaysElaborator;
    if (!fn || !always || this.inlineDepth >= MAX_INLINE_DEPTH) {
      return undefined;
    }
    let rangeWidth = (range) => {
      let msb = this.constValue(range?.msb);
      let lsb = this.constValue(range?.lsb);
      return msb === undefined || lsb === undefined ? 1 : Math.abs(msb - lsb) + 1;
    };
    let formals = [];
    for (let port of fn.ports ?? []) {
      if (port.direction && port.direction !== "input") {
        return undefined;
      }
      for (let identifier of port.identifiers ?? []) {
        formals.push({ name: identifier.name, width: rangeWidth(port.range) });
      }
    }
    let args = formals.map((formal, index) =>
      call.args?.[index] ? this.fitWidth(this.elaborateExpression(call.args[index]), formal.width) : this.createConstantSource(0, formal.width),
    );
    let returnWidth = rangeWidth(fn.range);
    let locals = new Map();
    let collectLocals = (statement) => {
      if (!statement || typeof statement !== "object") {
        return;
      }
      for (let declaration of statement.localDecls ?? []) {
        for (let identifier of declaration.identifiers ?? []) {
          locals.set(identifier.name, rangeWidth(declaration.range));
        }
      }
      for (let child of [statement.statements, statement.thenBranch, statement.elseBranch, statement.body, ...(statement.items ?? []).map((item) => item.statement)]) {
        if (Array.isArray(child)) {
          child.forEach(collectLocals);
        } else {
          collectLocals(child);
        }
      }
    };
    (fn.statements ?? []).forEach(collectLocals);
    let savedOutputs = this.signalOutputs;
    let savedOverrides = this.readOverrides;
    let savedWidths = this.localWidths;
    let savedSequential = always.isSequentialContext;
    this.signalOutputs = new Map(savedOutputs);
    this.readOverrides = undefined;
    this.localWidths = new Map([...(savedWidths ?? []), [fn.name, returnWidth], ...formals.map((formal) => [formal.name, formal.width]), ...locals]);
    always.isSequentialContext = false;
    this.inlineDepth++;
    try {
      for (let name of [fn.name, ...locals.keys()]) {
        this.signalOutputs.delete(name);
      }
      formals.forEach((formal, index) => this.registerSignalSource(formal.name, { ...args[index] }));
      let body = always.unrollStatement(rewriteReturns(fn.statements ?? [], call.span));
      always.elaborateCombinational(body);
      let result = this.signalOutputs.get(fn.name) ?? this.createConstantSource(0, returnWidth, `${returnWidth}'bx`);
      let fitted = this.fitWidth(result, returnWidth);
      return { nodeId: fitted.nodeId, pinId: fitted.pinId, bitWidth: fitted.bitWidth };
    } finally {
      this.inlineDepth--;
      this.signalOutputs = savedOutputs;
      this.readOverrides = savedOverrides;
      this.localWidths = savedWidths;
      always.isSequentialContext = savedSequential;
    }
  }
  driveConcatLhs(d, m, sequential = false) {
    let k = d.elements.map((C) => this.lvalueWidth(C));
    let E = 0;
    for (let C = k.length - 1; C >= 0; C--) {
      let M = k[C];
      let v = d.elements[C];
      if (!this.lvalueTarget(v)?.name && v.kind !== "Concatenation") {
        E += M;
        continue;
      }
      let sliceSource = this.sliceSource(m, E, M, v.span);
      this.assignLvalue(v, sliceSource, sequential);
      E += M;
    }
  }
  lvalueWidth(d) {
    if (d.kind === "Concatenation") {
      return d.elements.reduce((total, element) => total + this.lvalueWidth(element), 0);
    }
    let target = this.lvalueTarget(d);
    if (!target?.name) {
      return 1;
    }
    if (target.unknown) {
      return d.svWidth ?? 1;
    }
    return target.width ?? this.signalWidth(target.name);
  }
  lvalueName(d) {
    return this.lvalueTarget(d)?.name;
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
  // Elaborates an expression; a cast (`W'(x)`) or a select with a known width resizes the result.
  elaborateExpression(d) {
    if (!d) {
      return this.createUnsupportedSource("?", "Missing expression");
    }
    let result = this.elaborateExpressionCore(d);
    if (
      d.svWidth > 0 &&
      result &&
      result.bitWidth !== d.svWidth &&
      d.kind !== "BitSelect" &&
      d.kind !== "PartSelect" &&
      d.kind !== "NumberLiteral"
    ) {
      return this.fitWidth(result, d.svWidth);
    }
    return result;
  }
  elaborateExpressionCore(d) {
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
        let element = this.elaborateArrayRead(d);
        if (element) {
          return element;
        }
        let expression = this.elaborateExpression(d.target);
        let E = this.constValue(d.index);
        if (E === undefined) {
          return this.dynamicSelect(expression, d.index, 1, d.span);
        }
        let nodeId = this.createNodeId("split");
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
        let k = this.constValue(d.msb);
        let E = this.constValue(d.lsb);
        if (k === undefined || E === undefined) {
          return this.dynamicSelect(expression2, d.lsb, d.svWidth ?? 1, d.span);
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
        // Signedness casts change how bits are read, not which wires carry them.
        if ((d.name === "$signed" || d.name === "$unsigned") && d.args?.length === 1) {
          let inner = this.elaborateExpression(d.args[0]);
          return { nodeId: inner.nodeId, pinId: inner.pinId, bitWidth: inner.bitWidth };
        }
        return this.createUnsupportedSource(
          d.name,
          `System function '${d.name}' has no hardware meaning`,
        );
      case "FunctionCall":
        return (
          this.inlineFunction(d) ??
          this.createUnsupportedSource(
            d.name,
            `Function call '${d.name}' cannot be elaborated into a circuit`,
          )
        );
      case "OpaqueExpression":
        return this.createUnsupportedSource(
          d.text ?? "expression",
          `'${d.text ?? "expression"}' is a SystemVerilog construct that is not drawn in the schematic`,
        );
      default:
        return this.createUnsupportedSource(d.kind ?? "expression", `'${d.kind}' is not drawn in the schematic`);
    }
  }
  createUnsupportedSource(d, m, width = 1) {
    let nodeId = this.createNodeId("unsupported");
    let E = {
      id: "out",
      name: "out",
      direction: "out",
      bitWidth: width,
    };
    let C = {
      id: nodeId,
      type: "UNSUPPORTED",
      label: d,
      pins: [E],
      bitWidth: width,
      attributes: {
        unsupported: true,
        reason: m,
      },
    };
    this.nodes.push(C);
    return {
      nodeId: nodeId,
      pinId: "out",
      bitWidth: width,
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
    let override = this.readOverrides?.get(d.name);
    if (override) {
      return override;
    }
    let value = this.signalOutputs.get(d.name);
    if (value) {
      return value;
    }
    let resolve = this.localWidths?.has(d.name) ? undefined : this.scope?.resolve(this.elementOf.get(d.name) ?? d.name);
    let E = this.signalWidth(d.name);
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
    let m = d.svWidth ?? d.bitWidth ?? 1;
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
      label: shortConstantLabel(k ?? String(d)),
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
    if (m > MAX_DRAWN_REPLICATION) {
      return this.createUnsupportedSource(
        `{${m}{...}}`,
        `Replication of ${m} copies is too large to draw in the schematic`,
      );
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

function containsReturn(statement) {
  if (!statement || typeof statement !== "object") {
    return false;
  }
  if (statement.svReturn) {
    return true;
  }
  let children = [statement.thenBranch, statement.elseBranch, statement.body, ...(statement.statements ?? []), ...(statement.items ?? []).map((item) => item.statement)];
  return children.some(containsReturn);
}

function block(statements, span) {
  return statements.length === 1 ? statements[0] : { kind: "BlockStatement", statements, span };
}

// Rewrites early `return`s so the statements after one only run on paths that did not return.
function rewriteStatements(statements, span) {
  for (let index = 0; index < statements.length; index++) {
    let statement = statements[index];
    if (!containsReturn(statement)) {
      continue;
    }
    let before = statements.slice(0, index);
    let rest = statements.slice(index + 1);
    switch (statement.kind) {
      case "BlockingAssign":
        return [...before, statement];
      case "BlockStatement":
        return [...before, ...rewriteStatements([...statement.statements, ...rest], span)];
      case "IfStatement":
        return [
          ...before,
          {
            ...statement,
            thenBranch: block(rewriteStatements([statement.thenBranch, ...rest], span), span),
            elseBranch: block(rewriteStatements([...(statement.elseBranch ? [statement.elseBranch] : []), ...rest], span), span),
          },
        ];
      case "CaseStatement": {
        let items = statement.items.map((item) => ({ ...item, statement: block(rewriteStatements([item.statement, ...rest], span), span) }));
        if (!items.some((item) => item.isDefault)) {
          items.push({ isDefault: true, patterns: [], statement: block(rewriteStatements(rest, span), span), span });
        }
        return [...before, { ...statement, items }];
      }
      default:
        return statements;
    }
  }
  return statements;
}

export function rewriteReturns(statements, span) {
  return { kind: "BlockStatement", statements: rewriteStatements(statements, span), span };
}

// `50'b000...0` reads better as `50'h0`; long runs of one x or z digit collapse to `N'bx`.
function shortConstantLabel(label) {
  let match = /^(\d+)'([sS]?)[bB]([01_]{17,})$/.exec(label);
  if (match) {
    return `${match[1]}'${match[2]}h${BigInt("0b" + match[3].replace(/_/g, "")).toString(16)}`;
  }
  let fill = /^(\d+)'[bB]([xXzZ])\2{16,}$/.exec(label);
  return fill ? `${fill[1]}'b${fill[2]}` : label;
}
