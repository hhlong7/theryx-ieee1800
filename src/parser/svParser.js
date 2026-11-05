import { Parser } from "./parser.js";

const NET_TYPES = [
  "wire", "tri", "tri0", "tri1", "wand", "wor", "triand", "trior", "trireg", "supply0", "supply1",
  "uwire", "interconnect",
];

const INTEGER_VECTOR_TYPES = ["logic", "reg", "bit"];

const INTEGER_ATOM_TYPES = ["byte", "shortint", "int", "longint", "integer", "time"];

const OTHER_TYPES = ["real", "shortreal", "realtime", "string", "chandle", "event", "void"];

const TYPE_KEYWORDS = [
  ...INTEGER_VECTOR_TYPES, ...INTEGER_ATOM_TYPES, ...OTHER_TYPES, "struct", "union", "enum",
  "virtual", "type",
];

const LIFETIME_AND_QUALIFIERS = [
  "automatic", "static", "const", "var", "rand", "randc", "local", "protected",
];

const STRENGTHS = [
  "supply0", "strong0", "pull0", "weak0", "highz0", "supply1", "strong1", "pull1", "weak1", "highz1",
  "small", "medium", "large",
];

const GATE_LIKE = [
  "cmos", "rcmos", "nmos", "pmos", "rnmos", "rpmos", "pullup", "pulldown", "tran", "rtran",
  "tranif0", "tranif1", "rtranif0", "rtranif1", "or",
];

const SKIPPED_REGIONS = {
  property: "endproperty",
  sequence: "endsequence",
  covergroup: "endgroup",
  clocking: "endclocking",
  specify: "endspecify",
  checker: "endchecker",
  config: "endconfig",
  primitive: "endprimitive",
  randsequence: "endsequence",
  table: "endtable",
};

const ASSIGNMENT_OPERATORS = [
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", "<<<=", ">>>=",
];

// `A[3]` declares A0, A1, A2 and `B[2:4]` declares B2, B3, B4.
function expandEnumRange(name, value, rangeExpr, rangeEnd) {
  let item = { name: name.text, nameSpan: name.span, value, rangeExpr };
  if (rangeExpr?.kind !== "NumberLiteral" || (rangeEnd && rangeEnd.kind !== "NumberLiteral")) {
    return [item];
  }
  let first = rangeEnd ? rangeExpr.value : 0;
  let last = rangeEnd ? rangeEnd.value : rangeExpr.value - 1;
  let step = first <= last ? 1 : -1;
  let items = [];
  for (let index = first; items.length < 4096; index += step) {
    items.push({ name: `${name.text}${index}`, nameSpan: name.span, value: items.length === 0 ? value : undefined, rangeExpr });
    if (index === last) {
      break;
    }
  }
  return items;
}

export class SvParser extends Parser {
  nestedUnits = [];
  patternVariables = new Map();
  constructor(tokens, fileUri = "file:///untitled.sv") {
    super(tokens, fileUri);
    // `$unit::name` reads like a package scope everywhere a scope is accepted.
    tokens.forEach((token, index) => {
      if (token.type === "SystemIdentifier" && token.text === "$unit" && tokens[index + 1]?.type === "::") {
        token.type = "Identifier";
      }
    });
  }

  // ---- Compilation unit

  parse() {
    let modules = [];
    let packages = [];
    let classes = [];
    let unitItems = [];
    let start = this.peek().span;
    for (; !this.isAtEnd();) {
      let cursor = this.cursor;
      if (this.match("module", "macromodule")) {
        this.pushIfPresent(modules, this.parseDesignUnit("module", "endmodule"));
      } else if (this.match("interface")) {
        if (this.check("class")) {
          this.skipClass();
        } else {
          this.pushIfPresent(modules, this.parseDesignUnit("interface", "endinterface"));
        }
      } else if (this.match("program")) {
        this.pushIfPresent(modules, this.parseDesignUnit("program", "endprogram"));
      } else if (this.match("primitive")) {
        this.pushIfPresent(modules, this.parsePrimitive());
      } else if (this.match("package")) {
        this.pushIfPresent(packages, this.parsePackage());
      } else if (this.check("class") || (this.check("virtual") && this.peekNext().type === "class")) {
        this.pushIfPresent(classes, this.skipClass());
      } else {
        this.pushItems(unitItems, this.parseDeclarationItem());
      }
      if (this.cursor === cursor) {
        this.addDiagnostic(
          `Unexpected token '${this.peek().text}' outside module definition`,
          this.peek().span,
        );
        this.advance();
      }
    }
    modules.push(...this.nestedUnits);
    return {
      kind: "SourceFile",
      modules,
      packages,
      classes,
      unitItems,
      isSystemVerilog: true,
      span: this.combineSpans(start, this.previous().span),
    };
  }
  pushIfPresent(list, item) {
    if (item) {
      list.push(item);
    }
  }
  pushItems(list, item) {
    if (Array.isArray(item)) {
      list.push(...item);
    } else if (item) {
      list.push(item);
    }
  }
  // Passing `expected` checks the label: null means the construct has no name to repeat.
  skipEndLabel(expected) {
    if (!this.match(":")) {
      return;
    }
    let label = this.match("Identifier", "EscapedIdentifier", "new") ? this.previous() : undefined;
    if (!label || expected === undefined || label.text === expected) {
      return;
    }
    this.addDiagnostic(
      expected === null
        ? `End label '${label.text}' has no matching block name`
        : `End label '${label.text}' does not match '${expected}'`,
      label.span,
      "error",
      "SYNTAX-END-LABEL",
    );
  }
  // `matches` patterns bind variables with no declaration of their own.
  addPatternVariables(items) {
    let declared = new Set(items.flatMap((item) => item.declarators?.map((d) => d.name) ?? []));
    for (let [name, span] of this.patternVariables) {
      if (!declared.has(name)) {
        items.push({
          kind: "DataDeclaration",
          dataType: { kind: "DataType", base: "int", dims: [], span },
          declarators: [{ name, nameSpan: span, dims: [] }],
          identifiers: [{ kind: "Identifier", name, span }],
          svPatternVariable: true,
          span,
        });
      }
    }
    this.patternVariables = new Map();
  }
  parsePrimitive() {
    let keyword = this.previous();
    let name = this.consumeName("Expected primitive name after 'primitive'");
    let portNames = [];
    if (this.check("(")) {
      let close = this.skipBalanced(this.cursor, "(", ")");
      for (let at = this.cursor; at < close; at++) {
        if (this.tokens[at].type === "Identifier") {
          portNames.push(this.tokens[at].text);
        }
      }
    }
    for (; !this.check("endprimitive") && !this.isAtEnd();) {
      this.advance();
    }
    let end = this.consume("endprimitive", "Expected 'endprimitive' to close primitive");
    this.skipEndLabel(name?.text);
    if (!name) {
      return null;
    }
    return {
      kind: "ModuleDeclaration",
      designUnit: "primitive",
      name: name.text,
      nameSpan: name.span,
      items: [],
      portNames,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  parsePackage() {
    let keyword = this.previous();
    this.match("automatic", "static");
    let name = this.consumeName("Expected package name after 'package'");
    if (!name) {
      this.synchronize(["endpackage", ";"]);
      return null;
    }
    this.consume(";", "Expected ';' after package header");
    let items = [];
    for (; !this.check("endpackage") && !this.isAtEnd();) {
      let cursor = this.cursor;
      this.pushItems(items, this.parseDeclarationItem());
      if (this.cursor === cursor) {
        this.addDiagnostic(`Unexpected token '${this.peek().text}' in package body`, this.peek().span);
        this.advance();
      }
    }
    let end = this.consume("endpackage", "Expected 'endpackage' to close package");
    this.skipEndLabel(name.text);
    return {
      kind: "PackageDeclaration",
      name: name.text,
      nameSpan: name.span,
      items,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  consumeName(message) {
    return this.match("Identifier", "EscapedIdentifier") ? this.previous() : this.consume("Identifier", message);
  }
  parseDesignUnit(unit, endKeyword) {
    let keyword = this.previous();
    if (this.match("extern")) {
      this.skipToSemicolon();
      return null;
    }
    this.match("automatic", "static");
    let name = this.match("Identifier", "EscapedIdentifier") ? this.previous() : null;
    if (!name) {
      this.addDiagnostic(`Expected ${unit} name after '${unit}'`, this.peek().span);
      this.synchronize([endKeyword, ";"]);
      return null;
    }
    let items = [];
    for (; this.check("import");) {
      this.advance();
      this.pushItems(items, this.parseImportOrDpi());
    }
    if (this.match("#")) {
      this.consume("(", "Expected '(' after '#'");
      this.pushItems(items, this.parseParameterPortList());
      this.consume(")", "Expected ')' after module parameter list");
    }
    let portNames;
    if (this.match("(")) {
      portNames = [];
      if (this.check(".") && this.peekNext().type === "*") {
        this.advance();
        this.advance();
      } else if (!this.check(")")) {
        let ports = this.parseHeaderPorts(portNames);
        items.push(...ports);
      }
      this.consume(")", "Expected ')' after module port list");
    }
    this.consume(";", "Expected ';' after module header");
    if (this.check("timeunit") || this.check("timeprecision")) {
      for (; this.match("timeunit", "timeprecision");) {
        this.skipToSemicolon();
      }
    }
    for (; !this.check(endKeyword) && !this.isAtEnd();) {
      let cursor = this.cursor;
      try {
        this.pushItems(items, this.parseModuleItem());
      } catch {
        this.synchronize([";", endKeyword]);
      }
      if (this.cursor === cursor) {
        this.addDiagnostic(`Unexpected token '${this.peek().text}' in module body`, this.peek().span);
        this.advance();
      }
    }
    let end = this.consume(endKeyword, `Expected '${endKeyword}' to close ${unit} declaration`);
    this.skipEndLabel(name.text);
    this.addPatternVariables(items);
    let svPortExpressions = this.sawPortExpression;
    this.sawPortExpression = false;
    return {
      kind: "ModuleDeclaration",
      designUnit: unit,
      svPortExpressions,
      name: name.text,
      nameSpan: name.span,
      items,
      portNames,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }

  // ---- Parameters

  parseParameterPortList() {
    let groups = [];
    let isLocal = false;
    let inherited;
    for (; !this.check(")") && !this.isAtEnd();) {
      let start = this.cursor;
      let explicit = false;
      if (this.match("parameter", "localparam")) {
        isLocal = this.previous().type === "localparam";
        explicit = true;
        inherited = undefined;
      }
      groups.push(this.parseParameterAssignment(isLocal, explicit, inherited));
      inherited = groups[groups.length - 1].dataType;
      if (!this.match(",") && !this.check(")")) {
        this.addDiagnostic("Expected ',' between module parameters", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        if (this.cursor === start) {
          this.advance();
        }
      }
    }
    return groups;
  }
  parseParameterAssignment(isLocal, explicit, inherited) {
    let start = this.peek().span;
    if (this.match("type")) {
      return this.finishTypeParameter(start, isLocal);
    }
    let dataType = this.parseOptionalParameterType() ?? inherited;
    let name = this.consumeName("Expected parameter name in module header");
    let dims = this.parseUnpackedDimensions();
    let valueExpr;
    if (this.match("=")) {
      valueExpr = this.parseExpression();
    }
    return {
      kind: "ParameterDeclaration",
      isLocal,
      dataType,
      range: dataType?.dims?.[0]?.kind === "Range" ? dataType.dims[0] : undefined,
      parameters: name ? [{ name: name.text, valueExpr, span: name.span, dims }] : [],
      span: this.combineSpans(start, this.previous().span),
    };
  }
  finishTypeParameter(start, isLocal) {
    let name = this.consumeName("Expected type parameter name");
    let defaultType;
    if (this.match("=")) {
      defaultType = this.parseDataType();
    }
    return {
      kind: "TypeParameterDeclaration",
      isLocal,
      name: name?.text ?? "<error>",
      nameSpan: name?.span ?? start,
      defaultType,
      span: this.combineSpans(start, this.previous().span),
    };
  }
  parseOptionalParameterType() {
    if (this.checkAny(TYPE_KEYWORDS) || this.check("signed") || this.check("unsigned") || this.check("[")) {
      return this.parseDataType();
    }
    if (this.check("Identifier") || this.check("MacroReference")) {
      let type = this.peekNext().type;
      if (type === "Identifier" || type === "::" || type === "[") {
        if (type !== "[" || this.typeIsFollowedByName()) {
          return this.parseDataType();
        }
      }
    }
    return undefined;
  }
  parseParameterDeclaration() {
    let keyword = this.previous();
    let isLocal = keyword.type === "localparam";
    if (this.match("type")) {
      let declarations = [];
      do {
        declarations.push(this.finishTypeParameter(keyword.span, isLocal));
      } while (this.match(","));
      this.consume(";", "Expected ';' after parameter declaration");
      return declarations;
    }
    let dataType = this.parseOptionalParameterType();
    let parameters = this.parseDelimitedList({
      parseItem: () => {
        let name = this.consumeName("Expected parameter name");
        let dims = this.parseUnpackedDimensions();
        let valueExpr;
        if (this.match("=")) {
          valueExpr = this.parseExpression();
        }
        return name ? { name: name.text, valueExpr, span: name.span, dims } : null;
      },
      isItemStart: () => this.check("Identifier"),
      terminator: ";",
      missingDelimiterMessage: "Expected ',' between parameter declarations",
    });
    let end = this.consume(";", "Expected ';' after parameter declaration");
    return {
      kind: "ParameterDeclaration",
      isLocal,
      dataType,
      range: dataType?.dims?.[0]?.kind === "Range" ? dataType.dims[0] : undefined,
      parameters,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }

  // ---- Ports

  parseHeaderPorts(portNames) {
    let ports = [];
    let direction;
    let dataType;
    let isNet;
    for (; !this.check(")") && !this.isAtEnd();) {
      let start = this.peek().span;
      let cursor = this.cursor;
      let explicit = false;
      if (this.match("input", "output", "inout", "ref")) {
        direction = this.previous().type;
        explicit = true;
        dataType = undefined;
        isNet = undefined;
      } else if (this.match("const")) {
        this.match("ref");
        direction = "ref";
        explicit = true;
      }
      if (this.match(".")) {
        // Port expression: .name(signal)
        let external = this.consumeName("Expected port name after '.'");
        this.consume("(", "Expected '(' after port name");
        if (!this.check(")")) {
          this.parseExpression();
        }
        this.consume(")", "Expected ')' after port expression");
        if (external) {
          portNames.push(external.text);
          this.sawPortExpression = true;
        }
      } else if (this.isNonAnsiPortName(explicit, direction, dataType)) {
        let name = this.advance();
        portNames.push(name.text);
        for (; this.check("[");) {
          this.parseSelectDimension();
        }
      } else {
        let netType;
        if (this.checkAny(NET_TYPES)) {
          netType = this.advance().text;
          isNet = netType;
        }
        let interfaceRef = this.tryParseInterfacePortType();
        let declared = interfaceRef ? undefined : this.parsePortDataType(explicit, dataType);
        if (declared) {
          dataType = declared;
        }
        let name = this.consumeName("Expected identifier in port declaration");
        let dims = this.parseUnpackedDimensions();
        let init;
        if (this.match("=")) {
          init = this.parseExpression();
        }
        if (name) {
          portNames.push(name.text);
          ports.push({
            kind: "PortDeclaration",
            direction: direction ?? "inout",
            netType: isNet ?? (dataType ? dataType.base : undefined),
            dataType,
            interfaceRef,
            range: dataType?.dims?.[0]?.kind === "Range" ? dataType.dims[0] : undefined,
            signedness: dataType?.signedness,
            identifiers: [{ kind: "Identifier", name: name.text, span: name.span }],
            dimensions: dims.length ? dims : undefined,
            initExpr: init,
            span: this.combineSpans(start, name.span),
          });
        }
      }
      if (!this.match(",") && !this.check(")")) {
        this.addDiagnostic("Expected ',' between port declarations in module header", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        if (this.cursor === cursor) {
          this.advance();
        }
      }
    }
    return ports;
  }
  isNonAnsiPortName(explicit, direction, dataType) {
    if (explicit || direction || dataType || !this.check("Identifier")) {
      return false;
    }
    let type = this.peekNext().type;
    return type === "," || type === ")" || (type === "[" && !this.typeIsFollowedByName());
  }
  tryParseInterfacePortType() {
    if (this.match("interface")) {
      let modport;
      if (this.match(".")) {
        modport = this.consumeName("Expected modport name")?.text;
      }
      return { name: "interface", modport, generic: true };
    }
    if (this.check("Identifier") && this.peekNext().type === ".") {
      let name = this.advance();
      this.advance();
      let modport = this.consumeName("Expected modport name")?.text;
      return { name: name.text, modport, span: name.span };
    }
    return undefined;
  }
  parsePortDataType(explicit, inherited) {
    if (this.checkAny(TYPE_KEYWORDS) || this.check("signed") || this.check("unsigned") || this.check("[")) {
      return this.parseDataType();
    }
    if (this.match("var")) {
      return this.checkAny(TYPE_KEYWORDS) || this.check("Identifier") ? this.parsePortDataType(explicit, inherited) : undefined;
    }
    if ((this.check("Identifier") || this.check("MacroReference")) && this.typeIsFollowedByName()) {
      return this.parseDataType();
    }
    return undefined;
  }

  // ---- Data types

  // True when the type-like tokens at the cursor are followed by a declared name.
  typeIsFollowedByName() {
    let at = this.skipTypeTokens(this.cursor);
    if (at < 0) {
      return false;
    }
    let type = this.tokens[at]?.type;
    return type === "Identifier" || type === "EscapedIdentifier";
  }
  skipTypeTokens(from) {
    let at = from;
    let first = this.tokens[at]?.type;
    if (first !== "Identifier" && first !== "MacroReference" && first !== "EscapedIdentifier") {
      return -1;
    }
    at++;
    for (;;) {
      let type = this.tokens[at]?.type;
      if (type === "#" && this.tokens[at + 1]?.type === "(") {
        at = this.skipBalanced(at + 1, "(", ")");
      } else if (type === "::" && this.tokens[at + 1]?.type === "Identifier") {
        at += 2;
      } else {
        break;
      }
    }
    for (; this.tokens[at]?.type === "[";) {
      at = this.skipBalanced(at, "[", "]");
    }
    return at;
  }
  skipBalanced(from, open, close) {
    let depth = 0;
    for (let at = from; at < this.tokens.length; at++) {
      let type = this.tokens[at].type;
      if (type === open) {
        depth++;
      } else if (type === close) {
        depth--;
        if (depth === 0) {
          return at + 1;
        }
      } else if (type === "EOF") {
        return at;
      }
    }
    return this.tokens.length - 1;
  }
  parseDataType() {
    let start = this.peek().span;
    let token = this.peek();
    let node = { kind: "DataType", span: start, dims: [] };
    if (this.match("virtual")) {
      this.match("interface");
      node.base = "virtual";
      node.name = this.consumeName("Expected interface name")?.text;
      if (this.check("#")) {
        this.skipParameterValues();
      }
      if (this.match(".")) {
        this.consumeName("Expected modport name");
      }
      return node;
    }
    if (this.checkAny(INTEGER_VECTOR_TYPES)) {
      node.base = this.advance().text;
    } else if (this.checkAny(INTEGER_ATOM_TYPES) || this.checkAny(OTHER_TYPES)) {
      node.base = this.advance().text;
    } else if (this.check("struct") || this.check("union")) {
      this.parseStructType(node);
    } else if (this.check("enum")) {
      this.parseEnumType(node);
    } else if (this.match("type")) {
      node.base = "typeof";
      this.consume("(", "Expected '(' after 'type'");
      node.typeofExpr = this.parseTypeOrExpression();
      this.consume(")", "Expected ')' after type reference");
    } else if (this.check("signed") || this.check("unsigned") || this.check("[")) {
      node.base = "implicit";
    } else if (this.check("Identifier") || this.check("EscapedIdentifier") || this.check("MacroReference")) {
      node.base = "named";
      node.name = this.advance().text;
      if (this.check("#")) {
        this.skipParameterValues();
      }
      if (this.match("::")) {
        node.scope = node.name;
        node.name = this.consumeName("Expected type name after '::'")?.text ?? "<error>";
        if (this.check("#")) {
          this.skipParameterValues();
        }
        for (; this.match("::");) {
          node.scope = node.name;
          node.name = this.consumeName("Expected type name after '::'")?.text ?? "<error>";
        }
      }
    } else {
      this.addDiagnostic(`Expected data type but found '${token.text}'`, token.span);
      node.base = "implicit";
    }
    if (this.match("signed", "unsigned")) {
      node.signedness = this.previous().text;
    }
    for (; this.check("[");) {
      node.dims.push(this.parseSelectDimension());
    }
    node.span = this.combineSpans(start, this.previous().span);
    return node;
  }
  parseTypeOrExpression() {
    if (this.checkAny(TYPE_KEYWORDS)) {
      return this.parseDataType();
    }
    return this.parseExpression();
  }
  skipParameterValues() {
    this.consume("#", "Expected '#'");
    if (this.check("(")) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
    }
  }
  parseStructType(node) {
    node.base = this.advance().text;
    this.match("tagged");
    if (this.match("packed")) {
      node.packed = true;
    }
    if (this.match("signed", "unsigned")) {
      node.signedness = this.previous().text;
    }
    this.consume("{", `Expected '{' after '${node.base}'`);
    node.members = [];
    for (; !this.check("}") && !this.isAtEnd();) {
      let cursor = this.cursor;
      this.match("rand", "randc");
      let dataType = this.parseDataType();
      do {
        let name = this.consumeName("Expected struct member name");
        let dims = this.parseUnpackedDimensions();
        let init;
        if (this.match("=")) {
          init = this.parseExpression();
        }
        if (name) {
          node.members.push({ name: name.text, nameSpan: name.span, dataType, dims, init });
        }
      } while (this.match(","));
      this.consume(";", "Expected ';' after struct member");
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    this.consume("}", "Expected '}' after struct members");
  }
  parseEnumType(node) {
    this.advance();
    node.base = "enum";
    if (!this.check("{")) {
      node.enumBase = this.parseDataType();
    }
    this.consume("{", "Expected '{' after 'enum'");
    node.enumItems = [];
    for (; !this.check("}") && !this.isAtEnd();) {
      let cursor = this.cursor;
      let name = this.consumeName("Expected enum member name");
      let rangeExpr;
      let rangeEnd;
      if (this.match("[")) {
        rangeExpr = this.parseExpression();
        if (this.match(":")) {
          rangeEnd = this.parseExpression();
        }
        this.consume("]", "Expected ']' in enum member");
      }
      let value;
      if (this.match("=")) {
        value = this.parseExpression();
      }
      if (name) {
        node.enumItems.push(...expandEnumRange(name, value, rangeExpr, rangeEnd));
      }
      if (!this.match(",") && !this.check("}")) {
        this.addDiagnostic("Expected ',' between enum members", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
      }
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    this.consume("}", "Expected '}' after enum members");
  }
  // One bracket group: [a:b], [n], [], [$], [*], [type], [a:$]
  parseSelectDimension() {
    let open = this.consume("[", "Expected '['");
    let span = open ? open.span : this.peek().span;
    if (this.match("]")) {
      return { kind: "DynamicDimension", span };
    }
    if (this.check("*") || (this.check("SystemIdentifier") && this.peek().text === "$" && this.peekNext().type === "]")) {
      this.advance();
      this.consume("]", "Expected ']'");
      return { kind: "DynamicDimension", span };
    }
    if (this.checkAny(TYPE_KEYWORDS) && !this.check("type")) {
      this.parseDataType();
      this.consume("]", "Expected ']'");
      return { kind: "DynamicDimension", span };
    }
    let first = this.parseExpression();
    if (this.match(":")) {
      let second = this.parseExpression();
      let close = this.consume("]", "Expected ']' to close range");
      return { kind: "Range", msb: first, lsb: second, span: this.combineSpans(span, close ? close.span : second.span) };
    }
    let close = this.consume("]", "Expected ']' to close dimension");
    return { kind: "SizeDimension", size: first, span: this.combineSpans(span, close ? close.span : first.span) };
  }
  parseUnpackedDimensions() {
    let dims = [];
    for (; this.check("[");) {
      dims.push(this.parseSelectDimension());
    }
    return dims;
  }

  // ---- Items shared by packages, $unit and modules

  // `let f(a) = a;` and `nettype logic n;`: the declared name is what the rest of the file uses.
  skipNamedDeclaration() {
    let keyword = this.previous();
    let start = this.cursor;
    let depth = 0;
    let name;
    for (let at = start; at < this.tokens.length; at++) {
      let type = this.tokens[at].type;
      if (type === "(" || type === "[" || type === "{") {
        depth++;
      } else if (type === ")" || type === "]" || type === "}") {
        depth--;
      } else if (depth === 0 && (type === "Identifier" || type === "EscapedIdentifier")) {
        name = this.tokens[at];
        let next = this.tokens[at + 1]?.type;
        if (keyword.type === "let" || next === ";" || next === "with") {
          break;
        }
      } else if (depth === 0 && (type === ";" || type === "=")) {
        break;
      }
    }
    this.skipToSemicolon();
    return name
      ? { kind: "NamedRegion", regionKind: keyword.type, name: name.text, nameSpan: name.span, span: keyword.span }
      : null;
  }
  parseExport() {
    let keyword = this.previous();
    let exports = [];
    if (this.check("StringLiteral")) {
      this.skipToSemicolon();
      return null;
    }
    do {
      let pkg = this.match("*") ? this.previous() : this.consumeName("Expected package name in export");
      this.consume("::", "Expected '::' in export");
      let item = this.match("*") ? this.previous() : this.consumeName("Expected item name in export");
      if (pkg && item) {
        exports.push({ packageName: pkg.text, item: item.text });
      }
    } while (this.match(","));
    let end = this.consume(";", "Expected ';' after export");
    return { kind: "ExportDeclaration", exports, span: this.combineSpans(keyword.span, end ? end.span : this.previous().span) };
  }
  skipOutOfBlockConstraint() {
    for (; !this.check("{") && !this.check(";") && !this.isAtEnd();) {
      this.advance();
    }
    if (this.check("{")) {
      this.cursor = this.skipBalanced(this.cursor, "{", "}");
    } else {
      this.match(";");
    }
    return null;
  }
  parseDeclarationItem() {
    if (this.match(";")) {
      return null;
    }
    if (this.match("import")) {
      return this.parseImportOrDpi();
    }
    if (this.match("export")) {
      return this.parseExport();
    }
    if (this.check("constraint") || (this.check("static") && this.peekNext().type === "constraint")) {
      return this.skipOutOfBlockConstraint();
    }
    if (this.check("interface") && this.peekNext().type === "class") {
      return this.skipClass();
    }
    if (this.match("parameter", "localparam")) {
      return this.parseParameterDeclaration();
    }
    if (this.match("typedef")) {
      return this.parseTypedef();
    }
    if (this.check("function")) {
      this.advance();
      return this.parseFunctionDeclaration();
    }
    if (this.check("task")) {
      this.advance();
      return this.parseTaskDeclaration();
    }
    if (this.match("timeunit", "timeprecision")) {
      this.skipToSemicolon();
      return null;
    }
    if (this.match("nettype", "let")) {
      return this.skipNamedDeclaration();
    }
    if (this.match("bind")) {
      this.skipToSemicolon();
      return null;
    }
    if (this.check("extern") || this.check("pure")) {
      this.skipToSemicolon();
      return null;
    }
    if (this.check("class") || (this.check("virtual") && this.peekNext().type === "class")) {
      return this.skipClass();
    }
    for (let keyword of Object.keys(SKIPPED_REGIONS)) {
      if (this.check(keyword)) {
        return this.skipRegion(keyword);
      }
    }
    if (this.check("MacroReference") && !this.typeIsFollowedByName()) {
      return this.skipMacroInvocation();
    }
    if (this.isDataDeclarationStart()) {
      return this.parseDataDeclaration();
    }
    return null;
  }
  skipMacroInvocation() {
    this.advance();
    if (this.check("(")) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
    }
    this.match(";");
    return null;
  }
  skipToSemicolon() {
    let depth = 0;
    for (; !this.isAtEnd();) {
      let type = this.peek().type;
      if (type === "(" || type === "{" || type === "[" || type === "'{" || type === "'(") {
        depth++;
      } else if (type === ")" || type === "}" || type === "]") {
        depth--;
      } else if (type === ";" && depth <= 0) {
        this.advance();
        return;
      }
      this.advance();
    }
  }
  skipRegion(keyword) {
    let end = SKIPPED_REGIONS[keyword];
    let start = this.advance();
    let regionName = this.check("Identifier") ? this.peek() : undefined;
    let depth = 1;
    for (; !this.isAtEnd() && depth > 0;) {
      let type = this.peek().type;
      if (type === keyword) {
        depth++;
      } else if (type === end) {
        depth--;
      }
      this.advance();
    }
    if (depth > 0) {
      this.addDiagnostic(`Expected '${end}' to close ${keyword}`, start.span);
    }
    this.skipEndLabel(regionName?.text);
    return regionName
      ? { kind: "NamedRegion", regionKind: keyword, name: regionName.text, nameSpan: regionName.span, span: start.span }
      : null;
  }
  // `default clocking name;` refers to a block declared elsewhere; other forms declare one.
  parseDefaultClocking() {
    if (this.tokens[this.cursor + 1]?.type === "Identifier" && this.tokens[this.cursor + 2]?.type === ";") {
      this.skipToSemicolon();
      return null;
    }
    return this.skipRegion("clocking");
  }
  skipClass() {
    let start = this.peek().span;
    this.match("virtual", "interface");
    this.advance();
    let name = this.match("Identifier", "EscapedIdentifier") ? this.previous() : null;
    let baseName = this.classBaseName();
    let depth = 1;
    for (; !this.isAtEnd() && depth > 0;) {
      let type = this.peek().type;
      if (type === "class" && this.tokens[this.cursor - 1]?.type !== "typedef") {
        depth++;
      } else if (type === "endclass") {
        depth--;
      }
      this.advance();
    }
    if (depth > 0) {
      this.addDiagnostic("Expected 'endclass' to close class", start);
    }
    let span = this.combineSpans(start, this.previous().span);
    this.skipEndLabel(name?.text);
    return { kind: "ClassDeclaration", name: name?.text ?? "<error>", nameSpan: name?.span ?? start, baseName, span };
  }
  classBaseName() {
    let at = this.cursor;
    if (this.tokens[at]?.type === "#" && this.tokens[at + 1]?.type === "(") {
      at = this.skipBalanced(at + 1, "(", ")");
    }
    let base = this.tokens[at + 1];
    // A scoped base such as uvm_pkg::uvm_object is left to the package check.
    return this.tokens[at]?.type === "extends" && base?.type === "Identifier" && this.tokens[at + 2]?.type !== "::" ? base : undefined;
  }
  parseImportOrDpi() {
    let keyword = this.previous();
    if (this.check("StringLiteral")) {
      let name;
      for (let at = this.cursor; at < this.tokens.length && this.tokens[at].type !== ";"; at++) {
        if (this.tokens[at].type === "Identifier" && ["(", ";"].includes(this.tokens[at + 1]?.type)) {
          name = this.tokens[at];
          break;
        }
      }
      this.skipToSemicolon();
      return name ? { kind: "NamedRegion", regionKind: "let", name: name.text, nameSpan: name.span, span: keyword.span } : null;
    }
    let imports = [];
    do {
      let pkg = this.consumeName("Expected package name in import");
      this.consume("::", "Expected '::' in package import");
      let item;
      if (this.match("*")) {
        item = "*";
      } else {
        item = this.consumeName("Expected imported identifier")?.text;
      }
      if (pkg && item) {
        imports.push({ packageName: pkg.text, packageSpan: pkg.span, item });
      }
    } while (this.match(","));
    let end = this.consume(";", "Expected ';' after import");
    return {
      kind: "ImportDeclaration",
      imports,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  forwardTypedef(keyword) {
    let at = this.cursor;
    if (["enum", "struct", "union", "class", "interface"].includes(this.tokens[at]?.type)) {
      at += this.tokens[at]?.type === "interface" && this.tokens[at + 1]?.type === "class" ? 2 : 1;
    }
    if (this.tokens[at]?.type !== "Identifier" || this.tokens[at + 1]?.type !== ";") {
      return null;
    }
    let name = this.tokens[at];
    this.cursor = at + 2;
    return { kind: "NamedRegion", regionKind: "typedef", isForward: true, name: name.text, nameSpan: name.span, span: keyword.span };
  }
  parseTypedef() {
    let keyword = this.previous();
    let forward = this.forwardTypedef(keyword);
    if (forward) {
      return forward;
    }
    if (this.match("enum", "struct", "union", "class") && (this.check("Identifier") && this.peekNext().type === ";")) {
      this.advance();
      this.advance();
      return null;
    }
    if (this.previous().type === "enum" || this.previous().type === "struct" || this.previous().type === "union") {
      this.cursor--;
    } else if (this.previous().type === "class") {
      this.skipToSemicolon();
      return null;
    }
    if (this.match("interface")) {
      this.skipToSemicolon();
      return null;
    }
    if (this.check("Identifier") && this.peekNext().type === ";") {
      this.advance();
      this.advance();
      return null;
    }
    let dataType = this.parseDataType();
    let name = this.consumeName("Expected type name in typedef");
    let dims = this.parseUnpackedDimensions();
    let end = this.consume(";", "Expected ';' after typedef");
    if (!name) {
      return null;
    }
    return {
      kind: "TypedefDeclaration",
      name: name.text,
      nameSpan: name.span,
      dataType,
      dims,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  isDataDeclarationStart() {
    if (this.checkAny(LIFETIME_AND_QUALIFIERS) || this.checkAny(NET_TYPES) || this.checkAny(TYPE_KEYWORDS)) {
      if (this.check("type")) {
        return true;
      }
      if (this.check("virtual") && this.peekNext().type === "class") {
        return false;
      }
      return true;
    }
    if (this.check("signed") || this.check("unsigned")) {
      return true;
    }
    if (this.check("Identifier") || this.check("EscapedIdentifier") || this.check("MacroReference")) {
      if (!this.typeIsFollowedByName()) {
        return false;
      }
      let at = this.skipTypeTokens(this.cursor);
      let after = this.tokens[at + 1]?.type;
      if (after === "(") {
        return false;
      }
      if (after === "[") {
        let close = at + 1;
        for (; this.tokens[close]?.type === "[";) {
          close = this.skipBalanced(close, "[", "]");
        }
        return this.tokens[close]?.type !== "(";
      }
      return after === ";" || after === "," || after === "=";
    }
    return false;
  }
  parseDataDeclaration() {
    let start = this.peek().span;
    let qualifiers = [];
    for (; this.checkAny(LIFETIME_AND_QUALIFIERS);) {
      qualifiers.push(this.advance().text);
    }
    let netType;
    if (this.checkAny(NET_TYPES)) {
      netType = this.advance().text;
      if (this.check("(") && STRENGTHS.includes(this.peekNext().type)) {
        this.cursor = this.skipBalanced(this.cursor, "(", ")");
      }
      this.match("vectored", "scalared");
      if (this.match("#")) {
        this.skipDelayValue();
      }
    }
    let dataType;
    if (netType && this.check("Identifier") && !this.typeIsFollowedByName()) {
      dataType = { kind: "DataType", base: "implicit", dims: [], span: start };
    } else if (!netType && this.check("Identifier") && !this.typeIsFollowedByName()) {
      // Implicit type after a qualifier: `var x;`
      dataType = { kind: "DataType", base: "logic", dims: [], span: start };
    } else {
      dataType = this.parseDataType();
    }
    if (netType && this.match("#")) {
      this.skipDelayValue();
    }
    let identifiers = [];
    let declarators = [];
    for (; !this.check(";") && !this.isAtEnd();) {
      let name = this.consumeName("Expected identifier in declaration");
      if (!name) {
        break;
      }
      let dims = this.parseUnpackedDimensions();
      let init;
      if (this.match("=")) {
        init = this.check("new") ? this.parseExpression() : this.parseExpression();
      }
      identifiers.push({ kind: "Identifier", name: name.text, span: name.span });
      declarators.push({ name: name.text, nameSpan: name.span, dims, init });
      if (this.check(",")) {
        if (this.peekNext().type === ";") {
          this.advance();
          this.addDiagnostic("Unexpected trailing comma", this.previous().span, "error", "SYNTAX-TRAILING-COMMA");
          break;
        }
        this.advance();
        continue;
      }
      if (this.check("Identifier")) {
        this.addDiagnostic("Expected ',' between net identifiers", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        continue;
      }
      break;
    }
    let end = this.consume(";", "Expected ';' after declaration");
    return {
      kind: "DataDeclaration",
      netType,
      qualifiers,
      dataType,
      identifiers,
      declarators,
      span: this.combineSpans(start, end ? end.span : this.previous().span),
    };
  }

  // ---- Module items

  parseModuleItem() {
    if (this.match(";")) {
      return null;
    }
    if (this.check("Identifier") && this.peekNext().type === ":" && this.isAssertionKeyword(this.cursor + 2)) {
      this.advance();
      this.advance();
    }
    if (this.isConcurrentAssertion(this.cursor)) {
      return this.parseConcurrentAssertion();
    }
    if (this.isAssertionKeyword(this.cursor)) {
      // Deferred assertions and `assert (...)` are allowed directly in a module body.
      let statement = this.parseImmediateAssertion();
      return { kind: "AssertionItem", span: statement.span };
    }
    if (this.check("SystemIdentifier") && this.peekNext().type === "(") {
      // Elaboration system tasks such as $error and $info.
      let keyword = this.advance();
      this.skipToSemicolon();
      return { kind: "AssertionItem", span: keyword.span };
    }
    if (this.match("input", "output", "inout", "ref")) {
      return this.parseBodyPortDeclaration();
    }
    if (this.match("assign")) {
      return this.parseContinuousAssignList();
    }
    if (this.check("always") || this.check("always_comb") || this.check("always_ff") || this.check("always_latch")) {
      this.advance();
      return this.parseAlwaysBlock();
    }
    if (this.match("initial", "final")) {
      let kind = this.previous().type;
      let block = this.parseInitialBlock();
      block.blockKind = kind;
      return block;
    }
    if (this.match("generate")) {
      return this.parseGenerateBlock();
    }
    if (this.match("genvar")) {
      return this.parseGenvarDeclaration();
    }
    if (this.check("for") || this.check("if") || this.check("case") || this.check("begin")) {
      return this.parseGenerateItem();
    }
    if (this.match("modport")) {
      return this.parseModportDeclaration();
    }
    if (this.match("defparam", "alias")) {
      this.skipToSemicolon();
      return null;
    }
    if (this.check("default")) {
      if (this.peekNext().type === "clocking") {
        this.advance();
        return this.parseDefaultClocking();
      }
      this.skipToSemicolon();
      return null;
    }
    if (this.check("interface") && this.peekNext().type === "class") {
      return this.skipClass();
    }
    // A nested definition behaves like a top-level one for every purpose this extension has.
    if (this.match("interface")) {
      this.pushIfPresent(this.nestedUnits, this.parseDesignUnit("interface", "endinterface"));
      return null;
    }
    if (this.match("module", "macromodule")) {
      this.pushIfPresent(this.nestedUnits, this.parseDesignUnit("module", "endmodule"));
      return null;
    }
    if (this.match("program")) {
      this.pushIfPresent(this.nestedUnits, this.parseDesignUnit("program", "endprogram"));
      return null;
    }
    if (this.check("global")) {
      return this.skipGlobalClocking();
    }
    if (this.checkAny(GATE_LIKE)) {
      this.skipToSemicolon();
      return null;
    }
    if (this.checkAny(["and", "nand", "nor", "xor", "xnor", "not", "buf", "bufif0", "bufif1", "notif0", "notif1"])) {
      return this.parseGateInstantiation();
    }
    if (this.isSpecparam()) {
      this.advance();
      return this.skipNamedDeclaration();
    }
    let declaration = this.parseDeclarationItem();
    if (declaration !== null && declaration !== undefined) {
      return declaration;
    }
    if (this.previous().type === ";" || this.tokensConsumedByDeclaration) {
      this.tokensConsumedByDeclaration = false;
    }
    if (this.isInstanceStart()) {
      return this.parseInstanceList();
    }
    return null;
  }
  skipGlobalClocking() {
    for (; !this.check("endclocking") && !this.check(";") && !this.isAtEnd();) {
      this.advance();
    }
    if (this.match(";") && this.check("endclocking")) {
      this.advance();
      this.skipEndLabel();
    }
    return null;
  }
  isSpecparam() {
    return this.check("specparam");
  }
  pushNested(endKeyword) {
    let depth = 1;
    let open = this.previous().type;
    for (; !this.isAtEnd() && depth > 0;) {
      let type = this.peek().type;
      if (type === open) {
        depth++;
      } else if (type === endKeyword) {
        depth--;
      }
      this.advance();
    }
    this.skipEndLabel();
  }
  isAssertionKeyword(at) {
    let type = this.tokens[at]?.type;
    return type === "assert" || type === "assume" || type === "cover" || type === "restrict" || type === "expect";
  }
  isConcurrentAssertion(at) {
    let type = this.tokens[at]?.type;
    if (type !== "assert" && type !== "assume" && type !== "cover" && type !== "restrict" && type !== "expect") {
      return false;
    }
    let next = this.tokens[at + 1]?.type;
    return next === "property" || next === "sequence";
  }
  parseConcurrentAssertion() {
    let start = this.advance();
    this.advance();
    if (this.check("(")) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
    }
    if (this.match(";")) {
      return { kind: "AssertionItem", span: start.span };
    }
    if (!this.check("else")) {
      this.parseStatement();
    }
    if (this.match("else")) {
      this.parseStatement();
    }
    return { kind: "AssertionItem", span: start.span };
  }
  parseContinuousAssignList() {
    let keyword = this.previous();
    if (this.check("(") && STRENGTHS.includes(this.peekNext().type)) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
    }
    if (this.match("#")) {
      this.skipDelayValue();
    }
    let assigns = [];
    do {
      let lhs = this.parseLhs();
      this.consume("=", "Expected '=' in continuous assignment");
      let rhs = this.parseExpression();
      assigns.push({
        kind: "ContinuousAssign",
        lhs,
        rhs,
        span: this.combineSpans(assigns.length ? lhs.span : keyword.span, rhs.span),
      });
    } while (this.match(","));
    let end = this.consume(";", "Expected ';' after continuous assignment");
    if (end) {
      let last = assigns[assigns.length - 1];
      last.span = this.combineSpans(last.span, end.span);
    }
    return assigns;
  }
  parseBodyPortDeclaration() {
    let keyword = this.previous();
    let netType;
    if (this.checkAny(NET_TYPES)) {
      netType = this.advance().text;
    }
    let dataType;
    if (this.checkAny(TYPE_KEYWORDS) || this.check("signed") || this.check("unsigned") || this.check("[")) {
      dataType = this.parseDataType();
    } else if (this.check("Identifier") && this.typeIsFollowedByName()) {
      dataType = this.parseDataType();
    }
    let identifiers = [];
    do {
      let name = this.consumeName("Expected identifier in port declaration");
      this.parseUnpackedDimensions();
      if (this.match("=")) {
        this.parseExpression();
      }
      if (name) {
        identifiers.push({ kind: "Identifier", name: name.text, span: name.span });
      }
    } while (this.match(","));
    let end = this.consume(";", "Expected ';' after port declaration");
    return {
      kind: "PortDeclaration",
      direction: keyword.text,
      netType: netType ?? dataType?.base,
      dataType,
      range: dataType?.dims?.[0]?.kind === "Range" ? dataType.dims[0] : undefined,
      signedness: dataType?.signedness,
      identifiers,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  parseModportDeclaration() {
    let keyword = this.previous();
    let modports = [];
    do {
      let name = this.consumeName("Expected modport name");
      let ports = [];
      this.consume("(", "Expected '(' after modport name");
      let direction;
      for (; !this.check(")") && !this.isAtEnd();) {
        let cursor = this.cursor;
        if (this.match("input", "output", "inout", "ref")) {
          direction = this.previous().type;
        } else if (this.match("import", "export", "clocking")) {
          direction = this.previous().type;
          if (this.match("task", "function")) {
            direction = "import";
          }
        }
        if (this.match(".")) {
          let port = this.consumeName("Expected port name after '.'");
          this.consume("(", "Expected '(' after modport port name");
          if (!this.check(")")) {
            this.parseExpression();
          }
          this.consume(")", "Expected ')' after modport expression");
          if (port) {
            ports.push({ direction, name: port.text, isExpression: true });
          }
        } else {
          let port = this.consumeName("Expected modport port name");
          if (port) {
            ports.push({ direction, name: port.text });
          }
        }
        if (!this.match(",") && !this.check(")") && this.cursor === cursor) {
          this.advance();
        }
      }
      this.consume(")", "Expected ')' after modport ports");
      if (name) {
        modports.push({ name: name.text, nameSpan: name.span, ports });
      }
    } while (this.match(","));
    let end = this.consume(";", "Expected ';' after modport");
    return {
      kind: "ModportDeclaration",
      modports,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  isInstanceStart() {
    if (!(this.check("Identifier") || this.check("EscapedIdentifier") || this.check("MacroReference"))) {
      return false;
    }
    let type = this.peekNext().type;
    if (type === "#") {
      return true;
    }
    if (type !== "Identifier" && type !== "EscapedIdentifier") {
      return false;
    }
    let at = this.cursor + 2;
    for (; this.tokens[at]?.type === "[";) {
      at = this.skipBalanced(at, "[", "]");
    }
    return this.tokens[at]?.type === "(";
  }
  parseInstanceList() {
    let moduleToken = this.advance();
    let parameterOverrides;
    if (this.match("#")) {
      if (this.check("(")) {
        parameterOverrides = this.parseParameterValues();
      } else {
        this.advance();
      }
    }
    let instances = [];
    do {
      let name = this.consumeName("Expected instance name after module type");
      if (!name) {
        break;
      }
      let dims = this.parseUnpackedDimensions();
      this.consume("(", "Expected '(' after instance name");
      let connections = this.parseInstanceConnections();
      let close = this.consume(")", "Expected ')' after instance connections");
      instances.push({
        kind: "InstanceDeclaration",
        moduleName: moduleToken.text,
        moduleNameSpan: moduleToken.span,
        instanceName: name.text,
        instanceNameSpan: name.span,
        instanceDims: dims.length ? dims : undefined,
        parameterOverrides,
        portConnections: connections,
        span: this.combineSpans(moduleToken.span, close ? close.span : this.previous().span),
      });
    } while (this.match(","));
    let end = this.consume(";", "Expected ';' after module instantiation");
    if (end && instances.length) {
      let last = instances[instances.length - 1];
      last.span = this.combineSpans(last.span, end.span);
    }
    return instances;
  }
  parseParameterValues() {
    this.consume("(", "Expected '('");
    let overrides = [];
    let position = 0;
    for (; !this.check(")") && !this.isAtEnd();) {
      let cursor = this.cursor;
      if (this.match(".")) {
        let name = this.consumeName("Expected parameter name after '.'");
        this.consume("(", "Expected '(' after parameter name");
        let value;
        if (!this.check(")")) {
          value = this.parseTypeOrExpressionArgument();
        }
        this.consume(")", "Expected ')' after parameter value");
        overrides.push({ name: name?.text, value });
      } else {
        overrides.push({ position: position++, value: this.parseTypeOrExpressionArgument() });
      }
      if (!this.match(",") && !this.check(")") && this.cursor === cursor) {
        this.advance();
      }
    }
    this.consume(")", "Expected ')' after parameter values");
    return overrides;
  }
  parseTypeOrExpressionArgument() {
    if (this.checkAny(TYPE_KEYWORDS) && !this.isCastAhead()) {
      return this.parseDataType();
    }
    return this.parseExpression();
  }
  isCastAhead() {
    return this.peekNext().type === "'(";
  }
  parseInstanceConnections() {
    let position = 0;
    let connections = [];
    for (; !this.check(")") && !this.isAtEnd();) {
      let cursor = this.cursor;
      if (this.match(".*")) {
        connections.push({ kind: "WildcardPortConnection", span: this.previous().span });
      } else if (this.match(".")) {
        let port = this.consumeName("Expected port name after .");
        if (this.match("(")) {
          let expression;
          if (!this.check(")")) {
            expression = this.parseExpression();
          }
          let close = this.consume(")", "Expected ')' after port connection expression");
          if (port) {
            connections.push({
              kind: "NamedPortConnection",
              portName: port.text,
              portNameSpan: port.span,
              expression,
              span: this.combineSpans(port.span, close ? close.span : port.span),
            });
          }
        } else if (port) {
          connections.push({
            kind: "NamedPortConnection",
            portName: port.text,
            portNameSpan: port.span,
            implicit: true,
            expression: { kind: "Identifier", name: port.text, span: port.span },
            span: port.span,
          });
        }
      } else if (this.check(",")) {
        connections.push({ kind: "NamedPortConnection", portName: `__pos_${position++}`, span: this.peek().span });
      } else {
        let expression = this.parseExpression();
        connections.push({
          kind: "NamedPortConnection",
          portName: `__pos_${position++}`,
          expression,
          span: expression.span,
        });
      }
      if (this.match(",")) {
        if (this.check(")")) {
          this.addDiagnostic("Unexpected trailing comma", this.previous().span, "error", "SYNTAX-TRAILING-COMMA");
        }
      } else if (!this.check(")")) {
        this.addDiagnostic("Expected ',' between port connections", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        if (this.cursor === cursor) {
          this.advance();
        }
      }
    }
    return connections;
  }
  parseGateInstantiation() {
    let gate = this.peek();
    let at = this.cursor + 1;
    if (this.tokens[at]?.type === "(" && STRENGTHS.includes(this.tokens[at + 1]?.type)) {
      at = this.skipBalanced(at, "(", ")");
    }
    if (this.tokens[at]?.type === "#") {
      // Rewrite: gate [strength] #delay → gate, then reuse the Verilog parser for the instances.
      this.cursor = at;
      this.advance();
      this.skipDelayValue();
      this.cursor--;
      let saved = this.tokens[this.cursor];
      this.tokens[this.cursor] = gate;
      try {
        return super.parseGateInstantiation();
      } finally {
        this.tokens[this.cursor - 0] = this.tokens[this.cursor - 0];
        void saved;
      }
    }
    if (at !== this.cursor + 1) {
      this.cursor = at - 1;
      this.tokens[this.cursor] = gate;
    }
    return super.parseGateInstantiation();
  }
  skipDelayValue() {
    if (this.check("(")) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
    } else if (this.check("NumberLiteral") || this.check("Identifier") || this.check("UnbasedLiteral")) {
      this.advance();
    }
  }

  // ---- Generate constructs

  parseGenerateBlock() {
    let keyword = this.previous();
    let items = [];
    let statements = [];
    for (; !this.check("endgenerate") && !this.isAtEnd();) {
      let cursor = this.cursor;
      try {
        if (this.check("for") || this.check("if") || this.check("case") || this.check("begin")) {
          statements.push(this.parseGenerateItem());
        } else {
          this.pushItems(items, this.parseModuleItem());
        }
      } catch {
        this.synchronize([";", "endgenerate"]);
      }
      if (this.cursor === cursor) {
        this.addDiagnostic(`Unexpected token '${this.peek().text}' in generate block`, this.peek().span);
        this.advance();
      }
    }
    let end = this.consume("endgenerate", "Expected 'endgenerate' to close generate block");
    return {
      kind: "GenerateBlock",
      items,
      statements,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  parseGenerateItem() {
    if (this.match("for")) {
      return this.parseGenerateFor();
    }
    if (this.match("if")) {
      return this.parseGenerateIf();
    }
    if (this.match("case")) {
      return this.parseGenerateCase();
    }
    if (this.match("begin")) {
      return this.parseGenerateBegin();
    }
    let start = this.peek().span;
    let items = [];
    this.pushItems(items, this.parseModuleItem());
    return {
      kind: "GenerateBlockStatement",
      items,
      statements: [],
      span: items.length ? items[0].span : start,
    };
  }
  parseGenerateBegin() {
    let keyword = this.previous();
    let name;
    if (this.match(":")) {
      name = this.consumeName("Expected block name after ':' in generate block")?.text;
    }
    let items = [];
    let statements = [];
    for (; !this.check("end") && !this.isAtEnd();) {
      let cursor = this.cursor;
      try {
        if (this.check("for") || this.check("if") || this.check("case") || this.check("begin")) {
          let item = this.parseGenerateItem();
          statements.push(item);
        } else {
          this.pushItems(items, this.parseModuleItem());
        }
      } catch {
        this.synchronize([";", "end"]);
      }
      if (this.cursor === cursor) {
        this.addDiagnostic(`Unexpected token '${this.peek().text}' in generate block`, this.peek().span);
        this.advance();
      }
    }
    let end = this.consume("end", "Expected 'end' to close generate block");
    this.skipEndLabel(name);
    return {
      kind: "GenerateBlockStatement",
      name,
      items,
      statements,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  parseGenerateFor() {
    let keyword = this.previous();
    this.consume("(", "Expected '(' after 'for'");
    this.match("genvar");
    let declaresGenvar = this.previous().type === "genvar";
    let initExpr = this.parseForAssignment();
    this.consume(";", "Expected ';' after for-loop initialisation");
    let condition = this.parseExpression();
    this.consume(";", "Expected ';' after for-loop condition");
    let stepExpr = this.parseForAssignment();
    this.consume(")", "Expected ')' after for-loop header");
    let body = this.parseGenerateItem();
    return {
      kind: "GenerateLoopStatement",
      declaresGenvar,
      loopKind: "for",
      initExpr,
      condition,
      stepExpr,
      body,
      span: this.combineSpans(keyword.span, body.span),
    };
  }
  parseGenerateIf() {
    let keyword = this.previous();
    this.consume("(", "Expected '(' after 'if'");
    let condition = this.parseExpression();
    this.consume(")", "Expected ')' after if condition");
    let thenBlock = this.parseGenerateItem();
    let elseBlock;
    if (this.match("else")) {
      elseBlock = this.parseGenerateItem();
    }
    return {
      kind: "GenerateIfStatement",
      condition,
      thenBlock,
      elseBlock,
      span: this.combineSpans(keyword.span, (elseBlock ?? thenBlock).span),
    };
  }
  parseGenerateCase() {
    let keyword = this.previous();
    this.consume("(", "Expected '(' after 'case'");
    let expression = this.parseExpression();
    this.consume(")", "Expected ')' after case expression");
    let items = [];
    for (; !this.check("endcase") && !this.isAtEnd();) {
      let cursor = this.cursor;
      let patterns = [];
      let isDefault = false;
      if (this.match("default")) {
        isDefault = true;
        this.match(":");
      } else {
        patterns = this.parseDelimitedList({
          parseItem: () => this.parseExpression(),
          isItemStart: () => this.isExpressionStart(),
          terminator: ":",
          missingDelimiterMessage: "Expected ',' between case item patterns",
        });
        this.consume(":", "Expected ':' after case item patterns");
      }
      let body = this.parseGenerateItem();
      items.push({ patterns, isDefault, body });
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    let end = this.consume("endcase", "Expected 'endcase' to close case statement");
    return {
      kind: "GenerateCaseStatement",
      expression,
      items,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }

  // ---- Procedural blocks

  parseAlwaysBlock() {
    let keyword = this.previous();
    let sensitivities = [];
    let isSequential = false;
    let delayExpr;
    let hasEventControl = false;
    if (this.check("#")) {
      this.advance();
      delayExpr = this.parseDelayExpression();
    } else if (this.check("@") || this.check("@@")) {
      hasEventControl = true;
      let events = this.parseEventControl();
      sensitivities = events.sensitivities;
      isSequential = events.isSequential;
    }
    if (keyword.type === "always_comb" || keyword.type === "always_latch") {
      sensitivities = [{ kind: "SensitivityItem", edge: "all", span: keyword.span }];
    }
    let statement = this.parseStatement();
    return {
      kind: "AlwaysBlock",
      alwaysKind: keyword.type,
      hasEventControl,
      isSequential: isSequential || (keyword.type === "always_ff" && sensitivities.length > 0),
      sensitivities,
      delayExpr,
      statement,
      span: this.combineSpans(keyword.span, statement.span),
    };
  }
  parseDelayExpression() {
    if (this.match("(")) {
      let expression = this.parseExpression();
      if (this.match(":")) {
        this.parseExpression();
        this.consume(":", "Expected ':' in min:typ:max delay");
        this.parseExpression();
      }
      this.consume(")", "Expected ')' after delay expression");
      return expression;
    }
    if (this.check("NumberLiteral") || this.check("Identifier") || this.check("MacroReference")) {
      return this.parsePrimaryNoPostfixCall();
    }
    if (this.check("UnbasedLiteral")) {
      return this.parsePrimary();
    }
    return undefined;
  }
  parsePrimaryNoPostfixCall() {
    let token = this.advance();
    if (token.type === "NumberLiteral") {
      // `1step` lexes as a number followed by the identifier `step`.
      if (this.check("Identifier") && this.peek().text === "step") {
        this.advance();
      }
      let literal = this.parseNumericLiteral(token.text);
      return { kind: "NumberLiteral", raw: token.text, value: literal.value, bitWidth: literal.bitWidth, span: token.span };
    }
    let node = { kind: "Identifier", name: token.text, span: token.span };
    for (; this.match("::");) {
      let member = this.consumeName("Expected identifier after '::'");
      node = { kind: "ScopedIdentifier", scope: node.name, name: member?.text ?? "<error>", span: this.combineSpans(token.span, this.previous().span) };
    }
    return node;
  }
  // '@' / '@*' / '@(...)' / '@id' with `iff` and arbitrary event expressions.
  parseEventControl() {
    this.advance();
    let sensitivities = [];
    let isSequential = false;
    if (this.match("*")) {
      sensitivities.push({ kind: "SensitivityItem", edge: "all", span: this.previous().span });
      return { sensitivities, isSequential };
    }
    if (this.check("Identifier") || this.check("MacroReference")) {
      let expression = this.parsePrimary();
      sensitivities.push({
        kind: "SensitivityItem",
        edge: "none",
        signal: this.sensitivitySignal(expression),
        span: expression.span,
      });
      return { sensitivities, isSequential };
    }
    this.consume("(", "Expected '(' after '@'");
    if (this.match("*")) {
      sensitivities.push({ kind: "SensitivityItem", edge: "all", span: this.previous().span });
      this.consume(")", "Expected ')' after sensitivity list");
      return { sensitivities, isSequential };
    }
    for (; !this.check(")") && !this.isAtEnd();) {
      let cursor = this.cursor;
      let edge = "none";
      let span = this.peek().span;
      if (this.match("posedge", "negedge", "edge")) {
        edge = this.previous().type;
        isSequential = true;
      }
      let expression = this.parseExpression();
      if (this.match("iff")) {
        this.parseExpression();
      }
      sensitivities.push({
        kind: "SensitivityItem",
        edge,
        signal: this.sensitivitySignal(expression),
        span: this.combineSpans(span, expression.span),
      });
      if (!this.match("or", ",") && !this.check(")")) {
        this.addDiagnostic("Expected 'or' or ',' between signals in sensitivity list", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        if (this.cursor === cursor) {
          this.advance();
        }
      }
    }
    this.consume(")", "Expected ')' after sensitivity list");
    return { sensitivities, isSequential };
  }
  sensitivitySignal(expression) {
    if (expression.kind === "Identifier") {
      return expression;
    }
    if (expression.kind === "BitSelect" || expression.kind === "PartSelect") {
      let base = expression;
      for (; base.kind === "BitSelect" || base.kind === "PartSelect";) {
        base = base.target;
      }
      if (base.kind === "Identifier") {
        return { kind: "Identifier", name: base.name, span: expression.span };
      }
    }
    return undefined;
  }

  // ---- Functions and tasks

  parseFunctionDeclaration() {
    let keyword = this.previous();
    let lifetime = this.match("automatic", "static") ? this.previous().text : undefined;
    let returnType;
    if (this.match("new")) {
      this.skipSubroutineWithoutBody("endfunction");
      return null;
    }
    let nameFollows = (this.check("Identifier") || this.check("EscapedIdentifier")) && ["(", ";", "::"].includes(this.peekNext().type);
    if (nameFollows && this.peekNext().type === "::") {
      let at = this.cursor;
      for (; this.tokens[at]?.type === "Identifier" && this.tokens[at + 1]?.type === "::";) {
        at += 2;
      }
      nameFollows = ["(", ";"].includes(this.tokens[at + 1]?.type) || this.tokens[at]?.type === "new";
    }
    if (!nameFollows) {
      returnType = this.parseDataType();
    }
    return this.parseSubroutineRest("function", "endfunction", keyword, lifetime, returnType);
  }
  parseTaskDeclaration() {
    let keyword = this.previous();
    let lifetime = this.match("automatic", "static") ? this.previous().text : undefined;
    return this.parseSubroutineRest("task", "endtask", keyword, lifetime);
  }
  skipSubroutineWithoutBody(end) {
    for (; !this.check(end) && !this.isAtEnd();) {
      this.advance();
    }
    this.match(end);
    this.skipEndLabel();
  }
  parseSubroutineRest(kind, endKeyword, keyword, lifetime, returnType) {
    let name = this.consumeName(`Expected ${kind} name`);
    let outOfBlock = false;
    for (; this.match("::");) {
      name = this.match("new") ? this.previous() : this.consumeName(`Expected ${kind} name`);
      outOfBlock = true;
    }
    let ports = [];
    if (this.match("(")) {
      if (!this.check(")")) {
        ports.push(...this.parseSubroutinePorts());
      }
      this.consume(")", `Expected ')' after ${kind} port list`);
    }
    this.consume(";", `Expected ';' after ${kind} header`);
    let statements = [];
    for (; !this.check(endKeyword) && !this.isAtEnd();) {
      let cursor = this.cursor;
      try {
        if (this.match("input", "output", "inout", "ref")) {
          ports.push(this.parseBodyPortDeclaration());
        } else {
          statements.push(this.parseStatement());
        }
      } catch {
        this.synchronize([";", endKeyword]);
      }
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    let end = this.consume(endKeyword, `Expected '${endKeyword}' to close ${kind}`);
    this.skipEndLabel(name?.text);
    let span = this.combineSpans(keyword.span, end ? end.span : this.previous().span);
    // An out-of-block method belongs to its class, whose body this extension does not model.
    if (outOfBlock) {
      return null;
    }
    if (kind === "function") {
      return {
        kind: "FunctionDeclaration",
        name: name ? name.text : "<error>",
        nameSpan: name ? name.span : undefined,
        lifetime,
        returnDataType: returnType,
        range: returnType?.dims?.[0]?.kind === "Range" ? returnType.dims[0] : undefined,
        signedness: returnType?.signedness,
        returnType: returnType?.base,
        ports,
        statements,
        span,
      };
    }
    return {
      kind: "TaskDeclaration",
      name: name ? name.text : "<error>",
      nameSpan: name ? name.span : undefined,
      isAutomatic: lifetime === "automatic",
      ports,
      statements,
      span,
    };
  }
  parseSubroutinePorts() {
    let ports = [];
    let direction = "input";
    let dataType;
    for (; !this.check(")") && !this.isAtEnd();) {
      let cursor = this.cursor;
      let start = this.peek().span;
      let explicit = false;
      if (this.match("const")) {
        direction = "ref";
        explicit = true;
        this.match("ref");
      } else if (this.match("input", "output", "inout", "ref")) {
        direction = this.previous().type;
        explicit = true;
      }
      this.match("var");
      if (explicit) {
        dataType = undefined;
      }
      if (this.checkAny(TYPE_KEYWORDS) || this.check("signed") || this.check("unsigned") || this.check("[")) {
        dataType = this.parseDataType();
      } else if (this.check("Identifier") && this.typeIsFollowedByName()) {
        dataType = this.parseDataType();
      }
      let name = this.consumeName("Expected identifier in port declaration");
      let dimensions = this.parseUnpackedDimensions();
      let hasDefault = false;
      if (this.match("=")) {
        this.parseExpression();
        hasDefault = true;
      }
      if (name) {
        ports.push({
          kind: "PortDeclaration",
          hasDefault,
          dimensions: dimensions.length ? dimensions : undefined,
          direction,
          netType: dataType?.base,
          dataType,
          range: dataType?.dims?.[0]?.kind === "Range" ? dataType.dims[0] : undefined,
          signedness: dataType?.signedness,
          identifiers: [{ kind: "Identifier", name: name.text, span: name.span }],
          span: this.combineSpans(start, name.span),
        });
      }
      if (!this.match(",") && !this.check(")")) {
        this.addDiagnostic("Expected ',' between function port declarations", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        if (this.cursor === cursor) {
          this.advance();
        }
      }
    }
    return ports;
  }

  // ---- Statements

  parseStatementInner() {
    if (this.check("Identifier") && this.peekNext().type === ":" && !this.isCaseItemContext) {
      // Statement label.
      let after = this.tokens[this.cursor + 2]?.type;
      if (after !== undefined) {
        this.statementLabel = this.advance().text;
        this.advance();
      }
    }
    if (this.match("begin")) {
      return this.parseBlock("begin", "end");
    }
    if (this.match("fork")) {
      return this.parseBlock("fork", "join");
    }
    if (this.match("unique", "unique0", "priority")) {
      let qualifier = this.previous().text;
      let statement = this.parseStatementInner();
      if (statement.kind === "IfStatement" || statement.kind === "CaseStatement") {
        statement.qualifier = qualifier;
      }
      return statement;
    }
    if (this.match("if")) {
      let keyword = this.previous();
      this.consume("(", "Expected '(' after 'if'");
      let condition = this.parseExpression();
      if (this.match("matches")) {
        this.parseExpression();
      }
      this.consume(")", "Expected ')' after if condition");
      let thenBranch = this.parseStatement();
      let elseBranch;
      if (this.match("else")) {
        elseBranch = this.parseStatement();
      }
      return {
        kind: "IfStatement",
        condition,
        thenBranch,
        elseBranch,
        span: this.combineSpans(keyword.span, (elseBranch ?? thenBranch).span),
      };
    }
    if (this.match("case", "casez", "casex")) {
      return this.parseCaseStatement();
    }
    if (this.match("randcase")) {
      return this.parseRandCase();
    }
    if (this.match("randsequence")) {
      return this.skipRandSequence();
    }
    if (this.match("for")) {
      return this.parseForStatement();
    }
    if (this.match("foreach")) {
      return this.parseForeachStatement();
    }
    if (this.match("while", "repeat")) {
      return this.parseWhileOrRepeat();
    }
    if (this.match("forever")) {
      let keyword = this.previous();
      let body = this.parseStatement();
      return { kind: "LoopStatement", loopKind: "forever", body, span: this.combineSpans(keyword.span, body.span) };
    }
    if (this.match("do")) {
      return this.parseDoWhile();
    }
    if (this.match("return")) {
      let keyword = this.previous();
      let value;
      if (!this.check(";")) {
        value = this.parseExpression();
      }
      let end = this.consume(";", "Expected ';' after return statement");
      return { kind: "ReturnStatement", value, span: this.combineSpans(keyword.span, end ? end.span : this.previous().span) };
    }
    if (this.match("break", "continue")) {
      let keyword = this.previous();
      let end = this.consume(";", `Expected ';' after ${keyword.text}`);
      return { kind: "JumpStatement", jump: keyword.text, span: this.combineSpans(keyword.span, end ? end.span : keyword.span) };
    }
    if (this.check("@") || this.check("@@")) {
      return this.parseEventControlWithStatement();
    }
    if (this.check("#") || this.check("##")) {
      return this.parseDelayWithStatement();
    }
    if (this.match("wait")) {
      return this.parseWait();
    }
    if (this.match("wait_order")) {
      if (this.check("(")) {
        this.cursor = this.skipBalanced(this.cursor, "(", ")");
      }
      return this.parseActionBlock(this.previous());
    }
    if (this.match("disable")) {
      let keyword = this.previous();
      this.skipToSemicolon();
      return { kind: "EmptyStatement", span: keyword.span };
    }
    if (this.match("->", "->>")) {
      let keyword = this.previous();
      this.skipToSemicolon();
      return { kind: "EmptyStatement", span: keyword.span };
    }
    if (this.match("force", "release", "assign", "deassign")) {
      let keyword = this.previous();
      this.skipToSemicolon();
      return { kind: "EmptyStatement", span: keyword.span };
    }
    if (this.check("assert") || this.check("assume") || this.check("cover") || this.check("restrict") || this.check("expect")) {
      return this.parseImmediateAssertion();
    }
    if (this.check("SystemIdentifier") && this.peek().text === "$root") {
      let keyword = this.advance();
      this.skipToSemicolon();
      return { kind: "EmptyStatement", span: keyword.span };
    }
    if (this.check("SystemIdentifier")) {
      return this.parseSystemTaskStatement();
    }
    if (this.match(";")) {
      return { kind: "EmptyStatement", span: this.previous().span };
    }
    if (this.check("MacroReference") && !this.typeIsFollowedByName()) {
      return this.parseMacroStatement();
    }
    if (this.check("typedef") || this.check("parameter") || this.check("localparam") || this.check("import")) {
      return this.parseLocalDeclarationItem();
    }
    if (this.check("void") && this.peekNext().type === "'(") {
      return this.parseCastStatement();
    }
    if (this.isLocalDeclarationStart()) {
      return this.parseLocalVariableDeclaration();
    }
    return this.parseAssignmentOrCall();
  }
  skipRandSequence() {
    let keyword = this.previous();
    for (; !this.check("endsequence") && !this.isAtEnd();) {
      this.advance();
    }
    let end = this.consume("endsequence", "Expected 'endsequence' to close randsequence");
    return { kind: "EmptyStatement", span: this.combineSpans(keyword.span, end ? end.span : this.previous().span) };
  }
  parseBlock(open, close) {
    let keyword = this.previous();
    // `name: begin ... end : name` names the block just like `begin : name`.
    let name = this.statementLabel;
    this.statementLabel = undefined;
    if (this.match(":")) {
      name = this.consumeName(`Expected block name after ':' in ${open} statement`)?.text;
    }
    let statements = [];
    let isEnd = () => (open === "fork" ? this.check("join") || this.check("join_any") || this.check("join_none") : this.check(close));
    for (; !isEnd() && !this.isAtEnd();) {
      let cursor = this.cursor;
      try {
        statements.push(this.parseStatement());
      } catch {
        this.synchronize([";", close]);
      }
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    let end;
    let joinKind;
    if (open === "fork") {
      end = this.match("join", "join_any", "join_none") ? this.previous() : this.consume("join", "Expected 'join' to close fork");
      joinKind = end?.type;
    } else {
      end = this.consume(close, "Expected 'end' to close block");
    }
    this.skipEndLabel(name ?? null);
    return {
      kind: "BlockStatement",
      name,
      statements,
      blockKind: open,
      joinKind,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  parseCaseStatement() {
    let keyword = this.previous();
    this.consume("(", "Expected '(' after 'case'");
    let expression = this.parseExpression();
    this.consume(")", "Expected ')' after case expression");
    let inside = false;
    if (this.match("inside")) {
      inside = true;
    } else if (this.match("matches")) {
      inside = false;
    }
    let items = [];
    for (; !this.check("endcase") && !this.isAtEnd();) {
      let cursor = this.cursor;
      if (this.match("default")) {
        let span = this.previous().span;
        this.match(":");
        let statement = this.parseStatement();
        items.push({ kind: "CaseItem", patterns: [], isDefault: true, statement, span: this.combineSpans(span, statement.span) });
      } else {
        let span = this.peek().span;
        let patterns = this.parseDelimitedList({
          parseItem: () => this.parseCasePattern(),
          isItemStart: () => this.isExpressionStart() || this.check("["),
          terminator: ":",
          missingDelimiterMessage: "Expected ',' between case item patterns",
        });
        this.consume(":", "Expected ':' after case item patterns");
        let statement = this.parseStatement();
        items.push({ kind: "CaseItem", patterns, isDefault: false, statement, span: this.combineSpans(span, statement.span) });
      }
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    let end = this.consume("endcase", "Expected 'endcase' to close case statement");
    return {
      kind: "CaseStatement",
      expression,
      items,
      caseType: keyword.type,
      inside,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  parseCasePattern() {
    return this.check("[") ? this.parseValueRange() : this.parseExpression();
  }
  parseValueRange() {
    let open = this.advance();
    let low = this.parseExpression();
    this.consume(":", "Expected ':' in value range");
    let high = this.parseExpression();
    let close = this.consume("]", "Expected ']' to close value range");
    return { kind: "ValueRange", low, high, span: this.combineSpans(open.span, close ? close.span : high.span) };
  }
  parseRandCase() {
    let keyword = this.previous();
    for (; !this.check("endcase") && !this.isAtEnd();) {
      let cursor = this.cursor;
      this.parseExpression();
      this.consume(":", "Expected ':' in randcase item");
      this.parseStatement();
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    this.consume("endcase", "Expected 'endcase' to close randcase");
    return { kind: "EmptyStatement", span: keyword.span };
  }
  parseForStatement() {
    let keyword = this.previous();
    this.consume("(", "Expected '(' after 'for'");
    let localVars = [];
    let inits = [];
    if (!this.check(";")) {
      do {
        if (this.isForVariableDeclaration()) {
          let dataType;
          this.match("automatic", "static", "const", "var");
          if (!(this.check("Identifier") && this.peekNext().type === "=")) {
            dataType = this.parseDataType();
          }
          let name = this.consumeName("Expected loop variable name");
          let init;
          if (this.match("=")) {
            init = this.parseExpression();
          }
          if (name) {
            localVars.push({ name: name.text, nameSpan: name.span, dataType, dims: [], init });
            let target = { kind: "Identifier", name: name.text, span: name.span };
            inits.push(init ? { kind: "BinaryExpression", operator: "=", left: target, right: init, span: name.span } : target);
          }
        } else {
          inits.push(this.parseForAssignment());
        }
      } while (this.match(","));
    }
    this.consume(";", "Expected ';' after for-loop initialisation");
    let condition;
    if (!this.check(";")) {
      condition = this.parseExpression();
    }
    this.consume(";", "Expected ';' after for-loop condition");
    let steps = [];
    if (!this.check(")")) {
      do {
        steps.push(this.parseForAssignment());
      } while (this.match(","));
    }
    this.consume(")", "Expected ')' after for-loop header");
    let body = this.parseStatement();
    return {
      kind: "LoopStatement",
      loopKind: "for",
      initExpr: inits[0],
      extraInits: inits.slice(1),
      localVars,
      condition,
      stepExpr: steps[0],
      extraSteps: steps.slice(1),
      body,
      span: this.combineSpans(keyword.span, body.span),
    };
  }
  isForVariableDeclaration() {
    if (this.checkAny(TYPE_KEYWORDS) || this.checkAny(["automatic", "static", "const", "var"]) || this.check("signed") || this.check("unsigned")) {
      return true;
    }
    return this.check("Identifier") && this.typeIsFollowedByName();
  }
  parseForAssignment() {
    if (this.match("++", "--")) {
      let operator = this.previous();
      let target = this.parseLhs();
      return this.incDecExpression(target, operator.text);
    }
    let lhs = this.parseLhs();
    if (this.match("++", "--")) {
      return this.incDecExpression(lhs, this.previous().text);
    }
    if (this.matchAny(ASSIGNMENT_OPERATORS)) {
      let operator = this.previous().text;
      let right = this.parseExpression();
      return {
        kind: "BinaryExpression",
        operator: "=",
        left: lhs,
        right: { kind: "BinaryExpression", operator: operator.slice(0, -1), left: lhs, right, span: this.combineSpans(lhs.span, right.span) },
        span: this.combineSpans(lhs.span, right.span),
      };
    }
    if (this.match("=")) {
      let right = this.parseExpression();
      return { kind: "BinaryExpression", operator: "=", left: lhs, right, span: this.combineSpans(lhs.span, right.span) };
    }
    return lhs;
  }
  incDecExpression(target, operator) {
    let one = { kind: "NumberLiteral", raw: "1", value: 1, span: target.span };
    return {
      kind: "BinaryExpression",
      operator: "=",
      left: target,
      right: { kind: "BinaryExpression", operator: operator === "++" ? "+" : "-", left: target, right: one, span: target.span },
      span: target.span,
    };
  }
  parseForeachStatement() {
    let keyword = this.previous();
    this.consume("(", "Expected '(' after 'foreach'");
    let array = this.parseLhsBase();
    let loopVars = [];
    this.consume("[", "Expected '[' in foreach header");
    for (; !this.check("]") && !this.isAtEnd();) {
      if (this.match(",")) {
        loopVars.push(null);
        continue;
      }
      let name = this.consumeName("Expected loop variable in foreach");
      if (!name) {
        break;
      }
      loopVars.push({ name: name.text, span: name.span });
      if (!this.check("]")) {
        this.consume(",", "Expected ',' between foreach loop variables");
      }
    }
    this.consume("]", "Expected ']' in foreach header");
    this.consume(")", "Expected ')' after foreach header");
    let body = this.parseStatement();
    return { kind: "ForeachStatement", array, loopVars, body, span: this.combineSpans(keyword.span, body.span) };
  }
  parseWhileOrRepeat() {
    let keyword = this.previous();
    this.consume("(", `Expected '(' after '${keyword.text}'`);
    let expression = this.parseExpression();
    this.consume(")", `Expected ')' after ${keyword.text} condition`);
    let body = this.parseStatement();
    return {
      kind: "LoopStatement",
      loopKind: keyword.text,
      condition: keyword.text === "while" ? expression : undefined,
      countExpr: keyword.text === "repeat" ? expression : undefined,
      body,
      span: this.combineSpans(keyword.span, body.span),
    };
  }
  parseDoWhile() {
    let keyword = this.previous();
    let body = this.parseStatement();
    this.consume("while", "Expected 'while' after do body");
    this.consume("(", "Expected '(' after 'while'");
    let condition = this.parseExpression();
    this.consume(")", "Expected ')' after while condition");
    let end = this.consume(";", "Expected ';' after do-while");
    return {
      kind: "LoopStatement",
      loopKind: "do",
      condition,
      body,
      span: this.combineSpans(keyword.span, end ? end.span : this.previous().span),
    };
  }
  parseEventControlWithStatement() {
    let start = this.peek().span;
    let events = this.parseEventControl();
    let statement = this.parseStatement();
    return {
      kind: "BlockStatement",
      statements: [{ kind: "EventControlStatement", sensitivities: events.sensitivities, span: start }, statement],
      blockKind: "event",
      span: this.combineSpans(start, statement.span),
    };
  }
  parseDelayWithStatement() {
    let start = this.advance();
    let delayExpr = this.parseDelayExpression();
    let statement = this.parseStatement();
    return {
      kind: "BlockStatement",
      statements: [{ kind: "DelayStatement", delayExpr, span: start.span }, statement],
      blockKind: "delay",
      span: this.combineSpans(start.span, statement.span),
    };
  }
  parseWait() {
    let keyword = this.previous();
    if (this.match("fork")) {
      this.consume(";", "Expected ';' after wait fork");
      return { kind: "EmptyStatement", span: keyword.span };
    }
    this.consume("(", "Expected '(' after 'wait'");
    let condition = this.parseExpression();
    this.consume(")", "Expected ')' after wait condition");
    let statement = this.parseStatement();
    return {
      kind: "BlockStatement",
      statements: [{ kind: "WaitStatement", condition, span: keyword.span }, statement],
      blockKind: "wait",
      span: this.combineSpans(keyword.span, statement.span),
    };
  }
  parseActionBlock(keyword) {
    if (this.match(";")) {
      return { kind: "EmptyStatement", span: keyword.span };
    }
    let statements = [];
    if (!this.check("else")) {
      statements.push(this.parseStatement());
    }
    if (this.match("else")) {
      statements.push(this.parseStatement());
    }
    return { kind: "BlockStatement", statements, blockKind: "action", span: this.combineSpans(keyword.span, this.previous().span) };
  }
  parseImmediateAssertion() {
    let keyword = this.advance();
    if (keyword.type === "expect" && this.check("(")) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
      return this.parseActionBlock(keyword);
    }
    if (this.match("property", "sequence")) {
      if (this.check("(")) {
        this.cursor = this.skipBalanced(this.cursor, "(", ")");
      }
      return this.parseActionBlock(keyword);
    }
    if (this.match("#")) {
      this.skipDelayValue();
    } else {
      this.match("final");
    }
    this.consume("(", `Expected '(' after '${keyword.text}'`);
    let condition = this.parseExpression();
    this.consume(")", `Expected ')' after ${keyword.text} expression`);
    let action = this.parseActionBlock(keyword);
    return {
      kind: "AssertionStatement",
      assertKind: keyword.text,
      condition,
      action,
      span: this.combineSpans(keyword.span, action.span),
    };
  }
  parseSystemTaskStatement() {
    let name = this.advance();
    let args = [];
    if (this.match("(")) {
      args = this.parseCallArguments();
      this.consume(")", "Expected ')' after system task arguments");
    }
    let end = this.consume(";", "Expected ';' after system task call");
    return {
      kind: "SystemTaskCall",
      name: name.text,
      args,
      span: this.combineSpans(name.span, end ? end.span : this.previous().span),
    };
  }
  parseMacroStatement() {
    let name = this.advance();
    if (this.check("(")) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
    }
    this.match(";");
    return { kind: "EmptyStatement", span: name.span };
  }
  parseLocalDeclarationItem() {
    let start = this.peek().span;
    let item = this.parseDeclarationItem();
    return { kind: "LocalItemStatement", item, span: item && !Array.isArray(item) ? item.span : start };
  }
  parseCastStatement() {
    let start = this.peek().span;
    let expression = this.parseExpression();
    let end = this.consume(";", "Expected ';' after expression statement");
    return { kind: "ExpressionStatement", expression, span: this.combineSpans(start, end ? end.span : expression.span) };
  }
  isLocalDeclarationStart() {
    if (this.checkAny(["automatic", "static", "const", "var", "rand", "randc"])) {
      return true;
    }
    if (this.checkAny(TYPE_KEYWORDS) && this.peekNext().type !== "'(") {
      return true;
    }
    if (this.check("Identifier") || this.check("EscapedIdentifier") || this.check("MacroReference")) {
      if (!this.typeIsFollowedByName()) {
        return false;
      }
      let at = this.skipTypeTokens(this.cursor);
      let after = this.tokens[at + 1]?.type;
      return after === ";" || after === "," || after === "=" || after === "[";
    }
    return false;
  }
  parseLocalVariableDeclaration() {
    let declaration = this.parseDataDeclaration();
    return { ...declaration, kind: "LocalVarDeclaration" };
  }
  parseAssignmentOrCall() {
    let start = this.peek().span;
    if (this.match("++", "--")) {
      let operator = this.previous().text;
      let target = this.parseLhs();
      let end = this.consume(";", "Expected ';' after increment statement");
      return this.assignFromExpression(this.incDecExpression(target, operator), start, end);
    }
    if (!this.isLvalueStart()) {
      if (this.isExpressionStart()) {
        let expression = this.parseExpression();
        let end = this.consume(";", "Expected ';' after expression statement");
        return { kind: "ExpressionStatement", expression, span: this.combineSpans(start, end ? end.span : expression.span) };
      }
      this.addDiagnostic("Expected variable identifier on left-hand side of assignment", this.peek().span);
      this.advance();
      return { kind: "EmptyStatement", span: start };
    }
    let lhs = this.parseLhs();
    if (this.match("<=")) {
      this.skipIntraAssignmentControl();
      let rhs = this.parseExpression();
      let end = this.consume(";", "Expected ';' after non-blocking assignment");
      return { kind: "NonBlockingAssign", lhs, rhs, span: this.combineSpans(lhs.span, end ? end.span : rhs.span) };
    }
    if (this.match("=")) {
      this.skipIntraAssignmentControl();
      let rhs = this.parseExpression();
      let end = this.consume(";", "Expected ';' after blocking assignment");
      return { kind: "BlockingAssign", lhs, rhs, span: this.combineSpans(lhs.span, end ? end.span : rhs.span) };
    }
    if (this.matchAny(ASSIGNMENT_OPERATORS)) {
      let operator = this.previous().text.slice(0, -1);
      let right = this.parseExpression();
      let end = this.consume(";", "Expected ';' after assignment");
      let rhs = { kind: "BinaryExpression", operator, left: lhs, right, span: this.combineSpans(lhs.span, right.span) };
      return { kind: "BlockingAssign", lhs, rhs, span: this.combineSpans(lhs.span, end ? end.span : rhs.span) };
    }
    if (this.match("++", "--")) {
      let operator = this.previous().text;
      let end = this.consume(";", "Expected ';' after increment statement");
      return this.assignFromExpression(this.incDecExpression(lhs, operator), start, end);
    }
    if (this.check("(") || lhs.kind === "FunctionCall") {
      let args = [];
      if (lhs.kind === "FunctionCall") {
        args = lhs.args;
      } else {
        this.advance();
        args = this.parseCallArguments();
        this.consume(")", "Expected ')' after task call arguments");
      }
      this.skipWithClause();
      let end = this.consume(";", "Expected ';' after task call");
      return {
        kind: "TaskCallStatement",
        name: lhs.name ?? lhs.member ?? "<call>",
        target: lhs.kind === "FunctionCall" ? lhs.target : lhs,
        args,
        span: this.combineSpans(start, end ? end.span : this.previous().span),
      };
    }
    if (this.check("with")) {
      this.skipWithClause();
    }
    if (this.match(";")) {
      return {
        kind: "TaskCallStatement",
        name: lhs.name ?? lhs.member ?? "<call>",
        target: lhs,
        args: [],
        span: this.combineSpans(start, this.previous().span),
      };
    }
    this.addDiagnostic("Expected assignment ('=' or '<=') in statement", this.peek().span);
    this.advance();
    return { kind: "EmptyStatement", span: lhs.span };
  }
  assignFromExpression(expression, start, end) {
    return {
      kind: "BlockingAssign",
      lhs: expression.left,
      rhs: expression.right,
      incDec: true,
      span: this.combineSpans(start, end ? end.span : expression.span),
    };
  }
  skipIntraAssignmentControl() {
    if (this.match("#")) {
      this.skipDelayValue();
    } else if (this.check("##")) {
      this.advance();
      this.skipDelayValue();
    } else if (this.check("@") || this.check("@@")) {
      this.parseEventControl();
    } else if (this.match("repeat")) {
      this.consume("(", "Expected '(' after repeat");
      this.parseExpression();
      this.consume(")", "Expected ')' after repeat");
      if (this.check("@")) {
        this.parseEventControl();
      }
    }
  }
  isLvalueStart() {
    return (
      this.check("Identifier") ||
      this.check("EscapedIdentifier") ||
      this.check("{") ||
      this.check("'{") ||
      this.check("this") ||
      this.check("super") ||
      this.check("MacroReference") ||
      (this.check("SystemIdentifier") && this.peek().text === "$unit") ||
      this.check("local") ||
      this.check("(")
    );
  }
  parseLhs() {
    if (this.check("{")) {
      return this.parseLhsConcat();
    }
    if (this.check("'{")) {
      return this.parsePrimary();
    }
    if (this.check("(")) {
      return this.parsePrimary();
    }
    if (this.isLvalueStart()) {
      return this.parsePostfix(this.parseLhsBase(), true);
    }
    this.addDiagnostic("Expected variable identifier on left-hand side of assignment", this.peek().span);
    let span = this.peek().span;
    this.advance();
    return { kind: "Identifier", name: "<error>", span };
  }
  parseLhsConcat() {
    let open = this.advance();
    if (this.check("<<") || this.check(">>")) {
      this.cursor--;
      return this.parsePrimary();
    }
    let elements = this.parseDelimitedList({
      parseItem: () => this.parseLhs(),
      isItemStart: () => this.isExpressionStart(),
      terminator: "}",
      missingDelimiterMessage: "Expected ',' between concatenation elements",
    });
    let close = this.consume("}", "Expected '}' after concatenation");
    return { kind: "Concatenation", elements, span: this.combineSpans(open.span, close ? close.span : this.previous().span) };
  }
  parseLhsBase() {
    let token = this.advance();
    let name = token.text;
    return { kind: "Identifier", name, span: token.span };
  }

  // ---- Expressions

  parseCallArguments() {
    let args = [];
    for (; !this.check(")") && !this.isAtEnd();) {
      let cursor = this.cursor;
      if (this.check(",")) {
        args.svSkipped = (args.svSkipped ?? 0) + 1;
        this.advance();
        continue;
      }
      if (this.match(".")) {
        let name = this.consumeName("Expected argument name after '.'");
        this.consume("(", "Expected '(' after argument name");
        if (!this.check(")")) {
          let value = this.parseTypeOrExpressionArgument();
          value.svArgName = name?.text;
          args.push(value);
        }
        if (name) {
          (args.svNames ??= []).push(name.text);
        }
        this.consume(")", "Expected ')' after named argument");
      } else {
        args.push(this.parseCallArgument());
      }
      if (!this.match(",") && !this.check(")")) {
        this.addDiagnostic("Expected ',' between function call arguments", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        if (this.cursor === cursor) {
          this.advance();
        }
      }
    }
    return args;
  }
  parseCallArgument() {
    if (this.checkAny(TYPE_KEYWORDS) && !this.isCastAhead()) {
      return this.parseDataType();
    }
    if (this.match("posedge", "negedge", "edge")) {
      return this.parseExpression();
    }
    return this.parseExpression();
  }
  skipWithClause() {
    if (!this.match("with")) {
      return;
    }
    if (this.check("(")) {
      this.cursor = this.skipBalanced(this.cursor, "(", ")");
    }
    if (this.check("[")) {
      this.cursor = this.skipBalanced(this.cursor, "[", "]");
    }
    if (this.check("{")) {
      this.cursor = this.skipBalanced(this.cursor, "{", "}");
    }
  }
  isExpressionStart() {
    if (this.isAtEnd()) {
      return false;
    }
    let type = this.peek().type;
    return (
      super.isExpressionStart() ||
      type === "EscapedIdentifier" ||
      type === "SystemIdentifier" ||
      type === "StringLiteral" ||
      type === "UnbasedLiteral" ||
      type === "'{" ||
      type === "this" ||
      type === "super" ||
      type === "null" ||
      type === "new" ||
      type === "local" ||
      type === "++" ||
      type === "--" ||
      this.checkAny(TYPE_KEYWORDS)
    );
  }
  parseTernary() {
    let condition = this.parseImplication();
    if (this.match("matches")) {
      this.parseLogicalOr();
    }
    if (this.match("?")) {
      let trueExpr = this.parseExpression();
      this.consume(":", "Expected ':' in ternary conditional operator");
      let falseExpr = this.parseExpression();
      return {
        kind: "TernaryExpression",
        condition,
        trueExpr,
        falseExpr,
        span: this.combineSpans(condition.span, falseExpr.span),
      };
    }
    return condition;
  }
  parseImplication() {
    let left = this.parseLogicalOr();
    for (; this.match("->", "<->");) {
      let operator = this.previous().text;
      let right = this.parseLogicalOr();
      left = { kind: "BinaryExpression", operator, left, right, span: this.combineSpans(left.span, right.span) };
    }
    return left;
  }
  parseEquality() {
    let left = this.parseRelational();
    for (; this.match("==", "!=", "===", "!==", "==?", "!=?");) {
      let operator = this.previous().text;
      let right = this.parseRelational();
      left = { kind: "BinaryExpression", operator, left, right, span: this.combineSpans(left.span, right.span) };
    }
    return left;
  }
  parseRelational() {
    let left = this.parseShift();
    for (; ;) {
      if (this.match("<", "<=", ">", ">=")) {
        let operator = this.previous().text;
        let right = this.parseShift();
        left = { kind: "BinaryExpression", operator, left, right, span: this.combineSpans(left.span, right.span) };
      } else if (this.match("inside")) {
        left = this.finishInside(left);
      } else if (this.match("dist")) {
        if (this.check("{")) {
          this.cursor = this.skipBalanced(this.cursor, "{", "}");
        }
      } else {
        return left;
      }
    }
  }
  finishInside(expression) {
    this.consume("{", "Expected '{' after 'inside'");
    let items = this.parseDelimitedList({
      parseItem: () => this.parseCasePattern(),
      isItemStart: () => this.isExpressionStart() || this.check("["),
      terminator: "}",
      missingDelimiterMessage: "Expected ',' between inside items",
    });
    let close = this.consume("}", "Expected '}' after inside items");
    return {
      kind: "InsideExpression",
      expression,
      items,
      span: this.combineSpans(expression.span, close ? close.span : this.previous().span),
    };
  }
  parseUnary() {
    if (this.match("++", "--")) {
      let operator = this.previous();
      let argument = this.parseUnary();
      return { kind: "IncDecExpression", operator: operator.text, prefix: true, argument, span: this.combineSpans(operator.span, argument.span) };
    }
    if (this.match("~", "!", "&", "|", "^", "~&", "~|", "~^", "^~", "+", "-")) {
      let operator = this.previous();
      let argument = this.parseUnary();
      return { kind: "UnaryExpression", operator: operator.text, argument, span: this.combineSpans(operator.span, argument.span) };
    }
    return this.parsePrimary();
  }
  parsePrimary() {
    let node = this.parsePrimaryBase();
    return this.parsePostfix(node, false);
  }
  parsePrimaryBase() {
    if (this.check("MacroReference")) {
      let token = this.advance();
      if (this.check("(")) {
        this.cursor = this.skipBalanced(this.cursor, "(", ")");
        return { kind: "OpaqueExpression", text: token.text, span: this.combineSpans(token.span, this.previous().span) };
      }
      return { kind: "Identifier", name: token.text, span: token.span };
    }
    if (this.match("UnbasedLiteral")) {
      let token = this.previous();
      let digit = token.text[1].toLowerCase();
      return {
        kind: "NumberLiteral",
        raw: token.text,
        value: digit === "1" ? 1 : 0,
        unbased: digit,
        span: token.span,
      };
    }
    if (this.check("EscapedIdentifier") || this.check("this") || this.check("super") || this.check("local")) {
      let token = this.advance();
      if (this.check("::")) {
        return { kind: "Identifier", name: token.text, span: token.span };
      }
      return { kind: token.type === "EscapedIdentifier" ? "Identifier" : "OpaqueExpression", name: token.text, text: token.text, span: token.span };
    }
    if (this.match("null")) {
      return { kind: "OpaqueExpression", text: "null", span: this.previous().span };
    }
    if (this.match("new")) {
      let token = this.previous();
      if (this.check("[")) {
        this.cursor = this.skipBalanced(this.cursor, "[", "]");
      }
      if (this.check("(")) {
        this.cursor = this.skipBalanced(this.cursor, "(", ")");
      } else if (this.check("Identifier") || this.check("this")) {
        this.parseUnary();
      }
      return { kind: "OpaqueExpression", text: "new", span: this.combineSpans(token.span, this.previous().span) };
    }
    if (this.check("'{")) {
      return this.parseAssignmentPattern();
    }
    if (this.match("tagged")) {
      this.consumeName("Expected member after 'tagged'");
      if (this.isPatternVariableStart()) {
        return this.parsePatternVariable();
      }
      if (this.isExpressionStart()) {
        return this.parseUnary();
      }
      return { kind: "OpaqueExpression", text: "tagged", span: this.previous().span };
    }
    if (this.checkAny(TYPE_KEYWORDS) || this.check("signed") || this.check("unsigned") || this.check("const")) {
      return this.parseCastOrType();
    }
    if (this.check("{") && (this.peekNext().type === "<<" || this.peekNext().type === ">>")) {
      return this.parseStreaming();
    }
    if (this.check("{") && this.peekNext().type === "}") {
      let open = this.advance();
      let close = this.advance();
      return { kind: "OpaqueExpression", text: "{}", span: this.combineSpans(open.span, close.span) };
    }
    if (this.match("(")) {
      let open = this.previous();
      let expression = this.parseExpression();
      if (this.match("=") || this.matchAny(ASSIGNMENT_OPERATORS)) {
        let right = this.parseExpression();
        expression = { kind: "OpaqueExpression", text: "assign", span: this.combineSpans(expression.span, right.span) };
      } else if (this.match(":")) {
        this.parseExpression();
        if (this.match(":")) {
          this.parseExpression();
        }
      }
      let close = this.consume(")", "Expected ')' after parenthesized expression");
      return { ...expression, parenthesized: true, span: this.combineSpans(open.span, close ? close.span : expression.span) };
    }
    if (this.match("SystemIdentifier")) {
      let token = this.previous();
      let args = [];
      let span = token.span;
      if (this.match("(")) {
        args = this.parseCallArguments();
        let close = this.consume(")", "Expected ')' after system function arguments");
        span = this.combineSpans(token.span, close ? close.span : this.previous().span);
      }
      return { kind: "SystemFunctionCall", name: token.text, args, span };
    }
    if (this.check("Identifier")) {
      let token = this.advance();
      return { kind: "Identifier", name: token.text, span: token.span };
    }
    return super.parsePrimary();
  }
  parseCastOrType() {
    let start = this.peek().span;
    let qualifier;
    if (this.match("const")) {
      qualifier = "const";
    }
    if (this.check("signed") || this.check("unsigned")) {
      qualifier = this.advance().text;
    } else if (!qualifier) {
      let dataType = this.parseDataType();
      if (this.check("'(")) {
        return this.finishCast(dataType, start);
      }
      if (this.check("'{")) {
        let pattern = this.parseAssignmentPattern();
        pattern.dataType = dataType;
        return pattern;
      }
      return dataType;
    }
    if (this.check("'(")) {
      return this.finishCast({ kind: "DataType", base: "qualifier", qualifier, dims: [], span: start }, start);
    }
    return { kind: "OpaqueExpression", text: qualifier, span: start };
  }
  finishCast(dataType, start) {
    this.advance();
    let expression = this.parseExpression();
    let close = this.consume(")", "Expected ')' after cast expression");
    return {
      kind: "CastExpression",
      dataType,
      expression,
      span: this.combineSpans(start, close ? close.span : expression.span),
    };
  }
  isPatternVariableStart() {
    return this.check(".*") || (this.check(".") && this.peekNext().type === "Identifier");
  }
  parsePatternVariable() {
    if (this.match(".*")) {
      return { kind: "OpaqueExpression", text: ".*", span: this.previous().span };
    }
    this.advance();
    let name = this.advance();
    if (!this.patternVariables.has(name.text)) {
      this.patternVariables.set(name.text, name.span);
    }
    return { kind: "OpaqueExpression", text: `.${name.text}`, span: name.span };
  }
  parseAssignmentPattern() {
    let open = this.advance();
    let items = [];
    for (; !this.check("}") && !this.isAtEnd();) {
      let cursor = this.cursor;
      if (this.check("default") && this.peekNext().type === ":") {
        this.advance();
        this.advance();
        items.push({ isDefault: true, value: this.parseExpression() });
      } else if (this.isPatternVariableStart()) {
        items.push({ value: this.parsePatternVariable() });
      } else if (this.check(".") && this.peekNext().type !== "Identifier") {
        this.addDiagnostic("Expected pattern variable after '.'", this.peek().span);
        this.advance();
      } else {
        let first = this.parseTypeOrExpressionArgument();
        if (this.match(":")) {
          items.push({ key: first, value: this.parseExpression() });
        } else if (this.check("{")) {
          // Replication pattern: '{n{value}}
          this.advance();
          let values = this.parseDelimitedList({
            parseItem: () => this.parseExpression(),
            isItemStart: () => this.isExpressionStart(),
            terminator: "}",
          });
          this.consume("}", "Expected '}' after replication pattern");
          items.push({ count: first, values });
        } else {
          items.push({ value: first });
        }
      }
      if (!this.match(",") && !this.check("}")) {
        this.addDiagnostic("Expected ',' between assignment pattern items", this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        if (this.cursor === cursor) {
          this.advance();
        }
      }
    }
    let close = this.consume("}", "Expected '}' after assignment pattern");
    return {
      kind: "AssignmentPattern",
      items,
      span: this.combineSpans(open.span, close ? close.span : this.previous().span),
    };
  }
  parseStreaming() {
    let open = this.advance();
    this.advance();
    if (!this.check("{")) {
      this.parseTypeOrExpressionArgument();
    }
    let inner = this.peek().span;
    if (this.check("{")) {
      this.cursor = this.skipBalanced(this.cursor, "{", "}");
      inner = this.previous().span;
    }
    let close = this.consume("}", "Expected '}' after streaming concatenation");
    return { kind: "OpaqueExpression", text: "stream", span: this.combineSpans(open.span, close ? close.span : inner) };
  }
  // Selects, member access, scope resolution, calls, casts and post-increment.
  parsePostfix(node, isLvalue) {
    let current = node;
    let start = node.span;
    for (;;) {
      if (this.check("#") && this.tokens[this.cursor + 1]?.type === "(" && (current.kind === "Identifier" || current.kind === "ScopedIdentifier")) {
        // Parameterized class scope: name#(...)::member
        let after = this.skipBalanced(this.cursor + 1, "(", ")");
        if (this.tokens[after]?.type === "::") {
          this.cursor = after;
          continue;
        }
      }
      if (this.check("with") && current.kind === "MemberSelect") {
        // Array method without parentheses: q.find with (item > 0)
        this.skipWithClause();
        current = { kind: "FunctionCall", name: current.member, target: current, args: [], span: this.combineSpans(start, this.previous().span) };
        continue;
      }
      if (this.match("::")) {
        let member = this.match("new") ? this.previous() : this.consumeName("Expected identifier after '::'");
        if (typeof (current.name ?? current.text) !== "string") {
          this.addDiagnostic("'::' must follow a package or class name", this.previous().span, "error", "SYNTAX-SCOPE");
          continue;
        }
        current = {
          kind: "ScopedIdentifier",
          scope: current.name ?? current.text,
          name: member?.text ?? "<error>",
          nameSpan: member?.span,
          span: this.combineSpans(start, member ? member.span : start),
        };
        if (this.check("#")) {
          this.skipParameterValues();
        }
        continue;
      }
      if (this.check(".") && this.isMemberName(this.peekNext().type)) {
        this.advance();
        let member = this.advance();
        current = {
          kind: "MemberSelect",
          target: current,
          member: member.text,
          memberSpan: member.span,
          span: this.combineSpans(start, member.span),
        };
        continue;
      }
      if (this.check("[")) {
        this.advance();
        current = this.parseSelect(current, start);
        continue;
      }
      if (this.check("(") && !isLvalue && this.isCallable(current)) {
        current = this.parseCall(current, start);
        continue;
      }
      if (this.check("(") && isLvalue && this.isCallable(current)) {
        current = this.parseCall(current, start);
        continue;
      }
      if (this.check("'(") && !isLvalue) {
        current = this.finishCast({ kind: "DataType", base: "castTarget", target: current, dims: [], span: current.span }, start);
        continue;
      }
      if (this.check("'{") && !isLvalue) {
        let pattern = this.parseAssignmentPattern();
        pattern.dataType = { kind: "DataType", base: "named", name: current.name, scope: current.scope, dims: [], span: current.span };
        current = pattern;
        continue;
      }
      if (!isLvalue && (this.check("++") || this.check("--"))) {
        let operator = this.advance();
        current = { kind: "IncDecExpression", operator: operator.text, prefix: false, argument: current, span: this.combineSpans(start, operator.span) };
        continue;
      }
      return current;
    }
  }
  isMemberName(type) {
    return type === "Identifier" || type === "EscapedIdentifier" || type === "new" || type === "unique" || type === "and" || type === "or" || type === "xor";
  }
  isCallable(node) {
    return node.kind === "Identifier" || node.kind === "ScopedIdentifier" || node.kind === "MemberSelect" || (node.kind === "OpaqueExpression" && (node.text === "this" || node.text === "super"));
  }
  parseCall(target, start) {
    this.advance();
    let args = this.parseCallArguments();
    let close = this.consume(")", "Expected ')' after function call arguments");
    if (this.check("with")) {
      this.skipWithClause();
      // `q.find(x) with (x > 0)`: the argument names an iterator rather than using a variable.
      if (target.kind === "MemberSelect") {
        args = [];
      }
    }
    return {
      kind: "FunctionCall",
      name: target.kind === "Identifier" || target.kind === "ScopedIdentifier" ? target.name : target.member ?? target.text,
      scope: target.kind === "ScopedIdentifier" ? target.scope : undefined,
      target: target.kind === "Identifier" ? undefined : target,
      args,
      span: this.combineSpans(start, close ? close.span : this.previous().span),
    };
  }
  parseSelect(target, start) {
    if (this.check("SystemIdentifier") && this.peek().text === "$" && this.peekNext().type === "]") {
      this.advance();
      let close = this.consume("]", "Expected ']'");
      return { kind: "OpaqueExpression", text: "[$]", span: this.combineSpans(start, close ? close.span : start) };
    }
    if (this.match("*") || this.check("]")) {
      let close = this.consume("]", "Expected ']'");
      return { kind: "OpaqueExpression", text: "[]", span: this.combineSpans(start, close ? close.span : start) };
    }
    let first = this.parseExpression();
    if (this.match("+:", "-:")) {
      let operator = this.previous().text;
      let width = this.parseExpression();
      let close = this.consume("]", "Expected ']' after part-select");
      return {
        kind: "IndexedPartSelect",
        target,
        base: first,
        width,
        direction: operator,
        span: this.combineSpans(start, close ? close.span : width.span),
      };
    }
    if (this.match(":")) {
      let second = this.parseExpression();
      let close = this.consume("]", "Expected ']' after part-select");
      return { kind: "PartSelect", target, msb: first, lsb: second, span: this.combineSpans(start, close ? close.span : second.span) };
    }
    let close = this.consume("]", "Expected ']' after bit-select");
    return { kind: "BitSelect", target, index: first, span: this.combineSpans(start, close ? close.span : first.span) };
  }
}
