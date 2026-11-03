import { KEYWORD_SET, Lexer, makeSpan } from "./lexer.js";

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
const DESIGN_UNIT_OPENERS = new Set(["module", "macromodule", "program", "primitive", "package"]);
const DESIGN_UNIT_CLOSERS = new Set(["endmodule", "endprogram", "endprimitive", "endpackage"]);

const NO_ARGUMENT_DIRECTIVES = new Set([
  "celldefine", "endcelldefine", "resetall", "nounconnected_drive", "end_keywords",
  "delay_mode_distributed", "delay_mode_path", "delay_mode_unit", "delay_mode_zero",
]);

const OTHER_DIRECTIVES = new Set(["define", "undef", "undefineall", "include", "ifdef", "ifndef", "else", "elsif", "endif", "__FILE__", "__LINE__"]);

const REST_OF_LINE_DIRECTIVES = new Set([
  "timescale", "default_nettype", "unconnected_drive", "line", "pragma", "begin_keywords",
  "default_decay_time", "default_trireg_strength",
]);

const MAX_MACRO_DEPTH = 64;
// A handful of nested macros can ask for billions of tokens; stop long before that.
const MAX_MACRO_EXPANSIONS = 200000;

export class SvLexer extends Lexer {
  macros;
  includeResolver;
  macroDepth;
  callSite;
  output = [];
  includeStack;
  diagnostics;
  expansionBudget;
  nettypeChanges = [];
  designUnitDepth = 0;
  hasUnresolvedInclude = false;
  legacyKeywords = [];
  constructor(source, fileUri = "file:///untitled.sv", options = {}) {
    super(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source, fileUri);
    this.diagnostics = options.diagnostics ?? [];
    this.expansionBudget = options.expansionBudget ?? { used: 0 };
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
      let token = this.nextToken();
      this.checkLiteral(token);
      this.trackDesignUnit(token);
      // `\\cpu3 ` and `cpu3` are one identifier (IEEE 1800 5.6.1).
      if (token.type === "EscapedIdentifier" && /^\\[a-zA-Z_][a-zA-Z0-9_$]*$/.test(token.text) && !SV_KEYWORDS.has(token.text.slice(1))) {
        token.type = "Identifier";
        token.text = token.text.slice(1);
      }
      this.output.push(token);
    }
    if (this.macroDepth === 0 && this.includeStack.length === 1 && this.conditionalStack.length > 0) {
      this.addLexerError("Missing `endif for a conditional directive", this.line, this.column);
    }
    this.output.push(this.createToken("EOF", "", this.line, this.column));
    return this.output;
  }
  trackDesignUnit(token) {
    if (DESIGN_UNIT_OPENERS.has(token.type)) {
      this.designUnitDepth++;
    } else if (DESIGN_UNIT_CLOSERS.has(token.type)) {
      this.designUnitDepth--;
    }
  }
  readDirectiveLine() {
    let text = "";
    for (; !this.isAtEnd() && this.peek() !== "\n";) {
      text += this.advance();
    }
    return text.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").trim();
  }
  // Rest-of-line directives have a fixed form; a macro in the arguments defers the question.
  checkDirectiveLine(name, text, line, column) {
    if (text.includes("`")) {
      return;
    }
    if (name === "line" && !/^\d+\s+"[^"]*"\s+[012]$/.test(text)) {
      this.addLexerError("`line needs a positive number, a quoted file name and a level of 0, 1 or 2", line, column);
    } else if (name === "timescale") {
      this.checkTimescale(text, line, column);
    } else if (name === "unconnected_drive" && text !== "pull0" && text !== "pull1") {
      this.addLexerError("`unconnected_drive takes pull0 or pull1", line, column);
    } else if (name === "pragma" && text === "") {
      this.addLexerError("`pragma needs a pragma name", line, column);
    }
  }
  checkTimescale(text, line, column) {
    let parts = /^(1|10|100)\s*(s|ms|us|ns|ps|fs)\s*\/\s*(1|10|100)\s*(s|ms|us|ns|ps|fs)$/.exec(text);
    if (!parts) {
      this.addLexerError("`timescale needs 1, 10 or 100 and a time unit, for both unit and precision", line, column);
      return;
    }
    let power = (value, unit) => Math.log10(Number(value)) + 3 * TIME_UNITS.indexOf(unit);
    if (power(parts[3], parts[4]) > power(parts[1], parts[2])) {
      this.addLexerError("`timescale precision cannot be coarser than the time unit", line, column);
    }
  }
  checkLiteral(token) {
    if (token.type === "StringLiteral") {
      let text = token.text;
      if (text.length < 2 || !text.endsWith('"') || /(^|[^\\])\n/.test(text)) {
        this.diagnostics.push({ message: "Unterminated string literal", severity: "error", code: "SYNTAX-STRING", span: this.callSite ?? token.span });
      }
    } else if (token.type === "NumberLiteral") {
      let based = /^\d*\s*'[sS]?([bBoOdDhH])\s*(.*)$/.exec(token.text);
      let digits = based?.[2].replace(/_/g, "");
      let valid = { b: /^[01xzXZ?]+$/, o: /^[0-7xzXZ?]+$/, d: /^(\d+|[xXzZ?])$/, h: /^[0-9a-fA-FxzXZ?]+$/ };
      if (based && !valid[based[1].toLowerCase()].test(digits)) {
        this.diagnostics.push({ message: `Invalid digits in number '${token.text}'`, severity: "error", code: "SYNTAX-NUMBER", span: this.callSite ?? token.span });
      }
    }
  }
  addLexerError(message, line, column) {
    let span = this.callSite ?? this.spanForRange(line, column, this.line, this.column);
    this.diagnostics.push({ message, severity: "error", code: "SYNTAX-PREPROCESSOR", span });
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
        } else {
          this.addLexerError("`elsif without a matching `ifdef", line, column);
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
        } else {
          this.addLexerError("`else without a matching `ifdef", line, column);
        }
        return;
      }
      case "endif":
        if (this.conditionalStack.length === 0) {
          this.addLexerError("`endif without a matching `ifdef", line, column);
        }
        this.conditionalStack.pop();
        return;
    }
    if (!this.isActive()) {
      return;
    }
    if (name === "default_nettype") {
      this.scanDefaultNettype(line);
    } else if (name === "resetall") {
      if (this.designUnitDepth > 0) {
        this.addLexerError("`resetall is not allowed inside a design unit", line, column);
      }
      this.nettypeChanges.push({ line, value: "wire" });
    } else if (name === "begin_keywords") {
      this.scanBeginKeywords();
    } else if (name === "end_keywords") {
      this.legacyKeywords.pop();
    } else if (name === "define") {
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
      this.checkDirectiveLine(name, this.readDirectiveLine(), line, column);
    } else if (!NO_ARGUMENT_DIRECTIVES.has(name)) {
      this.expandMacro(name, line, column);
    }
  }
  scanDefaultNettype(line) {
    this.skipInlineWhitespace();
    let value = "";
    for (; !this.isAtEnd() && this.isAlphaNumericOrUnderscore(this.peek());) {
      value += this.advance();
    }
    this.nettypeChanges.push({ line, value });
  }
  scanBeginKeywords() {
    this.skipInlineWhitespace();
    let version = "";
    for (; !this.isAtEnd() && this.peek() !== "\n";) {
      version += this.advance();
    }
    this.legacyKeywords.push(/"1364-/.test(version));
  }
  scanDefine() {
    let name = this.readIdentifierForDirective();
    if (name && (NO_ARGUMENT_DIRECTIVES.has(name) || REST_OF_LINE_DIRECTIVES.has(name) || OTHER_DIRECTIVES.has(name))) {
      this.addLexerError(`Compiler directive '\`${name}' cannot be redefined`, this.line, this.column);
    }
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
    if (++this.expansionBudget.used > MAX_MACRO_EXPANSIONS) {
      if (this.expansionBudget.used === MAX_MACRO_EXPANSIONS + 1) {
        this.addLexerError(`Too many macro expansions (limit ${MAX_MACRO_EXPANSIONS}); the rest are ignored`, line, column);
      }
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
        this.addLexerError(`Macro '${name}' needs an argument list`, line, column);
        return;
      }
      this.advance();
      let args = this.readBalancedArguments();
      site = this.callSite ?? this.spanForRange(line, column, this.line, this.column);
      this.checkMacroArguments(name, macro, args, line, column);
      body = this.substituteMacroArguments(macro, args);
    }
    body = body.replace(/`\\`"/g, '\\"').replace(/`"/g, '"').replace(/``/g, "");
    let expansion = new SvLexer(body, this.fileUri, {
      macros: this.macros,
      includeResolver: this.includeResolver,
      macroDepth: this.macroDepth + 1,
      callSite: site,
      includeStack: this.includeStack,
      diagnostics: this.diagnostics,
      expansionBudget: this.expansionBudget,
    }).tokenize();
    expansion.pop();
    for (let token of expansion) {
      this.output.push(token);
    }
  }
  checkMacroArguments(name, macro, args, line, column) {
    if (args.length > Math.max(macro.params.length, 1)) {
      this.addLexerError(`Macro '${name}' takes ${macro.params.length} argument(s) but is given ${args.length}`, line, column);
      return;
    }
    let missing = macro.params.slice(args.length).find((param) => param.defaultValue === undefined);
    if (missing) {
      this.addLexerError(`Macro '${name}' is missing argument '${missing.name}'`, line, column);
    }
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
    if (this.includeResolver && !included) {
      this.hasUnresolvedInclude = true;
      let span = this.callSite ?? this.spanForRange(line, column, this.line, this.column);
      this.diagnostics.push({
        message: `Cannot find include file '${name}'; its macros and declarations are unknown here`,
        severity: "warning",
        code: "SYNTAX-INCLUDE-NOT-FOUND",
        span,
      });
    }
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
      diagnostics: this.diagnostics,
      expansionBudget: this.expansionBudget,
    }).tokenize();
    tokens.pop();
    for (let token of tokens) {
      this.output.push(token);
    }
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
    let isKeyword = SV_KEYWORDS.has(text);
    if (isKeyword && this.legacyKeywords[this.legacyKeywords.length - 1] && !KEYWORD_SET.has(text)) {
      isKeyword = false;
    }
    return this.createToken(isKeyword ? text : "Identifier", text, line, column);
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
