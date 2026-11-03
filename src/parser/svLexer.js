import { Lexer, makeSpan } from "./lexer.js";

// IEEE 1800-2017 Annex B reserved keywords.
export const SV_KEYWORDS = new Set(
  `accept_on alias always always_comb always_ff always_latch and assert assign assume automatic
  before begin bind bins binsof bit break buf bufif0 bufif1 byte case casex casez cell chandle
  checker class clocking cmos config const constraint context continue cover covergroup coverpoint
  cross deassign default defparam design disable dist do edge else end endcase endchecker endclass
  endclocking endconfig endfunction endgenerate endgroup endinterface endmodule endpackage
  endprimitive endprogram endproperty endspecify endsequence endtable endtask enum event eventually
  expect export extends extern final first_match for force foreach forever fork forkjoin function
  generate genvar global highz0 highz1 if iff ifnone ignore_bins illegal_bins implements implies
  import incdir include initial inout input inside instance int integer interconnect interface
  intersect join join_any join_none large let liblist library local localparam logic longint
  macromodule matches medium modport module nand negedge nettype new nexttime nmos nor
  noshowcancelled not notif0 notif1 null or output package packed parameter pmos posedge primitive
  priority program property protected pull0 pull1 pulldown pullup pulsestyle_ondetect
  pulsestyle_onevent pure rand randc randcase randsequence rcmos real realtime ref reg reject_on
  release repeat restrict return rnmos rpmos rtran rtranif0 rtranif1 s_always s_eventually
  s_nexttime s_until s_until_with scalared sequence shortint shortreal showcancelled signed small
  soft solve specify specparam static string strong strong0 strong1 struct super supply0 supply1
  sync_accept_on sync_reject_on table tagged task this throughout time timeprecision timeunit tran
  tranif0 tranif1 tri tri0 tri1 triand trior trireg type typedef union unique unique0 unsigned until
  until_with untyped use uwire var vectored virtual void wait wait_order wand weak weak0 weak1 while
  wildcard wire with within wor xnor xor`.split(/\s+/),
);

const SV_OPERATORS = [
  "<<<=", ">>>=",
  "<<=", ">>=", "==?", "!=?", "<->", "->>", "|->", "|=>", "#-#", "#=#",
  "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "::", "->", "+:", "-:", ".*", ":=",
  ":/", "##", "@@", "=>", "*>",
];

const TIME_UNITS = ["fs", "ps", "ns", "us", "ms", "s"];

const NO_ARGUMENT_DIRECTIVES = new Set([
  "celldefine", "endcelldefine", "resetall", "nounconnected_drive", "end_keywords",
  "delay_mode_distributed", "delay_mode_path", "delay_mode_unit", "delay_mode_zero",
]);

const REST_OF_LINE_DIRECTIVES = new Set([
  "timescale", "default_nettype", "unconnected_drive", "line", "pragma", "begin_keywords",
  "default_decay_time", "default_trireg_strength",
]);

const MAX_MACRO_DEPTH = 64;

export class SvLexer extends Lexer {
  macros;
  includeResolver;
  macroDepth;
  callSite;
  output = [];
  includeStack;
  constructor(source, fileUri = "file:///untitled.sv", options = {}) {
    super(source, fileUri);
    this.macros = options.macros ?? new Map();
    this.includeResolver = options.includeResolver;
    this.macroDepth = options.macroDepth ?? 0;
    this.callSite = options.callSite;
    this.includeStack = options.includeStack ?? [fileUri];
  }
  getDefinedMacros() {
    return Array.from(this.macros.keys());
  }
  tokenize() {
    this.output = [];
    for (; !this.isAtEnd() && (this.skipWhitespaceAndComments(), !this.isAtEnd());) {
      if (this.peek() === "`" && this.isDirectiveStart()) {
        this.scanDirective();
        continue;
      }
      if (!this.isActive()) {
        this.skipInactiveContent();
        continue;
      }
      if (this.isAttributeStart()) {
        this.skipAttribute();
        continue;
      }
      this.output.push(this.nextToken());
    }
    this.output.push(this.createToken("EOF", "", this.line, this.column));
    return this.output;
  }
  isAttributeStart() {
    if (this.peek() !== "(" || this.peekNext() !== "*") {
      return false;
    }
    let previous = this.output[this.output.length - 1];
    if (previous && previous.type === "@") {
      return false;
    }
    let next = this.index + 2;
    for (; next < this.source.length && /\s/.test(this.source[next]);) {
      next++;
    }
    return this.source[next] !== ")";
  }
  skipAttribute() {
    for (this.advance(), this.advance(); !this.isAtEnd();) {
      if (this.peek() === "*" && this.peekNext() === ")") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }
  }
  scanDirective() {
    let line = this.line;
    let column = this.column;
    this.advance();
    let name = "";
    for (; !this.isAtEnd() && this.isAlphaNumericOrUnderscore(this.peek());) {
      name += this.advance();
    }
    switch (name) {
      case "ifdef":
      case "ifndef": {
        let macro = this.readIdentifierForDirective();
        let parentActive = this.isActive();
        let defined = this.macros.has(macro);
        let taken = parentActive && (name === "ifdef" ? defined : !defined);
        this.conditionalStack.push({ parentActive, branchTaken: taken, currentActive: taken });
        return;
      }
      case "elsif": {
        let macro = this.readIdentifierForDirective();
        let top = this.conditionalStack[this.conditionalStack.length - 1];
        if (top) {
          top.currentActive = top.parentActive && !top.branchTaken && this.macros.has(macro);
          if (top.currentActive) {
            top.branchTaken = true;
          }
        }
        return;
      }
      case "else": {
        let top = this.conditionalStack[this.conditionalStack.length - 1];
        if (top) {
          top.currentActive = top.parentActive && !top.branchTaken;
          if (top.currentActive) {
            top.branchTaken = true;
          }
        }
        return;
      }
      case "endif":
        this.conditionalStack.pop();
        return;
    }
    if (!this.isActive()) {
      return;
    }
    if (name === "define") {
      this.scanDefine();
    } else if (name === "undef") {
      this.macros.delete(this.readIdentifierForDirective());
    } else if (name === "include") {
      this.scanInclude(line, column);
    } else if (name === "__FILE__") {
      this.output.push(this.createToken("StringLiteral", `"${this.fileUri}"`, line, column));
    } else if (name === "__LINE__") {
      this.output.push(this.createToken("NumberLiteral", String(line), line, column));
    } else if (REST_OF_LINE_DIRECTIVES.has(name)) {
      this.skipRestOfLine();
    } else if (!NO_ARGUMENT_DIRECTIVES.has(name)) {
      this.expandMacro(name, line, column);
    }
  }
  scanDefine() {
    let name = this.readIdentifierForDirective();
    if (!name) {
      this.skipRestOfLine();
      return;
    }
    let params;
    if (this.peek() === "(") {
      params = this.readMacroParameters();
    }
    this.macros.set(name, { params, body: this.readMacroBody() });
  }
  readMacroParameters() {
    this.advance();
    let params = [];
    for (let text of this.readBalancedArguments()) {
      let eq = text.indexOf("=");
      params.push(
        eq < 0
          ? { name: text.trim() }
          : { name: text.slice(0, eq).trim(), defaultValue: text.slice(eq + 1).trim() },
      );
    }
    return params.filter((param) => param.name);
  }
  readMacroBody() {
    let body = "";
    let inString = false;
    for (; !this.isAtEnd();) {
      let char = this.peek();
      if (char === "\n") {
        break;
      }
      if (char === "\\" && (this.peekNext() === "\n" || this.peekNext() === "\r")) {
        this.advance();
        if (this.peek() === "\r") {
          this.advance();
        }
        this.advance();
        body += "\n";
        continue;
      }
      if (char === "\\" && inString) {
        body += this.advance();
        if (!this.isAtEnd()) {
          body += this.advance();
        }
        continue;
      }
      if (char === '"') {
        inString = !inString;
      }
      if (!inString && char === "/" && this.peekNext() === "/") {
        let lastSlash = -1;
        for (; !this.isAtEnd() && this.peek() !== "\n";) {
          if (this.peek() === "\\") {
            lastSlash = this.index;
          } else if (this.peek() !== "\r" && this.peek() !== " " && this.peek() !== "\t") {
            lastSlash = -1;
          }
          this.advance();
        }
        if (lastSlash >= 0 && !this.isAtEnd()) {
          this.advance();
          body += "\n";
          continue;
        }
        break;
      }
      if (!inString && char === "/" && this.peekNext() === "*") {
        for (this.advance(), this.advance(); !this.isAtEnd();) {
          if (this.peek() === "*" && this.peekNext() === "/") {
            this.advance();
            this.advance();
            break;
          }
          this.advance();
        }
        body += " ";
        continue;
      }
      body += this.advance();
    }
    return body;
  }
  // Reads comma-separated text up to the ')' matching an already-consumed '('.
  readBalancedArguments() {
    let args = [];
    let current = "";
    let depth = 0;
    let inString = false;
    for (; !this.isAtEnd();) {
      let char = this.peek();
      if (inString) {
        if (char === "\\") {
          current += this.advance();
          if (!this.isAtEnd()) {
            current += this.advance();
          }
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        current += this.advance();
        continue;
      }
      if (char === '"') {
        inString = true;
        current += this.advance();
        continue;
      }
      if (char === "/" && this.peekNext() === "/") {
        for (; !this.isAtEnd() && this.peek() !== "\n";) {
          this.advance();
        }
        continue;
      }
      if (char === "/" && this.peekNext() === "*") {
        for (this.advance(), this.advance(); !this.isAtEnd();) {
          if (this.peek() === "*" && this.peekNext() === "/") {
            this.advance();
            this.advance();
            break;
          }
          this.advance();
        }
        continue;
      }
      if (char === "(" || char === "[" || char === "{") {
        depth++;
      } else if (char === "}" || char === "]") {
        depth--;
      } else if (char === ")") {
        if (depth === 0) {
          this.advance();
          args.push(current);
          return args;
        }
        depth--;
      } else if (char === "," && depth === 0) {
        this.advance();
        args.push(current);
        current = "";
        continue;
      }
      current += this.advance();
    }
    args.push(current);
    return args;
  }
  expandMacro(name, line, column) {
    let macro = this.macros.get(name);
    let site = this.callSite ?? this.spanForRange(line, column, this.line, this.column);
    if (!macro) {
      this.output.push(this.createToken("MacroReference", "`" + name, line, column));
      return;
    }
    if (this.macroDepth >= MAX_MACRO_DEPTH) {
      return;
    }
    let body = macro.body;
    if (macro.params) {
      let mark = { index: this.index, line: this.line, column: this.column };
      this.skipWhitespaceAndComments();
      if (this.peek() !== "(") {
        this.index = mark.index;
        this.line = mark.line;
        this.column = mark.column;
        this.output.push(this.createToken("MacroReference", "`" + name, line, column));
        return;
      }
      this.advance();
      let args = this.readBalancedArguments();
      site = this.callSite ?? this.spanForRange(line, column, this.line, this.column);
      body = this.substituteMacroArguments(macro, args);
    }
    body = body.replace(/`\\`"/g, '\\"').replace(/`"/g, '"').replace(/``/g, "");
    let expansion = new SvLexer(body, this.fileUri, {
      macros: this.macros,
      includeResolver: this.includeResolver,
      macroDepth: this.macroDepth + 1,
      callSite: site,
      includeStack: this.includeStack,
    }).tokenize();
    expansion.pop();
    this.output.push(...expansion);
  }
  substituteMacroArguments(macro, args) {
    let values = new Map();
    macro.params.forEach((param, position) => {
      let given = args[position]?.trim();
      values.set(param.name, given ? given : (param.defaultValue ?? ""));
    });
    let result = "";
    let index = 0;
    let body = macro.body;
    let inString = false;
    for (; index < body.length;) {
      let char = body[index];
      if (char === '"' && body[index - 1] !== "`" && body[index - 1] !== "\\") {
        inString = !inString;
      }
      if (/[A-Za-z_]/.test(char) && !inString) {
        let end = index + 1;
        for (; end < body.length && /[A-Za-z0-9_$]/.test(body[end]);) {
          end++;
        }
        let word = body.slice(index, end);
        let previous = body[index - 1];
        result += values.has(word) && previous !== "`" ? values.get(word) : word;
        index = end;
        continue;
      }
      if (char === "`" && body[index + 1] === '"') {
        // Inside `"...`" the parameters still substitute.
        let close = body.indexOf('`"', index + 2);
        if (close > 0) {
          let text = body.slice(index + 2, close);
          for (let [param, value] of values) {
            text = text.replace(new RegExp(`\\b${param}\\b`, "g"), value);
          }
          result += '`"' + text + '`"';
          index = close + 2;
          continue;
        }
      }
      result += char;
      index++;
    }
    return result;
  }
  scanInclude(line, column) {
    this.skipInlineWhitespace();
    let open = this.peek();
    let name = "";
    if (open === '"' || open === "<") {
      let close = open === '"' ? '"' : ">";
      this.advance();
      for (; !this.isAtEnd() && this.peek() !== close && this.peek() !== "\n";) {
        name += this.advance();
      }
      if (this.peek() === close) {
        this.advance();
      }
    } else {
      this.skipRestOfLine();
      return;
    }
    let included = this.includeResolver?.(name, this.fileUri);
    if (!included || this.includeStack.includes(included.uri)) {
      return;
    }
    let site = this.callSite ?? this.spanForRange(line, column, this.line, this.column);
    let tokens = new SvLexer(included.text, included.uri, {
      macros: this.macros,
      includeResolver: this.includeResolver,
      macroDepth: this.macroDepth + 1,
      callSite: site,
      includeStack: [...this.includeStack, included.uri],
    }).tokenize();
    tokens.pop();
    this.output.push(...tokens);
  }
  spanForRange(startLine, startColumn, endLine, endColumn) {
    return makeSpan(this.fileUri, startLine, startColumn, endLine, endColumn);
  }
  nextToken() {
    let line = this.line;
    let column = this.column;
    let char = this.peek();
    let next = this.peekNext();
    if (char === "'") {
      if (next === "{" || next === "(") {
        this.advance();
        this.advance();
        return this.createToken("'" + next, "'" + next, line, column);
      }
      if (/[01xXzZ]/.test(next) && !/[A-Za-z0-9_$]/.test(this.peekAfterNext() || " ")) {
        this.advance();
        this.advance();
        return this.createToken("UnbasedLiteral", "'" + next, line, column);
      }
    }
    for (let operator of SV_OPERATORS) {
      if (this.source.startsWith(operator, this.index)) {
        for (let i = 0; i < operator.length; i++) {
          this.advance();
        }
        return this.createToken(operator, operator, line, column);
      }
    }
    return super.nextToken();
  }
  scanIdentifierOrKeyword(line, column) {
    let text = "";
    for (; !this.isAtEnd() && this.isAlphaNumericOrUnderscore(this.peek());) {
      text += this.advance();
    }
    return this.createToken(SV_KEYWORDS.has(text) ? text : "Identifier", text, line, column);
  }
  scanNumberLiteral(line, column) {
    let text = "";
    for (; !this.isAtEnd() && (this.isDigit(this.peek()) || this.peek() === "_");) {
      text += this.advance();
    }
    if (text) {
      if (this.peek() === "." && this.isDigit(this.peekNext())) {
        text += this.advance();
        for (; !this.isAtEnd() && (this.isDigit(this.peek()) || this.peek() === "_");) {
          text += this.advance();
        }
        text += this.readExponent();
        return this.createToken("NumberLiteral", text + this.readTimeUnit(), line, column);
      }
      let exponent = this.readExponent();
      if (exponent) {
        return this.createToken("NumberLiteral", text + exponent + this.readTimeUnit(), line, column);
      }
      let unit = this.readTimeUnit();
      if (unit) {
        return this.createToken("NumberLiteral", text + unit, line, column);
      }
      this.skipSpaceBeforeBase();
    }
    let baseAt = this.peek() === "'" ? this.peekNext() : "";
    if (baseAt === "s" || baseAt === "S") {
      baseAt = this.peekAfterNext();
    }
    if (this.peek() === "'" && baseAt && this.isBaseSpecifier(baseAt)) {
      text += this.advance();
      if (this.peek() === "s" || this.peek() === "S") {
        text += this.advance();
      }
      text += this.advance();
      this.skipInlineWhitespace();
      for (
        ;
        !this.isAtEnd() &&
        (this.isHexDigit(this.peek()) || /[_xXzZ?]/.test(this.peek()));
      ) {
        text += this.advance();
      }
    }
    return this.createToken("NumberLiteral", text, line, column);
  }
  readExponent() {
    if (this.peek() !== "e" && this.peek() !== "E") {
      return "";
    }
    let at = this.index + 1;
    if (this.source[at] === "+" || this.source[at] === "-") {
      at++;
    }
    if (!/[0-9]/.test(this.source[at] ?? "")) {
      return "";
    }
    let text = "";
    for (; this.index < at;) {
      text += this.advance();
    }
    for (; !this.isAtEnd() && (this.isDigit(this.peek()) || this.peek() === "_");) {
      text += this.advance();
    }
    return text;
  }
  readTimeUnit() {
    for (let unit of TIME_UNITS) {
      if (
        this.source.startsWith(unit, this.index) &&
        !/[A-Za-z0-9_$]/.test(this.source[this.index + unit.length] ?? " ")
      ) {
        for (let i = 0; i < unit.length; i++) {
          this.advance();
        }
        return unit;
      }
    }
    return "";
  }
  skipSpaceBeforeBase() {
    let at = this.index;
    for (; this.source[at] === " " || this.source[at] === "\t";) {
      at++;
    }
    if (at !== this.index && this.source[at] === "'") {
      let base = this.source[at + 1];
      if (base === "s" || base === "S") {
        base = this.source[at + 2];
      }
      if (base && this.isBaseSpecifier(base)) {
        this.skipInlineWhitespace();
      }
    }
  }
  createToken(type, text, line, column) {
    if (this.callSite) {
      return { type, text, span: { ...this.callSite, fromMacro: true } };
    }
    return super.createToken(type, text, line, column);
  }
}
