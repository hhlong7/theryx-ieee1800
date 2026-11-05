import { makeSpan } from "./lexer.js";

const BLOCK_END_KEYWORDS = ["end", "endmodule", "endcase", "endgenerate", "endfunction", "endtask"];

const SYNC_TOKENS = [";", ...BLOCK_END_KEYWORDS];

const MAX_DEPTH = 200;

const GATE_KEYWORDS = [
  "and",
  "nand",
  "nor",
  "xor",
  "xnor",
  "not",
  "buf",
  "bufif0",
  "bufif1",
  "notif0",
  "notif1",
];

const GATE_TYPES = {
  and: "and",
  nand: "nand",
  nor: "nor",
  xor: "xor",
  xnor: "xnor",
  not: "not",
  buf: "buf",
  bufif0: "bufif0",
  bufif1: "bufif1",
  notif0: "notif0",
  notif1: "notif1",
};

const STATEMENT_START_KEYWORDS = ["for", "while", "repeat", "forever", "if"];

export class Parser {
  tokens;
  fileUri;
  cursor = 0;
  depth = 0;
  diagnostics = [];
  constructor(tokens, fileUri = "file:///untitled.v") {
    this.tokens = tokens;
    this.fileUri = fileUri;
  }
  parse() {
    let d = [];
    let span = this.peek().span;
    for (; !this.isAtEnd();) {
      if (this.match("module")) {
        let E = this.parseModule();
        if (E) {
          d.push(E);
        }
      } else {
        this.addDiagnostic(
          `Unexpected token '${this.peek().text}' outside module definition`,
          this.peek().span,
        );
        this.advance();
      }
    }
    let span2 = this.previous().span;
    return {
      kind: "SourceFile",
      modules: d,
      span: this.combineSpans(span, span2),
    };
  }
  parseModule() {
    let prevToken = this.previous();
    let m = this.match("Identifier", "EscapedIdentifier") ? this.previous() : null;
    if (!m) {
      this.addDiagnostic("Expected module name after 'module'", this.peek().span);
      this.synchronize(["endmodule", ";"]);
      return null;
    }
    let k = [];
    if (this.match("#") && this.match("(")) {
      let delimitedList = this.parseDelimitedList({
        parseItem: () => {
          this.match("parameter", "localparam");
          if (this.check("[")) {
            this.parseRange();
          }
          let token = this.consume("Identifier", "Expected parameter name in module header");
          let J;
          if (this.match("=")) {
            J = this.parseExpression();
          }
          return token
            ? {
                name: token.text,
                valueExpr: J,
                span: token.span,
              }
            : null;
        },
        isItemStart: () =>
          this.check("parameter") || this.check("localparam") || this.check("Identifier"),
        terminator: ")",
        missingDelimiterMessage: "Expected ',' between module parameters",
      });
      this.consume(")", "Expected ')' after module parameter list");
      if (delimitedList.length > 0) {
        k.push({
          kind: "ParameterDeclaration",
          isLocal: false,
          parameters: delimitedList,
          span: this.combineSpans(
            delimitedList[0].span,
            delimitedList[delimitedList.length - 1].span,
          ),
        });
      }
    }
    let E;
    if (this.match("(")) {
      let v = [];
      if (!this.check(")")) {
        let delimitedList2 = this.parseDelimitedList({
          parseItem: () => {
            if (this.match("input", "output", "inout")) {
              let portDeclaration = this.parsePortDeclaration(false);
              if (portDeclaration) {
                for (let identifier of portDeclaration.identifiers) {
                  v.push(identifier.name);
                }
              }
              return portDeclaration;
            }
            return this.match("Identifier", "EscapedIdentifier")
              ? (v.push(this.previous().text), null)
              : (this.skipUntil(")"), null);
          },
          isItemStart: () =>
            this.check("input") ||
            this.check("output") ||
            this.check("inout") ||
            this.check("Identifier") ||
            this.check("EscapedIdentifier"),
          terminator: ")",
          missingDelimiterMessage: "Expected ',' between port declarations in module header",
        });
        k.push(...delimitedList2);
      }
      this.consume(")", "Expected ')' after module port list");
      E = v;
    }
    for (
      this.consume(";", "Expected ';' after module header");
      !this.check("endmodule") && !this.isAtEnd();
    ) {
      try {
        let moduleItem = this.parseModuleItem();
        if (moduleItem) {
          k.push(moduleItem);
        }
      } catch {
        this.synchronize(SYNC_TOKENS);
      }
    }
    let token2 = this.consume("endmodule", "Expected 'endmodule' to close module declaration");
    let M = token2 ? token2.span : this.previous().span;
    return {
      kind: "ModuleDeclaration",
      name: m.text,
      nameSpan: m.span,
      items: k,
      portNames: E,
      span: this.combineSpans(prevToken.span, M),
    };
  }
  parseModuleItem() {
    if (this.match("input", "output", "inout")) {
      return this.parsePortDeclaration();
    }
    if (this.match("wire", "reg")) {
      return this.parseNetDeclaration();
    }
    if (this.match("integer", "real", "time")) {
      return this.parseVariableDeclaration();
    }
    if (this.match("parameter", "localparam")) {
      return this.parseParameterDeclaration();
    }
    if (this.match("assign")) {
      return this.parseContinuousAssign();
    }
    if (this.match("always")) {
      return this.parseAlwaysBlock();
    }
    if (this.match("initial")) {
      return this.parseInitialBlock();
    }
    if (this.match("generate")) {
      return this.parseGenerateBlock();
    }
    if (this.match("genvar")) {
      return this.parseGenvarDeclaration();
    }
    if (this.match("function")) {
      return this.parseFunctionDeclaration();
    }
    if (this.match("task")) {
      return this.parseTaskDeclaration();
    }
    if (this.checkAny(GATE_KEYWORDS)) {
      return this.parseGateInstantiation();
    }
    if (this.check("Identifier")) {
      let type = this.peekNext().type;
      if (type === "Identifier") {
        if (this.peekNextNext().type === "(") {
          return this.parseInstanceDeclaration();
        }
      } else if (type === "#") {
        return this.parseInstanceDeclaration();
      }
    }
    if (!this.match(";")) {
      this.addDiagnostic(`Unexpected token '${this.peek().text}' in module body`, this.peek().span);
      this.advance();
    }
    return null;
  }
  parseParameterDeclaration() {
    let prevToken = this.previous();
    let m = prevToken.type === "localparam";
    let k;
    this.match("signed", "unsigned");
    if (this.check("[")) {
      k = this.parseRange();
    } else {
      if (this.check("Identifier") && this.peekNext().type === "[") {
        this.advance();
        k = this.parseRange();
      }
    }
    let delimitedList = this.parseDelimitedList({
      parseItem: () => {
        let token = this.consume("Identifier", "Expected parameter name");
        let R;
        if (this.match("=")) {
          R = this.parseExpression();
        }
        return token
          ? {
              name: token.text,
              valueExpr: R,
              span: token.span,
            }
          : null;
      },
      isItemStart: () => this.check("Identifier"),
      terminator: ";",
      missingDelimiterMessage: "Expected ',' between parameter declarations",
    });
    let token2 = this.consume(";", "Expected ';' after parameter declaration");
    let M = token2 ? token2.span : this.previous().span;
    return {
      kind: "ParameterDeclaration",
      isLocal: m,
      range: k,
      parameters: delimitedList,
      span: this.combineSpans(prevToken.span, M),
    };
  }
  parsePortDeclaration(d = true) {
    let prevToken = this.previous();
    let text = prevToken.text;
    let E;
    if (this.match("wire", "reg")) {
      E = this.previous().text;
    } else {
      if (this.match("integer", "real", "time")) {
        E = this.previous().text;
      }
    }
    let C;
    if (this.match("signed", "unsigned")) {
      C = this.previous().text;
    }
    let M;
    if (this.check("[")) {
      M = this.parseRange();
    }
    let v = [];
    for (; !this.check(";") && !this.check(")") && !this.isAtEnd();) {
      let token = this.consume("Identifier", "Expected identifier in port declaration");
      if (
        (token &&
          v.push({
            kind: "Identifier",
            name: token.text,
            span: token.span,
          }),
        this.check(",") && this.peekNext().type === "Identifier")
      ) {
        this.advance();
        continue;
      }
      if (this.check("Identifier")) {
        this.addDiagnostic(
          "Expected ',' between port identifiers",
          this.previous().span,
          "error",
          "SYNTAX-MISSING-COMMA",
        );
        continue;
      }
      break;
    }
    let R;
    if (d) {
      let token2 = this.consume(";", "Expected ';' after port declaration");
      R = token2 ? token2.span : this.previous().span;
    } else {
      R = v.length > 0 ? v[v.length - 1].span : prevToken.span;
    }
    return {
      kind: "PortDeclaration",
      direction: text,
      netType: E,
      signedness: C,
      range: M,
      identifiers: v,
      span: this.combineSpans(prevToken.span, R),
    };
  }
  parseNetDeclaration() {
    let prevToken = this.previous();
    let text = prevToken.text;
    let k;
    if (this.match("signed", "unsigned")) {
      k = this.previous().text;
    }
    let E;
    if (this.check("[")) {
      E = this.parseRange();
    }
    let C = [];
    let M = [];
    let v = [];
    for (; !this.check(";") && !this.isAtEnd();) {
      let token = this.consume("Identifier", "Expected identifier in net declaration");
      for (
        token &&
        C.push({
          kind: "Identifier",
          name: token.text,
          span: token.span,
        });
        this.check("[");
      ) {
        M.push(this.parseRange());
      }
      if (token && this.check("=")) {
        this.advance();
        let expression = this.parseExpression();
        v.push({
          name: token.text,
          nameSpan: token.span,
          expr: expression,
        });
      }
      if (this.check(",")) {
        if (this.peekNext().type === "Identifier") {
          this.advance();
          continue;
        } else if (this.peekNext().type === ";") {
          this.advance();
          this.addDiagnostic(
            "Unexpected trailing comma",
            this.previous().span,
            "error",
            "SYNTAX-TRAILING-COMMA",
          );
          break;
        }
      }
      if (this.check("Identifier")) {
        this.addDiagnostic(
          "Expected ',' between net identifiers",
          this.previous().span,
          "error",
          "SYNTAX-MISSING-COMMA",
        );
        continue;
      }
      break;
    }
    let token2 = this.consume(";", "Expected ';' after net declaration");
    let J = token2 ? token2.span : this.previous().span;
    return {
      kind: "NetDeclaration",
      netType: text,
      signedness: k,
      range: E,
      identifiers: C,
      dimensions: M.length > 0 ? M : undefined,
      assignments: v.length > 0 ? v : undefined,
      span: this.combineSpans(prevToken.span, J),
    };
  }
  parseVariableDeclaration() {
    let prevToken = this.previous();
    let text = prevToken.text;
    let k;
    if (this.match("signed", "unsigned")) {
      k = this.previous().text;
    }
    let E;
    if (this.check("[")) {
      E = this.parseRange();
    }
    let C = [];
    let M;
    for (; !this.check(";") && !this.isAtEnd();) {
      let token = this.consume("Identifier", "Expected identifier in variable declaration");
      if (
        (token &&
          C.push({
            kind: "Identifier",
            name: token.text,
            span: token.span,
          }),
        this.match("=") && (M = this.parseExpression()),
        this.check(",") && this.peekNext().type === "Identifier")
      ) {
        this.advance();
        continue;
      }
      break;
    }
    let token2 = this.consume(";", "Expected ';' after variable declaration");
    let R = token2 ? token2.span : this.previous().span;
    return {
      kind: "VariableDeclaration",
      dataType: text,
      signedness: k,
      range: E,
      identifiers: C,
      initExpr: M,
      span: this.combineSpans(prevToken.span, R),
    };
  }
  parseContinuousAssign() {
    let prevToken = this.previous();
    let lhs = this.parseLhs();
    this.consume("=", "Expected '=' in continuous assignment");
    let expression = this.parseExpression();
    let token = this.consume(";", "Expected ';' after continuous assignment");
    let C = token ? token.span : expression.span;
    return {
      kind: "ContinuousAssign",
      lhs: lhs,
      rhs: expression,
      span: this.combineSpans(prevToken.span, C),
    };
  }
  parseInitialBlock() {
    let prevToken = this.previous();
    let statement = this.parseStatement();
    return {
      kind: "InitialBlock",
      statement: statement,
      span: this.combineSpans(prevToken.span, statement.span),
    };
  }
  parseGenerateBlock() {
    let prevToken = this.previous();
    let m = [];
    let k = [];
    for (; !this.check("endgenerate") && !this.isAtEnd();) {
      try {
        if (this.checkAny(STATEMENT_START_KEYWORDS)) {
          k.push(this.parseGenerateStatement());
        } else {
          let moduleItem = this.parseModuleItem();
          if (moduleItem) {
            m.push(moduleItem);
          }
        }
      } catch {
        this.synchronize(SYNC_TOKENS);
      }
    }
    let token = this.consume("endgenerate", "Expected 'endgenerate' to close generate block");
    let C = token ? token.span : this.previous().span;
    return {
      kind: "GenerateBlock",
      items: m,
      statements: k,
      span: this.combineSpans(prevToken.span, C),
    };
  }
  parseGenerateStatement() {
    if (this.check("begin")) {
      this.advance();
      return this.parseGenerateBlockStatement();
    }
    if (this.match("for", "while", "repeat", "forever")) {
      let prevToken = this.previous();
      let text = prevToken.text;
      let k;
      let E;
      let C;
      let M;
      if (text === "for") {
        this.consume("(", "Expected '(' after 'for'");
        k = this.parseForInit();
        this.consume(";", "Expected ';' after for-loop initialisation");
        E = this.parseExpression();
        this.consume(";", "Expected ';' after for-loop condition");
        C = this.parseAssignmentExpression();
        this.consume(")", "Expected ')' after for-loop header");
      } else {
        if (text === "while") {
          this.consume("(", "Expected '(' after 'while'");
          E = this.parseExpression();
          this.consume(")", "Expected ')' after while condition");
        } else {
          if (text === "repeat") {
            this.consume("(", "Expected '(' after 'repeat'");
            M = this.parseExpression();
            this.consume(")", "Expected ')' after repeat count");
          }
        }
      }
      let generateBody = this.parseGenerateBody();
      return {
        kind: "GenerateLoopStatement",
        loopKind: text,
        initExpr: k,
        condition: E,
        stepExpr: C,
        countExpr: M,
        body: generateBody,
        span: this.combineSpans(prevToken.span, generateBody.span),
      };
    }
    return this.parseStatement();
  }
  parseGenerateBody() {
    if (this.check("begin")) {
      this.advance();
      return this.parseGenerateBlockStatement();
    }
    let moduleItem = this.parseModuleItem();
    return moduleItem
      ? {
          kind: "GenerateBlockStatement",
          name: undefined,
          items: [moduleItem],
          statements: [],
          span: moduleItem.span,
        }
      : this.parseStatement();
  }
  parseGenerateBlockStatement() {
    let prevToken = this.previous();
    let m;
    if (this.match(":")) {
      let token = this.consume("Identifier", "Expected block name after ':' in generate block");
      if (token) {
        m = token.text;
      }
    }
    let k = [];
    let E = [];
    for (; !this.check("end") && !this.isAtEnd();) {
      try {
        if (this.checkAny(STATEMENT_START_KEYWORDS)) {
          E.push(this.parseGenerateStatement());
        } else {
          let moduleItem = this.parseModuleItem();
          if (moduleItem) {
            k.push(moduleItem);
          }
        }
      } catch {
        this.synchronize(SYNC_TOKENS);
      }
    }
    let token2 = this.consume("end", "Expected 'end' to close generate block");
    if (this.match(":")) {
      this.consume("Identifier", "Expected block name after ':' in end statement");
    }
    return {
      kind: "GenerateBlockStatement",
      name: m,
      items: k,
      statements: E,
      span: this.combineSpans(prevToken.span, token2 ? token2.span : this.previous().span),
    };
  }
  parseGenvarDeclaration() {
    let prevToken = this.previous();
    let m = [];
    for (; !this.check(";") && !this.isAtEnd();) {
      let token = this.consume("Identifier", "Expected identifier in genvar declaration");
      if (
        (token &&
          m.push({
            kind: "Identifier",
            name: token.text,
            span: token.span,
          }),
        this.check(",") && this.peekNext().type === "Identifier")
      ) {
        this.advance();
        continue;
      }
      break;
    }
    let token2 = this.consume(";", "Expected ';' after genvar declaration");
    let E = token2 ? token2.span : this.previous().span;
    return {
      kind: "GenvarDeclaration",
      identifiers: m,
      span: this.combineSpans(prevToken.span, E),
    };
  }
  parseFunctionDeclaration() {
    let prevToken = this.previous();
    let m;
    if (this.match("signed", "unsigned")) {
      m = this.previous().text;
    }
    let k;
    if (this.match("integer", "real", "time")) {
      k = this.previous().text;
    }
    let E;
    if (this.check("[")) {
      E = this.parseRange();
    }
    let token = this.consume("Identifier", "Expected function name");
    let M = token ? token.text : "<error>";
    let v = [];
    if (this.match("(")) {
      if (!this.check(")")) {
        v.push(
          ...this.parseDelimitedList({
            parseItem: () =>
              this.match("input", "output", "inout")
                ? this.parsePortDeclaration(false)
                : (this.skipUntil(")"), null),
            isItemStart: () => this.check("input") || this.check("output") || this.check("inout"),
            terminator: ")",
            missingDelimiterMessage: "Expected ',' between function port declarations",
          }),
        );
      }
      this.consume(")", "Expected ')' after function port list");
    }
    this.consume(";", "Expected ';' after function header");
    let R = [];
    for (; !this.check("endfunction") && !this.isAtEnd();) {
      try {
        if (this.match("input", "output", "inout")) {
          v.push(this.parsePortDeclaration());
          continue;
        }
        R.push(this.parseStatement());
      } catch {
        this.synchronize(SYNC_TOKENS);
      }
    }
    let token2 = this.consume("endfunction", "Expected 'endfunction' to close function");
    let X = token2 ? token2.span : this.previous().span;
    return {
      kind: "FunctionDeclaration",
      name: M,
      nameSpan: token ? token.span : undefined,
      range: E,
      signedness: m,
      returnType: k,
      ports: v,
      statements: R,
      span: this.combineSpans(prevToken.span, X),
    };
  }
  parseTaskDeclaration() {
    let prevToken = this.previous();
    let m = false;
    if (this.check("Identifier") && this.peek().text === "automatic") {
      this.advance();
      m = true;
    }
    let token = this.consume("Identifier", "Expected task name");
    let E = token ? token.text : "<error>";
    let C = [];
    if (this.match("(")) {
      if (!this.check(")")) {
        C.push(
          ...this.parseDelimitedList({
            parseItem: () =>
              this.match("input", "output", "inout")
                ? this.parsePortDeclaration(false)
                : (this.skipUntil(")"), null),
            isItemStart: () => this.check("input") || this.check("output") || this.check("inout"),
            terminator: ")",
            missingDelimiterMessage: "Expected ',' between task port declarations",
          }),
        );
      }
      this.consume(")", "Expected ')' after task port list");
    }
    this.consume(";", "Expected ';' after task header");
    let M = [];
    for (; !this.check("endtask") && !this.isAtEnd();) {
      try {
        if (this.match("input", "output", "inout")) {
          C.push(this.parsePortDeclaration());
          continue;
        }
        M.push(this.parseStatement());
      } catch {
        this.synchronize(SYNC_TOKENS);
      }
    }
    let token2 = this.consume("endtask", "Expected 'endtask' to close task");
    let R = token2 ? token2.span : this.previous().span;
    return {
      kind: "TaskDeclaration",
      name: E,
      nameSpan: token ? token.span : undefined,
      isAutomatic: m,
      ports: C,
      statements: M,
      span: this.combineSpans(prevToken.span, R),
    };
  }
  parseGateInstantiation() {
    let token = this.advance();
    let m = GATE_TYPES[token.type] ?? "and";
    let k = [];
    do {
      let M = "";
      let v;
      let R;
      if (this.check("Identifier")) {
        let token2 = this.advance();
        M = token2.text;
        v = token2.span;
        if (this.check("[")) {
          R = this.parseRange();
        }
      }
      this.consume("(", "Expected '(' after gate instance name");
      let delimitedList = this.parseDelimitedList({
        parseItem: () => this.parseExpression(),
        isItemStart: () => this.isExpressionStart(),
        terminator: ")",
        missingDelimiterMessage: "Expected ',' between gate terminals",
      });
      this.consume(")", "Expected ')' after gate terminals");
      k.push({
        name: M,
        nameSpan: v,
        range: R,
        terminals: delimitedList,
      });
    } while (this.match(","));
    let token3 = this.consume(";", "Expected ';' after gate instantiation");
    let C = token3 ? token3.span : this.previous().span;
    return {
      kind: "GateInstantiation",
      gateType: m,
      instances: k,
      span: this.combineSpans(token.span, C),
    };
  }
  parseAlwaysBlock() {
    let prevToken = this.previous();
    let m = [];
    let k = false;
    let E;
    if (this.check("#")) {
      this.advance();
      if (this.match("(")) {
        E = this.parseExpression();
        this.consume(")", "Expected ')' after delay expression");
      } else {
        if (this.check("NumberLiteral")) {
          E = this.parseExpression();
        }
      }
    } else {
      if (this.check("@")) {
        this.advance();
        if (this.match("*")) {
          m.push({
            kind: "SensitivityItem",
            edge: "all",
            span: this.previous().span,
          });
        } else {
          this.consume("(", "Expected '(' after '@'");
          if (this.match("*")) {
            m.push({
              kind: "SensitivityItem",
              edge: "all",
              span: this.previous().span,
            });
            this.consume(")", "Expected ')' after sensitivity list");
          } else {
            m.push(
              ...this.parseDelimitedList({
                parseItem: () => {
                  let M = "none";
                  let span = this.peek().span;
                  if (this.match("posedge")) {
                    M = "posedge";
                    k = true;
                    span = this.previous().span;
                  } else {
                    if (this.match("negedge")) {
                      M = "negedge";
                      k = true;
                      span = this.previous().span;
                    }
                  }
                  let token = this.consume(
                    "Identifier",
                    "Expected signal identifier in sensitivity list",
                  );
                  let J = token ? token.span : span;
                  if (this.match("[")) {
                    let X = 1;
                    for (; X > 0 && !this.isAtEnd();) {
                      if (this.check("[")) {
                        X++;
                      } else if (this.check("]") && (X--, X === 0)) {
                        J = this.combineSpans(J, this.peek().span);
                        this.advance();
                        break;
                      }
                      this.advance();
                    }
                  }
                  return {
                    kind: "SensitivityItem",
                    edge: M,
                    signal: token
                      ? {
                          kind: "Identifier",
                          name: token.text,
                          span: J,
                        }
                      : undefined,
                    span: this.combineSpans(span, J),
                  };
                },
                isItemStart: () =>
                  this.check("posedge") || this.check("negedge") || this.check("Identifier"),
                delimiters: ["or", ","],
                terminator: ")",
                missingDelimiterMessage: "Expected 'or' or ',' between signals in sensitivity list",
              }),
            );
            this.consume(")", "Expected ')' after sensitivity list");
          }
        }
      }
    }
    let statement = this.parseStatement();
    return {
      kind: "AlwaysBlock",
      isSequential: k,
      sensitivities: m,
      delayExpr: E,
      statement: statement,
      span: this.combineSpans(prevToken.span, statement.span),
    };
  }
  parseInstanceDeclaration() {
    let token = this.advance();
    if (this.match("#")) {
      this.consume("(", "Expected '(' after '#' in parameterized instance");
      let M = 1;
      for (; M > 0 && !this.isAtEnd();) {
        if (this.check("(")) {
          M++;
        } else if (this.check(")") && (M--, M === 0)) {
          this.advance();
          break;
        }
        this.advance();
      }
    }
    let token2 = this.consume("Identifier", "Expected instance name after module type");
    if (!token2) {
      return null;
    }
    this.consume("(", "Expected '(' after instance name");
    let k = 0;
    let delimitedList = this.parseDelimitedList({
      parseItem: () => {
        if (this.match(".")) {
          let token = this.consume("Identifier", "Expected port name after .");
          this.consume("(", "Expected '(' after port name");
          let v;
          if (!this.check(")")) {
            v = this.parseExpression();
          }
          let token2 = this.consume(")", "Expected ')' after port connection expression");
          return token
            ? {
                kind: "NamedPortConnection",
                portName: token.text,
                portNameSpan: token.span,
                expression: v,
                span: this.combineSpans(token.span, token2 ? token2.span : v ? v.span : token.span),
              }
            : null;
        } else {
          let expression = this.parseExpression();
          return {
            kind: "NamedPortConnection",
            portName: `__pos_${k++}`,
            expression: expression,
            span: expression.span,
          };
        }
      },
      isItemStart: () => this.check(".") || this.isExpressionStart(),
      terminator: ")",
      missingDelimiterMessage: "Expected ',' between port connections",
    });
    this.consume(")", "Expected ')' after instance connections");
    let token3 = this.consume(";", "Expected ';' after module instantiation");
    return {
      kind: "InstanceDeclaration",
      moduleName: token.text,
      moduleNameSpan: token.span,
      instanceName: token2.text,
      instanceNameSpan: token2.span,
      portConnections: delimitedList,
      span: this.combineSpans(token.span, token3 ? token3.span : this.previous().span),
    };
  }
  parseStatement() {
    if (this.depth > MAX_DEPTH) {
      this.addDiagnostic(
        `Maximum nesting depth (${MAX_DEPTH}) exceeded \u2014 the rest of this statement is skipped`,
        this.peek().span,
        "error",
        "SYNTAX-MAX-DEPTH",
      );
      this.skipToStatementBoundary();
      return {
        kind: "EmptyStatement",
        span: this.peek().span,
      };
    }
    this.depth++;
    try {
      return this.parseStatementInner();
    } finally {
      this.depth--;
    }
  }
  skipToStatementBoundary() {
    for (; !this.isAtEnd();) {
      if (
        this.check(";") ||
        this.check("end") ||
        this.check("endmodule") ||
        this.check("endcase") ||
        this.check("endgenerate") ||
        this.check("endfunction") ||
        this.check("endtask")
      ) {
        return;
      }
      this.advance();
    }
  }
  parseStatementInner() {
    if (this.match("begin")) {
      let span = this.previous().span;
      let k;
      if (this.match(":")) {
        let token = this.consume("Identifier", "Expected block name after ':' in begin statement");
        if (token) {
          k = token.text;
        }
      }
      let E = [];
      for (; !this.check("end") && !this.isAtEnd();) {
        try {
          E.push(this.parseStatement());
        } catch {
          this.synchronize([";", "end"]);
        }
      }
      let token2 = this.consume("end", "Expected 'end' to close block");
      if (this.match(":")) {
        this.consume("Identifier", "Expected block name after ':' in end statement");
      }
      return {
        kind: "BlockStatement",
        name: k,
        statements: E,
        span: this.combineSpans(span, token2 ? token2.span : this.previous().span),
      };
    }
    if (this.match("if")) {
      let span2 = this.previous().span;
      this.consume("(", "Expected '(' after 'if'");
      let expression = this.parseExpression();
      this.consume(")", "Expected ')' after if condition");
      let statement = this.parseStatement();
      let C;
      if (this.match("else")) {
        C = this.parseStatement();
      }
      return {
        kind: "IfStatement",
        condition: expression,
        thenBranch: statement,
        elseBranch: C,
        span: this.combineSpans(span2, C ? C.span : statement.span),
      };
    }
    if (this.match("case", "casez", "casex")) {
      return this.parseCaseStatement();
    }
    if (this.match("for", "while", "repeat", "forever")) {
      return this.parseLoopStatement();
    }
    if (this.check("@")) {
      return this.parseEventControlStatement();
    }
    if (this.check("#")) {
      return this.parseDelayStatement();
    }
    if (this.check("SystemIdentifier")) {
      return this.parseSystemTaskCall();
    }
    if (this.check("Identifier") && this.peekNext().type === "(") {
      return this.parseTaskCallStatement();
    }
    if (this.check("Identifier") && this.peekNext().type === ";") {
      return this.parseTaskCallWithoutParens();
    }
    if (this.match(";")) {
      return {
        kind: "EmptyStatement",
        span: this.previous().span,
      };
    }
    let lhs = this.parseLhs();
    if (this.match("<=")) {
      let expression2 = this.parseExpression();
      let token3 = this.consume(";", "Expected ';' after non-blocking assignment");
      return {
        kind: "NonBlockingAssign",
        lhs: lhs,
        rhs: expression2,
        span: this.combineSpans(lhs.span, token3 ? token3.span : expression2.span),
      };
    }
    if (this.match("=")) {
      let expression3 = this.parseExpression();
      let token4 = this.consume(";", "Expected ';' after blocking assignment");
      return {
        kind: "BlockingAssign",
        lhs: lhs,
        rhs: expression3,
        span: this.combineSpans(lhs.span, token4 ? token4.span : expression3.span),
      };
    }
    this.addDiagnostic("Expected assignment ('=' or '<=') in statement", this.peek().span);
    this.advance();
    return {
      kind: "EmptyStatement",
      span: lhs.span,
    };
  }
  parseLhs() {
    if (this.match("Identifier")) {
      let prevToken = this.previous();
      let k = {
        kind: "Identifier",
        name: prevToken.text,
        span: prevToken.span,
      };
      return this.match("[") ? this.parseSelectSuffix(k, prevToken.span) : k;
    }
    if (this.match("{")) {
      let span = this.previous().span;
      let delimitedList = this.parseDelimitedList({
        parseItem: () => this.parseLhs(),
        isItemStart: () => this.isExpressionStart(),
        terminator: "}",
        missingDelimiterMessage: "Expected ',' between concatenation elements",
      });
      let token = this.consume("}", "Expected '}' after concatenation");
      return {
        kind: "Concatenation",
        elements: delimitedList,
        span: this.combineSpans(span, token ? token.span : this.previous().span),
      };
    }
    this.addDiagnostic(
      "Expected variable identifier on left-hand side of assignment",
      this.peek().span,
    );
    let span2 = this.peek().span;
    this.advance();
    return {
      kind: "Identifier",
      name: "<error>",
      span: span2,
    };
  }
  parseCaseStatement() {
    let prevToken = this.previous();
    let m = prevToken.type === "casez" ? "casez" : prevToken.type === "casex" ? "casex" : "case";
    let span = prevToken.span;
    this.consume("(", "Expected '(' after 'case'");
    let expression = this.parseExpression();
    this.consume(")", "Expected ')' after case expression");
    let C = [];
    for (; !this.check("endcase") && !this.isAtEnd();) {
      if (this.match("default")) {
        let span2 = this.previous().span;
        this.consume(":", "Expected ':' after 'default'");
        let statement = this.parseStatement();
        C.push({
          kind: "CaseItem",
          patterns: [],
          isDefault: true,
          statement: statement,
          span: this.combineSpans(span2, statement.span),
        });
      } else {
        let span3 = this.peek().span;
        let delimitedList = this.parseDelimitedList({
          parseItem: () => this.parseExpression(),
          isItemStart: () => this.isExpressionStart(),
          terminator: ":",
          missingDelimiterMessage: "Expected ',' between case item patterns",
        });
        this.consume(":", "Expected ':' after case item patterns");
        let statement2 = this.parseStatement();
        C.push({
          kind: "CaseItem",
          patterns: delimitedList,
          isDefault: false,
          statement: statement2,
          span: this.combineSpans(span3, statement2.span),
        });
      }
    }
    let token = this.consume("endcase", "Expected 'endcase' to close case statement");
    return {
      kind: "CaseStatement",
      expression: expression,
      items: C,
      caseType: m,
      span: this.combineSpans(span, token ? token.span : this.previous().span),
    };
  }
  parseLoopStatement() {
    let prevToken = this.previous();
    let text = prevToken.text;
    let k;
    let E;
    let C;
    let M;
    if (text === "for") {
      this.consume("(", "Expected '(' after 'for'");
      k = this.parseForInit();
      this.consume(";", "Expected ';' after for-loop initialisation");
      E = this.parseExpression();
      this.consume(";", "Expected ';' after for-loop condition");
      C = this.parseAssignmentExpression();
      this.consume(")", "Expected ')' after for-loop header");
    } else {
      if (text === "while") {
        this.consume("(", "Expected '(' after 'while'");
        E = this.parseExpression();
        this.consume(")", "Expected ')' after while condition");
      } else {
        if (text === "repeat") {
          this.consume("(", "Expected '(' after 'repeat'");
          M = this.parseExpression();
          this.consume(")", "Expected ')' after repeat count");
        }
      }
    }
    let statement = this.parseStatement();
    return {
      kind: "LoopStatement",
      loopKind: text,
      initExpr: k,
      condition: E,
      stepExpr: C,
      countExpr: M,
      body: statement,
      span: this.combineSpans(prevToken.span, statement.span),
    };
  }
  parseForInit() {
    if (this.match("integer", "real", "time")) {
      let prevToken = this.previous();
      let token = this.consume("Identifier", "Expected loop variable name");
      if (!token) {
        return;
      }
      let k = {
        kind: "Identifier",
        name: token.text,
        span: token.span,
      };
      if (this.match("=")) {
        let expression = this.parseExpression();
        return {
          kind: "BinaryExpression",
          operator: "=",
          left: k,
          right: expression,
          span: this.combineSpans(prevToken.span, expression.span),
        };
      }
      return k;
    }
    return this.parseAssignmentExpression();
  }
  parseAssignmentExpression() {
    let lhs = this.parseLhs();
    if (this.match("=")) {
      let expression = this.parseExpression();
      return {
        kind: "BinaryExpression",
        operator: "=",
        left: lhs,
        right: expression,
        span: this.combineSpans(lhs.span, expression.span),
      };
    }
    return lhs;
  }
  parseTaskCallWithoutParens() {
    let token = this.advance();
    let token2 = this.consume(";", "Expected ';' after task call");
    let k = token2 ? token2.span : token.span;
    return {
      kind: "TaskCallStatement",
      name: token.text,
      args: [],
      span: this.combineSpans(token.span, k),
    };
  }
  parseTaskCallStatement() {
    let token = this.advance();
    let m = [];
    this.consume("(", "Expected '(' after task name");
    if (!this.check(")")) {
      m.push(
        ...this.parseDelimitedList({
          parseItem: () => this.parseExpression(),
          isItemStart: () => this.isExpressionStart(),
          terminator: ")",
          missingDelimiterMessage: "Expected ',' between task call arguments",
        }),
      );
    }
    this.consume(")", "Expected ')' after task call arguments");
    let token2 = this.consume(";", "Expected ';' after task call");
    let E = token2 ? token2.span : this.previous().span;
    return {
      kind: "TaskCallStatement",
      name: token.text,
      args: m,
      span: this.combineSpans(token.span, E),
    };
  }
  parseEventControlStatement() {
    let token = this.advance();
    let m = [];
    this.consume("(", "Expected '(' after '@'");
    if (this.match("*")) {
      m.push({
        kind: "SensitivityItem",
        edge: "all",
        span: this.previous().span,
      });
    } else {
      m.push(
        ...this.parseDelimitedList({
          parseItem: () => {
            let C = "none";
            let span = this.peek().span;
            if (this.match("posedge")) {
              C = "posedge";
            } else {
              if (this.match("negedge")) {
                C = "negedge";
              }
            }
            let token = this.consume("Identifier", "Expected signal identifier in event control");
            return {
              kind: "SensitivityItem",
              edge: C,
              signal: token
                ? {
                    kind: "Identifier",
                    name: token.text,
                    span: token.span,
                  }
                : undefined,
              span: this.combineSpans(span, token ? token.span : span),
            };
          },
          isItemStart: () =>
            this.check("posedge") || this.check("negedge") || this.check("Identifier"),
          delimiters: ["or", ","],
          terminator: ")",
          missingDelimiterMessage: "Expected 'or' or ',' between signals in event control",
        }),
      );
    }
    this.consume(")", "Expected ')' after event control");
    let token2 = this.consume(";", "Expected ';' after event control");
    let E = token2 ? token2.span : this.previous().span;
    return {
      kind: "EventControlStatement",
      sensitivities: m,
      span: this.combineSpans(token.span, E),
    };
  }
  parseDelayStatement() {
    let token = this.advance();
    let m;
    if (this.match("(")) {
      m = this.parseExpression();
      this.consume(")", "Expected ')' after delay expression");
    } else {
      if (this.check("NumberLiteral")) {
        m = this.parseExpression();
      }
    }
    let token2 = this.consume(";", "Expected ';' after delay statement");
    let E = token2 ? token2.span : this.previous().span;
    return {
      kind: "DelayStatement",
      delayExpr: m,
      span: this.combineSpans(token.span, E),
    };
  }
  parseSystemTaskCall() {
    let token = this.advance();
    let m = [];
    if (this.match("(")) {
      if (!this.check(")")) {
        m.push(
          ...this.parseDelimitedList({
            parseItem: () => this.parseExpression(),
            isItemStart: () => this.isExpressionStart(),
            terminator: ")",
            missingDelimiterMessage: "Expected ',' between system task arguments",
          }),
        );
      }
      this.consume(")", "Expected ')' after system task arguments");
    }
    let token2 = this.consume(";", "Expected ';' after system task call");
    let E = token2 ? token2.span : this.previous().span;
    return {
      kind: "SystemTaskCall",
      name: token.text,
      args: m,
      span: this.combineSpans(token.span, E),
    };
  }
  parseExpression() {
    if (this.depth > MAX_DEPTH) {
      return this.abortDeepExpression();
    }
    this.depth++;
    try {
      return this.parseTernary();
    } finally {
      this.depth--;
    }
  }
  abortDeepExpression() {
    let span = this.peek().span;
    this.addDiagnostic(
      `Maximum nesting depth (${MAX_DEPTH}) exceeded \u2014 the rest of this expression is skipped`,
      span,
      "error",
      "SYNTAX-MAX-DEPTH",
    );
    let m = 0;
    for (; !this.isAtEnd() && !(this.check(")") && m === 0);) {
      if (this.check("(")) {
        m++;
      } else {
        if (this.check(")")) {
          m--;
        }
      }
      this.advance();
    }
    return {
      kind: "Identifier",
      name: "<error>",
      span: span,
    };
  }
  parseTernary() {
    let logicalOr = this.parseLogicalOr();
    if (this.match("?")) {
      let expression = this.parseExpression();
      this.consume(":", "Expected ':' in ternary conditional operator");
      let expression2 = this.parseExpression();
      return {
        kind: "TernaryExpression",
        condition: logicalOr,
        trueExpr: expression,
        falseExpr: expression2,
        span: this.combineSpans(logicalOr.span, expression2.span),
      };
    }
    return logicalOr;
  }
  parseLogicalOr() {
    let logicalAnd = this.parseLogicalAnd();
    for (; this.match("||");) {
      let text = this.previous().text;
      let logicalAnd2 = this.parseLogicalAnd();
      logicalAnd = {
        kind: "BinaryExpression",
        operator: text,
        left: logicalAnd,
        right: logicalAnd2,
        span: this.combineSpans(logicalAnd.span, logicalAnd2.span),
      };
    }
    return logicalAnd;
  }
  parseLogicalAnd() {
    let bitwiseOr = this.parseBitwiseOr();
    for (; this.match("&&");) {
      let text = this.previous().text;
      let bitwiseOr2 = this.parseBitwiseOr();
      bitwiseOr = {
        kind: "BinaryExpression",
        operator: text,
        left: bitwiseOr,
        right: bitwiseOr2,
        span: this.combineSpans(bitwiseOr.span, bitwiseOr2.span),
      };
    }
    return bitwiseOr;
  }
  parseBitwiseOr() {
    let bitwiseXor = this.parseBitwiseXor();
    for (; this.match("|", "~|");) {
      let text = this.previous().text;
      let bitwiseXor2 = this.parseBitwiseXor();
      bitwiseXor = {
        kind: "BinaryExpression",
        operator: text,
        left: bitwiseXor,
        right: bitwiseXor2,
        span: this.combineSpans(bitwiseXor.span, bitwiseXor2.span),
      };
    }
    return bitwiseXor;
  }
  parseBitwiseXor() {
    let bitwiseAnd = this.parseBitwiseAnd();
    for (; this.match("^", "~^", "^~");) {
      let text = this.previous().text;
      let bitwiseAnd2 = this.parseBitwiseAnd();
      bitwiseAnd = {
        kind: "BinaryExpression",
        operator: text,
        left: bitwiseAnd,
        right: bitwiseAnd2,
        span: this.combineSpans(bitwiseAnd.span, bitwiseAnd2.span),
      };
    }
    return bitwiseAnd;
  }
  parseBitwiseAnd() {
    let equality = this.parseEquality();
    for (; this.match("&", "~&");) {
      let text = this.previous().text;
      let equality2 = this.parseEquality();
      equality = {
        kind: "BinaryExpression",
        operator: text,
        left: equality,
        right: equality2,
        span: this.combineSpans(equality.span, equality2.span),
      };
    }
    return equality;
  }
  parseEquality() {
    let relational = this.parseRelational();
    for (; this.match("==", "!=", "===", "!==");) {
      let text = this.previous().text;
      let relational2 = this.parseRelational();
      relational = {
        kind: "BinaryExpression",
        operator: text,
        left: relational,
        right: relational2,
        span: this.combineSpans(relational.span, relational2.span),
      };
    }
    return relational;
  }
  parseRelational() {
    let shift = this.parseShift();
    for (; this.match("<", "<=", ">", ">=");) {
      let text = this.previous().text;
      let shift2 = this.parseShift();
      shift = {
        kind: "BinaryExpression",
        operator: text,
        left: shift,
        right: shift2,
        span: this.combineSpans(shift.span, shift2.span),
      };
    }
    return shift;
  }
  parseShift() {
    let additive = this.parseAdditive();
    for (; this.match("<<", ">>", "<<<", ">>>");) {
      let text = this.previous().text;
      let additive2 = this.parseAdditive();
      additive = {
        kind: "BinaryExpression",
        operator: text,
        left: additive,
        right: additive2,
        span: this.combineSpans(additive.span, additive2.span),
      };
    }
    return additive;
  }
  parseAdditive() {
    let multiplicative = this.parseMultiplicative();
    for (; this.match("+", "-");) {
      let text = this.previous().text;
      let multiplicative2 = this.parseMultiplicative();
      multiplicative = {
        kind: "BinaryExpression",
        operator: text,
        left: multiplicative,
        right: multiplicative2,
        span: this.combineSpans(multiplicative.span, multiplicative2.span),
      };
    }
    return multiplicative;
  }
  parseMultiplicative() {
    let power = this.parsePower();
    for (; this.match("*", "/", "%");) {
      let text = this.previous().text;
      let power2 = this.parsePower();
      power = {
        kind: "BinaryExpression",
        operator: text,
        left: power,
        right: power2,
        span: this.combineSpans(power.span, power2.span),
      };
    }
    return power;
  }
  parsePower() {
    let unary = this.parseUnary();
    for (; this.match("**");) {
      let text = this.previous().text;
      let unary2 = this.parseUnary();
      unary = {
        kind: "BinaryExpression",
        operator: text,
        left: unary,
        right: unary2,
        span: this.combineSpans(unary.span, unary2.span),
      };
    }
    return unary;
  }
  parseUnary() {
    if (this.match("~", "!", "&", "|", "^", "~&", "~|", "~^", "^~", "+", "-")) {
      let prevToken = this.previous();
      let unary = this.parseUnary();
      return {
        kind: "UnaryExpression",
        operator: prevToken.text,
        argument: unary,
        span: this.combineSpans(prevToken.span, unary.span),
      };
    }
    return this.parsePrimary();
  }
  parseSelectSuffix(d, m) {
    let k = d;
    for (;;) {
      let expression = this.parseExpression();
      if (this.match(":")) {
        let expression2 = this.parseExpression();
        let token = this.consume("]", "Expected ']' after part-select");
        k = {
          kind: "PartSelect",
          target: k,
          msb: expression,
          lsb: expression2,
          span: this.combineSpans(m, token ? token.span : expression2.span),
        };
      } else {
        let token2 = this.consume("]", "Expected ']' after bit-select");
        k = {
          kind: "BitSelect",
          target: k,
          index: expression,
          span: this.combineSpans(m, token2 ? token2.span : expression.span),
        };
      }
      if (!this.match("[")) {
        return k;
      }
    }
  }
  parsePrimary() {
    if (this.match("MacroReference")) {
      let prevToken = this.previous();
      let k = {
        kind: "Identifier",
        name: prevToken.text,
        span: prevToken.span,
      };
      return this.check("[") ? (this.advance(), this.parseSelectSuffix(k, prevToken.span)) : k;
    }
    if (this.match("Identifier")) {
      let prevToken2 = this.previous();
      let k = {
        kind: "Identifier",
        name: prevToken2.text,
        span: prevToken2.span,
      };
      if (this.check("(")) {
        this.advance();
        let E = [];
        if (!this.check(")")) {
          E.push(
            ...this.parseDelimitedList({
              parseItem: () => this.parseExpression(),
              isItemStart: () => this.isExpressionStart(),
              terminator: ")",
              missingDelimiterMessage: "Expected ',' between function call arguments",
            }),
          );
        }
        let token = this.consume(")", "Expected ')' after function call arguments");
        return {
          kind: "FunctionCall",
          name: prevToken2.text,
          args: E,
          span: this.combineSpans(prevToken2.span, token ? token.span : prevToken2.span),
        };
      }
      return this.match("[") ? this.parseSelectSuffix(k, prevToken2.span) : k;
    }
    if (this.match("StringLiteral")) {
      let prevToken3 = this.previous();
      return {
        kind: "StringLiteral",
        raw: prevToken3.text,
        value: this.decodeStringLiteral(prevToken3.text),
        span: prevToken3.span,
      };
    }
    if (this.match("SystemIdentifier")) {
      let prevToken4 = this.previous();
      let k = [];
      if (this.match("(")) {
        if (!this.check(")")) {
          k.push(
            ...this.parseDelimitedList({
              parseItem: () => this.parseExpression(),
              isItemStart: () => this.isExpressionStart(),
              terminator: ")",
              missingDelimiterMessage: "Expected ',' between system function arguments",
            }),
          );
        }
        this.consume(")", "Expected ')' after system function arguments");
      }
      return {
        kind: "SystemFunctionCall",
        name: prevToken4.text,
        args: k,
        span: prevToken4.span,
      };
    }
    if (this.match("NumberLiteral")) {
      let prevToken5 = this.previous();
      let numericLiteral = this.parseNumericLiteral(prevToken5.text);
      return {
        kind: "NumberLiteral",
        raw: prevToken5.text,
        value: numericLiteral.value,
        bitWidth: numericLiteral.bitWidth,
        span: prevToken5.span,
      };
    }
    if (this.match("(")) {
      let span = this.previous().span;
      let expression = this.parseExpression();
      let token2 = this.consume(")", "Expected ')' after parenthesized expression");
      return {
        ...expression,
        span: this.combineSpans(span, token2 ? token2.span : expression.span),
      };
    }
    if (this.match("{")) {
      let span2 = this.previous().span;
      let expression2 = this.parseExpression();
      if (this.match("{")) {
        let delimitedList = this.parseDelimitedList({
          parseItem: () => this.parseExpression(),
          isItemStart: () => this.isExpressionStart(),
          terminator: "}",
          missingDelimiterMessage: "Expected ',' between replication elements",
        });
        let token3 = this.consume("}", "Expected '}' after replication elements");
        let token4 = this.consume("}", "Expected '}' to close replication");
        return {
          kind: "ReplicationExpression",
          multiplier: expression2,
          elements: delimitedList,
          span: this.combineSpans(
            span2,
            token4 ? token4.span : token3 ? token3.span : this.previous().span,
          ),
        };
      }
      let E = [expression2];
      for (
        ;
        !this.check("}") &&
        !this.isAtEnd() &&
        (this.match(",") ||
          this.addDiagnostic("Expected ',' between concatenation elements", this.peek().span),
        !(this.check("}") || this.isAtEnd()));
      ) {
        E.push(this.parseExpression());
      }
      let token5 = this.consume("}", "Expected '}' after concatenation");
      return {
        kind: "Concatenation",
        elements: E,
        span: this.combineSpans(span2, token5 ? token5.span : this.previous().span),
      };
    }
    this.addDiagnostic(`Unexpected token '${this.peek().text}' in expression`, this.peek().span);
    let span3 = this.peek().span;
    this.advance();
    return {
      kind: "Identifier",
      name: "<error>",
      span: span3,
    };
  }
  parseRange() {
    let token = this.consume("[", "Expected '[' for range");
    let expression = this.parseExpression();
    this.consume(":", "Expected ':' in range [msb:lsb]");
    let expression2 = this.parseExpression();
    let token2 = this.consume("]", "Expected ']' to close range");
    return {
      kind: "Range",
      msb: expression,
      lsb: expression2,
      span: this.combineSpans(
        token ? token.span : expression.span,
        token2 ? token2.span : expression2.span,
      ),
    };
  }
  parseNumericLiteral(d) {
    let index = d.indexOf("'");
    if (index >= 0) {
      let k;
      if (index > 0) {
        let R = d.slice(0, index).replace(/_/g, "");
        let int = parseInt(R, 10);
        if (!isNaN(int)) {
          k = int;
        }
      }
      let E = index + 1;
      if (d[E]?.toLowerCase() === "s") {
        E += 1;
      }
      let C = d[E]?.toLowerCase();
      let M = d.slice(E + 1).replace(/_/g, "");
      let v = 0;
      switch (C) {
        case "b":
          v = parseInt(M, 2) || 0;
          break;
        case "h":
          v = parseInt(M, 16) || 0;
          break;
        case "d":
          v = parseInt(M, 10) || 0;
          break;
        case "o":
          v = parseInt(M, 8) || 0;
          break;
        default:
          v = parseInt(M, 10) || 0;
      }
      return {
        value: v,
        bitWidth: k,
      };
    }
    return {
      value: parseInt(d.replace(/_/g, ""), 10) || 0,
    };
  }
  isAtEnd() {
    return this.peek().type === "EOF";
  }
  decodeStringLiteral(d) {
    let m = d.startsWith('"') ? d.slice(1, d.endsWith('"') ? -1 : undefined) : d;
    let k = "";
    for (let E = 0; E < m.length; E++) {
      let C = m[E];
      if (C !== "\\") {
        k += C;
        continue;
      }
      let M = m[E + 1];
      if (M === undefined) {
        break;
      }
      switch ((E++, M)) {
        case "n":
          k += `
`;
          break;
        case "t":
          k += "	";
          break;
        case "r":
          k += "\r";
          break;
        case "\\":
          k += "\\";
          break;
        case '"':
          k += '"';
          break;
        case "0":
          k += "\0";
          break;
        default:
          k += M;
          break;
      }
    }
    return k;
  }
  peek() {
    return (
      this.tokens[this.cursor] ?? {
        type: "EOF",
        text: "",
        span: makeSpan(this.fileUri, 0, 0, 0, 0),
      }
    );
  }
  peekNext() {
    return (
      this.tokens[this.cursor + 1] ?? {
        type: "EOF",
        text: "",
        span: makeSpan(this.fileUri, 0, 0, 0, 0),
      }
    );
  }
  peekNextNext() {
    return (
      this.tokens[this.cursor + 2] ?? {
        type: "EOF",
        text: "",
        span: makeSpan(this.fileUri, 0, 0, 0, 0),
      }
    );
  }
  previous() {
    return this.tokens[this.cursor - 1] ?? this.peek();
  }
  advance() {
    if (!this.isAtEnd()) {
      this.cursor++;
    }
    return this.previous();
  }
  check(d) {
    return this.isAtEnd() ? false : this.peek().type === d;
  }
  match(...d) {
    for (let m of d) {
      if (this.check(m)) {
        this.advance();
        return true;
      }
    }
    return false;
  }
  deriveSyntaxCode(d, m) {
    switch (d) {
      case ";":
        return "SYNTAX-MISSING-SEMICOLON";
      case ")":
        return "SYNTAX-MISSING-RPAREN";
      case "]":
        return "SYNTAX-MISSING-RBRACKET";
      case "}":
        return "SYNTAX-MISSING-RBRACE";
      case ":":
        return "SYNTAX-MISSING-COLON";
      case "end":
        return "SYNTAX-MISSING-END";
      case "endmodule":
        return "SYNTAX-MISSING-ENDMODULE";
      case "endcase":
        return "SYNTAX-MISSING-ENDCASE";
      default:
        return;
    }
  }
  consume(d, m, k) {
    if (this.check(d)) {
      return this.advance();
    }
    let E = k ?? this.deriveSyntaxCode(d, m);
    this.addDiagnostic(m, this.peek().span, "error", E);
    return null;
  }
  skipUntil(d) {
    for (; !this.check(d) && !this.isAtEnd();) {
      this.advance();
    }
  }
  synchronize(d) {
    for (this.advance(); !this.isAtEnd();) {
      if (this.previous().type === ";" || d.includes(this.peek().type)) {
        return;
      }
      this.advance();
    }
  }
  recoverInList(d, m) {
    for (
      ;
      !this.checkAny(m) &&
      !this.checkAny(SYNC_TOKENS) &&
      !this.isAtTerminator(d) &&
      !this.isAtEnd();
    ) {
      this.advance();
    }
  }
  addDiagnostic(d, m, k = "error", E) {
    this.diagnostics.push({
      message: d,
      severity: k,
      span: m,
      code: E,
    });
  }
  combineSpans(d, m) {
    return makeSpan(d.fileUri, d.start.line, d.start.column, m.end.line, m.end.column);
  }
  isAtTerminator(d) {
    return Array.isArray(d) ? d.some((m) => this.check(m)) : this.check(d);
  }
  checkAny(d) {
    return d.some((m) => this.check(m));
  }
  matchAny(d) {
    for (let m of d) {
      if (this.check(m)) {
        this.advance();
        return true;
      }
    }
    return false;
  }
  isExpressionStart() {
    if (this.isAtEnd()) {
      return false;
    }
    let type = this.peek().type;
    return (
      type === "Identifier" ||
      type === "MacroReference" ||
      type === "NumberLiteral" ||
      type === "(" ||
      type === "{" ||
      type === "~" ||
      type === "!" ||
      type === "-" ||
      type === "+" ||
      type === "&" ||
      type === "|" ||
      type === "^" ||
      type === "~&" ||
      type === "~|" ||
      type === "~^" ||
      type === "^~"
    );
  }
  parseDelimitedList(d) {
    let m = d.delimiters ?? [","];
    let k = [];
    for (; !this.isAtTerminator(d.terminator) && !this.isAtEnd();) {
      let cursor = this.cursor;
      if (
        this.matchAny(m) &&
        (this.addDiagnostic(
          "Unexpected delimiter",
          this.previous().span,
          "error",
          "SYNTAX-UNEXPECTED-TOKEN",
        ),
        this.isAtTerminator(d.terminator))
      ) {
        break;
      }
      let item = d.parseItem();
      if ((item != null && k.push(item), this.matchAny(m))) {
        if (this.isAtTerminator(d.terminator)) {
          this.addDiagnostic(
            "Unexpected trailing comma",
            this.previous().span,
            "error",
            "SYNTAX-TRAILING-COMMA",
          );
          break;
        }
        continue;
      }
      if (this.isAtTerminator(d.terminator)) {
        break;
      }
      if (d.isItemStart()) {
        let M = d.missingDelimiterMessage ?? "Expected ',' between items";
        this.addDiagnostic(M, this.previous().span, "error", "SYNTAX-MISSING-COMMA");
        continue;
      }
      if (
        (this.addDiagnostic(
          `Unexpected token '${this.peek().text}'`,
          this.peek().span,
          "error",
          "SYNTAX-UNEXPECTED-TOKEN",
        ),
        this.recoverInList(d.terminator, m),
        this.checkAny(BLOCK_END_KEYWORDS) && !this.isAtTerminator(d.terminator))
      ) {
        break;
      }
      if (this.matchAny(m) && this.isAtTerminator(d.terminator)) {
        this.addDiagnostic(
          "Unexpected trailing comma",
          this.previous().span,
          "error",
          "SYNTAX-TRAILING-COMMA",
        );
        break;
      }
      if (this.cursor === cursor) {
        this.advance();
      }
    }
    return k;
  }
}
