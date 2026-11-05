import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DocumentCache } from "../../src/analysis/documentCache.js";
import { ModuleResolver } from "../../src/workspace/moduleResolver.js";
import { Elaborator } from "../../src/schematic/elaborator.js";
import { detectTestbench } from "../../src/lint/testbenchDetector.js";

const fixtures = path.resolve(__dirname, "../fixtures/systemverilog");

function analyzeText(text, name = "inline.sv") {
  let resolver = new ModuleResolver();
  resolver.setSearchRoots([fixtures]);
  let cache = new DocumentCache(resolver);
  let uri = `file://${path.join(fixtures, name)}`;
  let entry = cache.analyze(uri, 1, text);
  return { entry, resolver, errors: [...entry.parserDiagnostics, ...entry.semanticDiagnostics] };
}

function analyzeFixture(name) {
  return analyzeText(fs.readFileSync(path.join(fixtures, name), "utf8"), name);
}

function codes(errors) {
  return errors.map((diagnostic) => diagnostic.code ?? diagnostic.message);
}

describe("valid SystemVerilog produces no errors", () => {
  for (let name of fs.readdirSync(fixtures).filter((file) => file.endsWith(".sv"))) {
    it(name, () => {
      expect(analyzeFixture(name).errors).toEqual([]);
    });
  }
});

describe("real errors are still reported", () => {
  let wrap = (body) => `module m (input logic clk, output logic [3:0] q);\n${body}\nendmodule\n`;
  it("undeclared identifier on the right-hand side", () => {
    expect(codes(analyzeText(wrap("assign q = missing;")).errors)).toContain("SEM-UNDECLARED");
  });
  it("undeclared identifier on the left-hand side with `default_nettype none", () => {
    let text = "`default_nettype none\n" + wrap("assign missing = 4'd0;");
    expect(codes(analyzeText(text).errors)).toContain("SEM-UNDECLARED-LHS");
  });
  it("undeclared assign target is an implicit net by default", () => {
    expect(codes(analyzeText(wrap("assign missing = 4'd0;")).errors)).toContain("SEM-IMPLICIT-NET");
  });
  it("undeclared identifier in always_ff", () => {
    expect(codes(analyzeText(wrap("always_ff @(posedge clk) q <= missing;")).errors)).toContain("SEM-UNDECLARED");
  });
  it("undeclared sensitivity signal", () => {
    expect(codes(analyzeText(wrap("always_ff @(posedge nope) q <= 4'd0;")).errors)).toContain("SEM-UNDECLARED-SENSITIVITY");
  });
  it("assignment to an input", () => {
    expect(codes(analyzeText(wrap("assign clk = 1'b0;")).errors)).toContain("SEM-ASSIGN-TO-INPUT");
  });
  it("procedural assignment to a wire", () => {
    let text = wrap("wire w; always_comb w = 1'b0;");
    expect(codes(analyzeText(text).errors)).toContain("SEM-ASSIGN-TO-WIRE");
  });
  it("duplicate declaration", () => {
    let text = wrap("logic a; logic a;");
    expect(codes(analyzeText(text).errors)).toContain("SEM-DUPLICATE-NET");
  });
  it("missing semicolon", () => {
    expect(analyzeText(wrap("logic a\nlogic b;")).errors.length).toBeGreaterThan(0);
  });
  it("missing endmodule", () => {
    expect(analyzeText("module m;\nlogic a;\n").errors.length).toBeGreaterThan(0);
  });
  it("unknown module instance", () => {
    expect(codes(analyzeText(wrap("nothing_here u_x (.a(clk));")).errors)).toContain("SEM-MODULE-NOT-FOUND");
  });
  it("unknown name after a resolved import", () => {
    let text = `import bus_pkg::*;\n${wrap("assign q = NOT_IN_PACKAGE;")}`;
    expect(codes(analyzeText(text).errors)).toContain("SEM-UNDECLARED");
  });
  it("names from an unknown package stay unjudged but the import is flagged", () => {
    let text = wrap("import no_such_pkg::*;\nassign q = MAYBE;");
    let result = codes(analyzeText(text).errors);
    expect(result).toContain("SV-PACKAGE-NOT-FOUND");
    expect(result).not.toContain("SEM-UNDECLARED");
  });
});

describe("types lower to real widths", () => {
  function moduleNamed(entry, name) {
    return entry.ast.modules.find((module) => module.name === name);
  }
  function symbol(entry, moduleName, name) {
    return entry.symbolTable.getModuleScope(moduleName).resolve(name);
  }
  it("packed struct, typedef and enum widths", () => {
    let { entry } = analyzeFixture("rtl_features.sv");
    expect(symbol(entry, "rtl_features", "next_entry").bitWidth).toBe(5);
    expect(symbol(entry, "rtl_features", "req_i").bitWidth).toBe(2 + 16 + 32 + 1);
    expect(symbol(entry, "rtl_features", "op_q").bitWidth).toBe(2);
    expect(symbol(entry, "rtl_features", "packed_bytes").bitWidth).toBe(32);
    expect(symbol(entry, "rtl_features", "index_q").bitWidth).toBe(2);
    expect(symbol(entry, "rtl_features", "total").bitWidth).toBe(32);
    expect(symbol(entry, "rtl_features", "payload_i").bitWidth).toBe(8);
    expect(symbol(entry, "rtl_features", "data_o").bitWidth).toBe(32);
  });
  it("struct members become part selects at the right offsets", () => {
    let { entry } = analyzeFixture("rtl_features.sv");
    let assign = moduleNamed(entry, "rtl_features").items.filter((item) => item.kind === "ContinuousAssign")[1];
    // req_t is {op[50:49], addr[48:33], data[32:1], valid[0]}.
    let { condition, trueExpr } = assign.rhs;
    expect(condition.kind).toBe("BitSelect");
    expect(condition.index.value).toBe(0);
    expect([trueExpr.msb.value, trueExpr.lsb.value]).toEqual([32, 1]);
  });
  it("enum members and package parameters carry their values", () => {
    let { entry } = analyzeFixture("rtl_features.sv");
    expect(symbol(entry, "rtl_features", "OP_WRITE").value).toBe(3);
    expect(symbol(entry, "rtl_features", "bus_pkg::OP_READ").value).toBe(2);
  });
  it("'0 takes its width from context", () => {
    let { entry } = analyzeFixture("rtl_features.sv");
    let assign = moduleNamed(entry, "rtl_features").items.filter((item) => item.kind === "ContinuousAssign")[1];
    expect(assign.rhs.falseExpr.bitWidth).toBe(32);
  });
  it("always_comb and always_ff keep their kinds", () => {
    let { entry } = analyzeFixture("rtl_features.sv");
    let blocks = moduleNamed(entry, "rtl_features").items.filter((item) => item.kind === "AlwaysBlock");
    expect(blocks[0].alwaysKind).toBe("always_comb");
    expect(blocks[0].isSequential).toBe(false);
    expect(blocks[1].alwaysKind).toBe("always_ff");
    expect(blocks[1].isSequential).toBe(true);
  });
  it("a constant generate condition picks one branch", () => {
    let { entry } = analyzeFixture("rtl_features.sv");
    expect(symbol(entry, "rtl_features", "extra_q")).toBeDefined();
    expect(symbol(entry, "rtl_features", "other_q")).toBeUndefined();
  });
});

describe("hierarchy", () => {
  it("interface ports flatten with modport directions", () => {
    let { entry } = analyzeFixture("hierarchy.sv");
    let producer = entry.ast.modules.find((module) => module.name === "producer");
    let ports = producer.items
      .filter((item) => item.kind === "PortDeclaration")
      .map((item) => [item.identifiers[0].name, item.direction]);
    expect(ports).toContainEqual(["bus.valid", "output"]);
    expect(ports).toContainEqual(["bus.ready", "input"]);
    expect(ports).toContainEqual(["enable", "input"]);
    expect(producer.portNames).toContain("bus.data");
  });
  it(".*, .name and interface connections expand", () => {
    let { entry } = analyzeFixture("hierarchy.sv");
    let top = entry.ast.modules.find((module) => module.name === "hierarchy");
    let instance = (name) => top.items.find((item) => item.instanceName === name);
    let adderPorts = instance("u_adder").portConnections.map((c) => c.portName).sort();
    expect(adderPorts).toEqual(["a", "b", "sum"]);
    let producerPorts = instance("u_producer").portConnections.map((c) => [c.portName, c.expression?.name]);
    expect(producerPorts).toContainEqual(["bus.valid", "link.valid"]);
    expect(producerPorts).toContainEqual(["enable", "enable"]);
  });
  it("modules elaborate into schematic graphs", () => {
    for (let name of ["hierarchy.sv", "rtl_features.sv", "recognized_only.sv"]) {
      let { entry, resolver } = analyzeFixture(name);
      for (let module of entry.ast.modules) {
        let graph = new Elaborator(resolver).elaborateModule(module, entry.symbolTable);
        expect(graph.nodes.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("preprocessor", () => {
  it("expands parameterized multi-line macros", () => {
    let text = "`define SET(a, b) \\\n  assign a = b;\nmodule m (output logic q);\n`SET(q, 1'b1)\nendmodule\n";
    let { entry, errors } = analyzeText(text);
    expect(errors).toEqual([]);
    expect(entry.ast.modules[0].items.some((item) => item.kind === "ContinuousAssign")).toBe(true);
    // Expansion tokens are hidden from token-driven editor features.
    expect(entry.tokens.some((token) => token.span.fromMacro)).toBe(false);
  });
  it("follows `elsif and `ifndef", () => {
    let text = "`define B\n`ifdef A\nbad bad\n`elsif B\nmodule m;\nendmodule\n`else\nbad bad\n`endif\n";
    expect(analyzeText(text).errors).toEqual([]);
  });
  it("leaves unknown macros unjudged", () => {
    let text = "module m (output logic [3:0] q);\nassign q = `UNDEFINED_ELSEWHERE;\nendmodule\n";
    let found = analyzeText(text).errors;
    expect(codes(found)).toEqual(["SYNTAX-UNDEFINED-MACRO"]);
    expect(found[0].severity).toBe("warning");
  });
});

describe("Verilog files stay strict IEEE 1364", () => {
  it(".v files do not accept SystemVerilog keywords", () => {
    let resolver = new ModuleResolver();
    let cache = new DocumentCache(resolver);
    let text = "module m (input clk);\nalways_ff @(posedge clk) begin end\nendmodule\n";
    let entry = cache.analyze("file:///tmp/plain.v", 1, text);
    expect(entry.parserDiagnostics.length).toBeGreaterThan(0);
  });
  it("logic is an ordinary identifier in .v files", () => {
    let cache = new DocumentCache(new ModuleResolver());
    let text = "module m (input logic, output reg q);\nalways @(*) q = logic;\nendmodule\n";
    let entry = cache.analyze("file:///tmp/plain.v", 1, text);
    expect(entry.parserDiagnostics).toEqual([]);
  });
});

describe("testbench detection", () => {
  let rtl = (body) => `module cpu (input logic clk, output logic q);\n${body}\nendmodule\n`;
  it("always_ff alone is not procedural waiting", () => {
    let result = detectTestbench(rtl("always_ff @(posedge clk) q <= 1'b1;"), "/x/cpu.sv");
    expect(result.reasons.join()).not.toContain("procedural event");
    expect(result.isTestbench).toBe(false);
  });
  it("RTL with a simulation-only $fatal stays RTL", () => {
    let body = "always_ff @(posedge clk) begin q <= 1'b1; if (q) $fatal(1, \"bad\"); end";
    expect(detectTestbench(rtl(body), "/x/cpu.sv").isTestbench).toBe(false);
  });
  it("RTL with $readmemh and #0 stays RTL", () => {
    let body = "logic m [4]; initial begin #0; $readmemh(\"a.mem\", m); end";
    expect(detectTestbench(rtl(body), "/x/imem.sv").isTestbench).toBe(false);
  });
  it("a parameter list does not hide real ports", () => {
    let text = "module cpu #(parameter W = (1)) (input logic clk);\ninitial $finish;\nendmodule\n";
    expect(detectTestbench(text, "/x/cpu.sv").isTestbench).toBe(false);
  });
  it("a portless module with simulation code is a testbench", () => {
    for (let header of ["module top;", "module top();", "module top #(parameter W = 1) ();", "module top import p::*; ;"]) {
      let text = `${header}\ninitial begin #5 $finish; end\nendmodule\n`;
      expect(detectTestbench(text, "/x/top.sv").isTestbench).toBe(true);
    }
  });
  it("testbench names count even with ports", () => {
    let text = "module cpu_tb (input logic clk);\ninitial $finish;\nendmodule\n";
    expect(detectTestbench(text, "/x/cpu_tb.sv").isTestbench).toBe(true);
  });
  it("Verilog files keep the original scoring", () => {
    let text = "module cpu (input clk);\nalways @(posedge clk) $fatal;\nendmodule\n";
    expect(detectTestbench(text, "/x/cpu.v").isTestbench).toBe(true);
  });
});

describe("hostile input stays harmless", () => {
  it("a malformed foreach header does not hang", () => {
    let text = "module m; initial begin foreach a; foreach (b[); foreach (c[1,2]) ; end endmodule\n";
    expect(analyzeText(text).errors.length).toBeGreaterThan(0);
  });
  it("recursive and mutually recursive instantiation is legal", () => {
    expect(codes(analyzeText("module m #(parameter int N=2)(input logic a); if (N>0) begin : g m #(N-1) u(.*); end endmodule\n").errors)).toEqual([]);
    expect(codes(analyzeText("module a(input x); b u(.*); endmodule\nmodule b(input x); a u(.*); endmodule\n").errors)).toEqual([]);
  });
  it("a macro bomb stops at the expansion limit", () => {
    let defines = Array.from({ length: 40 }, (_, i) => `\`define M${i} \`M${i + 1} \`M${i + 1}\n`).join("");
    let result = analyzeText(`${defines}\`define M40 1\nmodule m; logic a = \`M0; endmodule\n`);
    expect(codes(result.errors).some((code) => code === "SYNTAX-PREPROCESSOR")).toBe(true);
  });
  it("absurd nesting is reported rather than thrown", () => {
    let text = `module m; ${"if (1) begin ".repeat(50000)}${"end ".repeat(50000)}endmodule\n`;
    expect(codes(analyzeText(text).errors)).toContain("SYNTAX-TOO-DEEP");
  });
  it("a scope operator after a number is a syntax error", () => {
    let text = "module m; int a; initial for (int i = 0; i < 2 :: ; i++) a = i; endmodule\n";
    expect(codes(analyzeText(text).errors)).toContain("SYNTAX-SCOPE");
  });
  it("diagnostics are capped", () => {
    let text = `module m; ${"end ".repeat(5000)}endmodule\n`;
    expect(analyzeText(text).errors.length).toBeLessThanOrEqual(600);
  });
});

describe("IEEE 1800 semantic checks", () => {
  const rejected = {
    "SEM-UNKNOWN-TYPE": "module m; foo_t x; endmodule",
    "SEM-UNKNOWN-MEMBER": "module m; typedef struct packed {logic a;} s_t; s_t s; assign s.nope = 1; endmodule",
    "SEM-UNKNOWN-PACKAGE-MEMBER": "package p; parameter int A=1; endpackage\nmodule m; logic [p::NOPE:0] a; endmodule",
    "SEM-UNKNOWN-PACKAGE": "module m; logic [q::A:0] a; endmodule",
    "SEM-DUPLICATE-DECLARATION": "module m; typedef enum {A,A} e; endmodule",
    "SEM-UNKNOWN-PORT": "module c(input a); endmodule\nmodule m; c u(.b(1)); endmodule",
    "SEM-TOO-MANY-CONNECTIONS": "module c(input a); endmodule\nmodule m; c u(1,2); endmodule",
    "SEM-UNKNOWN-PARAMETER": "module c #(parameter int P=1)(); endmodule\nmodule m; c #(.Q(1)) u(); endmodule",
    "SEM-IMPLICIT-CONNECTION": "module c(input a); endmodule\nmodule m; c u(.*); endmodule",
    "SEM-UNKNOWN-MODPORT": "interface i; logic a; modport mp(input a); endinterface\nmodule m(i.nope p); endmodule",
    "SEM-MODPORT-SIGNAL": "interface i; logic a; modport mp(input z); endinterface\nmodule m; endmodule",
    "SEM-MULTIPLE-DRIVERS": "module m(input logic c); logic a; always_ff @(posedge c) a<=1; always_ff @(posedge c) a<=0; endmodule",
    "SEM-ASSIGN-CONSTANT": "module m; parameter int P=1; assign P = 2; endmodule",
    "SEM-NOT-CONSTANT": "module m; int n; logic [n:0] a; endmodule",
    "SEM-JUMP": "module m; initial break; endmodule",
    "SEM-RETURN": "module m; initial return; endmodule",
    "SEM-CALL-ARGUMENTS": "module m; function int f(int a); return a; endfunction int x = f(1,2); endmodule",
    "SEM-UNDECLARED-SUBROUTINE": "module m; int x = nofn(1); endmodule",
    "SEM-TASK-IN-FUNCTION": "module m; task t(); endtask function void f(); t(); endfunction endmodule",
    "SEM-TIMING-CONTROL": "module m; logic a,b; always_comb @(posedge b) a = 1; endmodule",
    "SEM-ENUM-VALUE": "module m; typedef enum logic {A=2} e; endmodule",
    "SEM-ENUM-ASSIGN": "module m; typedef enum {A,B} e; e x; initial x = 1; endmodule",
    "SEM-GENVAR": "module m; for (i=0;i<2;i++) begin end endmodule",
    "SEM-REAL-SELECT": "module m; real r; logic a; assign a = r[0]; endmodule",
    "SEM-PORT-NOT-DECLARED": "module m(a); endmodule",
    "SEM-UNDECLARED-IDENTIFIER": "package p; parameter int A = NOPE; endpackage\nmodule m; endmodule",
    "SYNTAX-END-LABEL": "module m; endmodule : n",
    "SYNTAX-NUMBER": "module m; logic [3:0] a = 4'b12; endmodule",
    "SYNTAX-STRING": 'module m; string s = "abc\n; endmodule',
    "SYNTAX-PREPROCESSOR": "`endif\nmodule m; endmodule",
  };
  for (let [code, text] of Object.entries(rejected)) {
    it(`reports ${code}`, () => {
      expect(codes(analyzeText(`${text}\n`).errors)).toContain(code);
    });
  }
  const accepted = {
    "parameterized class scope": "class c #(type T=int); static function T g(); return 0; endfunction endclass\nmodule m; int x = c#(int)::g(); endmodule",
    "array method with": "module m; int a[3]; int b[$]; initial begin b = a.find(x) with (x>0); b = a.find with (item>0); end endmodule",
    "randsequence": "module m; initial randsequence(main) main: a; a: {}; endsequence endmodule",
    "out-of-block constraint": "class c; rand int b; extern constraint k; endclass\nconstraint c::k { b == 0; }\nmodule m; endmodule",
    "interface class": "interface class i; endclass\nmodule m; endmodule",
    "deferred assertion in a module": "module m; logic a; assert #0 (a); assert final (a); endmodule",
    "tagged pattern": "module m; typedef union tagged {void N; int V;} u_t; u_t t; int r; initial if (t matches tagged V .v) r = v; endmodule",
    "enum ranges": "module m; typedef enum {A[3], B[2:4]} e; e x = A0; e y = B2; endmodule",
    "package export": "package a; int v; endpackage\npackage b; import a::*; export a::*; endpackage\nmodule m; import b::*; assign v = 1; endmodule",
    "$unit type": "typedef logic t;\nmodule m; $unit::t a; endmodule",
    "user-defined primitive": "primitive u(output y, input a); table 0 : 1; 1 : 0; endtable endprimitive\nmodule m; logic a,b; u g(b,a); endmodule",
    "nested module": "module m; module n; endmodule n u(); endmodule",
    "signal named after its module": "module test; logic test; endmodule",
    "writing a subroutine input": "module m; task t(int a); a = 1; endtask endmodule",
    "statement label on a block": "module m; initial name: begin end : name endmodule",
    "fork join_none in a function": "module m; function void f(); fork #1; join_none endfunction endmodule",
    "forward typedef": "module m; typedef struct s_t; typedef struct packed {logic a;} s_t; s_t v; endmodule",
    "begin_keywords": '`begin_keywords "1364-2001"\nmodule m; reg logic; endmodule\n`end_keywords',
    "escaped identifier": "`default_nettype none\nmodule m; reg \\cpu3 ; wire r; assign r = cpu3; endmodule",
    "interface passed as an argument": "interface i; logic a; endinterface\nmodule m; i x(); function void f(virtual i p); endfunction initial f(x); endmodule",
    "byte order mark": "\ufeffmodule m; endmodule",
  };
  for (let [name, text] of Object.entries(accepted)) {
    it(`accepts ${name}`, () => {
      let errors = analyzeText(`${text}\n`).errors.filter((diagnostic) => diagnostic.severity === "error");
      expect(errors.map((diagnostic) => diagnostic.message)).toEqual([]);
    });
  }
});

describe("Windows line endings", () => {
  let stringErrors = (text) => codes(analyzeText(text).errors).filter((code) => code === "SYNTAX-STRING");

  it("accepts a string continued with a backslash", () => {
    let text = 'module m;\r\n  string s = "a \\\r\n    b";\r\nendmodule\r\n';
    expect(analyzeText(text).errors.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("accepts a string continued with a backslash in a Verilog file", () => {
    let text = 'module m;\r\n  initial $display("a \\\r\n    b");\r\nendmodule\r\n';
    expect(analyzeText(text, "inline.v").errors.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("still rejects a string broken by a bare line ending", () => {
    expect(stringErrors('module m;\r\n  string s = "abc\r\n;\r\nendmodule\r\n')).toEqual(["SYNTAX-STRING"]);
  });
});
