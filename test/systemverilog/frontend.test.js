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
  it("undeclared identifier on the left-hand side", () => {
    expect(codes(analyzeText(wrap("assign missing = 4'd0;")).errors)).toContain("SEM-UNDECLARED-LHS");
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
    expect(analyzeText(text).errors).toEqual([]);
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
