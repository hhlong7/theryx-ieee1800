import { ModuleResolver } from "../workspace/moduleResolver.js";
import {
  checkAssignmentType,
  checkBitwidthMismatch,
  checkCaseDefault,
  checkIncompleteSensitivity,
  checkLatchInference,
  checkMixedAssignments,
  checkModuleFilename,
  checkNamedPorts,
  checkNamingConventions,
  checkParameterNaming,
  checkSingleModule,
  walkItems,
} from "./rtlCheckers.js";
import { defaultRegistry } from "./checkerRegistry.js";

function modulePorts(O) {
  let d = new Map();
  let m = [];
  for (let item of O.items) {
    if (item.kind === "PortDeclaration") {
      for (let identifier of item.identifiers) {
        d.set(identifier.name, item.direction);
        m.push({
          name: identifier.name,
          direction: item.direction,
        });
      }
    }
  }
  let portNames = O.portNames;
  if (!portNames || portNames.length === 0) {
    return m;
  }
  let E = [];
  for (let portName of portNames) {
    let value = d.get(portName);
    if (value) {
      E.push({
        name: portName,
        direction: value,
      });
    }
  }
  for (let C of m) {
    if (!portNames.includes(C.name)) {
      E.push(C);
    }
  }
  return E;
}

function resolveInstancePorts(O, d, m, k) {
  let E = k.modules.find((R) => R.name === O);
  if (E) {
    return modulePorts(E);
  }
  let moduleScope = m.getModuleScope(O);
  if (moduleScope) {
    let R = [];
    for (let J of moduleScope.getSymbols()) {
      if (J.direction) {
        R.push({
          name: J.name,
          direction: J.direction,
        });
      }
    }
    if (R.length > 0) {
      return R;
    }
  }
  let v = new ModuleResolver().resolveModule(O, d);
  return v.found && v.moduleNode ? modulePorts(v.moduleNode) : [];
}

function downgradeSeverity(O) {
  switch (O) {
    case "error":
      return "warning";
    case "warning":
      return "info";
    case "info":
      return "hint";
    default:
      return "hint";
  }
}

const checkUnconnectedPorts = (O) => {
  for (let item of O.currentModule.items) {
    if (item.kind !== "InstanceDeclaration") {
      continue;
    }
    let m = item;
    let instancePorts = resolveInstancePorts(
      m.moduleName,
      O.ast.span.fileUri,
      O.symbolTable,
      O.ast,
    );
    if (instancePorts.length === 0) {
      continue;
    }
    let E = new Map();
    for (let portConnection of m.portConnections) {
      let M = portConnection.expression !== undefined;
      let portName = portConnection.portName;
      if (portName.startsWith("__pos_")) {
        let int = parseInt(portName.slice(6), 10);
        let J = Number.isNaN(int) ? undefined : instancePorts[int];
        if (J) {
          portName = J.name;
        }
      }
      E.set(portName, M);
    }
    for (let instancePort of instancePorts) {
      if (E.get(instancePort.name) !== true) {
        if (instancePort.direction === "input" || instancePort.direction === "inout") {
          O.report(
            `Input port '${instancePort.name}' of submodule '${m.moduleName}' is unconnected in instance '${m.instanceName}'. Floating inputs can cause undefined behavior (RMM-2.3).`,
            m.span,
          );
        } else {
          if (instancePort.direction === "output") {
            O.report(
              `Output port '${instancePort.name}' of submodule '${m.moduleName}' is unconnected in instance '${m.instanceName}' (RMM-2.3).`,
              m.span,
              downgradeSeverity(O.ruleConfig.severity),
            );
          }
        }
      }
    }
  }
};

const checkAlwaysHasControl = (O) => {
  for (let d of walkItems(O.currentModule.items)) {
    if (d.kind === "AlwaysBlock") {
      if (!(d.sensitivities.length > 0 || d.delayExpr)) {
        O.report(
          "'always' block has no event control (@) and no delay control (#). It has no hardware meaning (not synthesizable) and in simulation it forms a zero-delay infinite loop that never advances time. Use always @(...) or always @*.",
          d.span,
        );
      }
    }
  }
};

const checkDelayAlwaysInRtl = (O) => {
  for (let d of walkItems(O.currentModule.items)) {
    if (d.kind === "AlwaysBlock") {
      if (!(d.sensitivities.length > 0)) {
        if (d.delayExpr) {
          O.report(
            "Delay-controlled 'always' (e.g. a clock generator) is a simulation construct: it is not synthesizable and belongs in a testbench, not in RTL.",
            d.span,
          );
        }
      }
    }
  }
};

function registerBuiltinCheckers(O = defaultRegistry) {
  if (!O.has("starc-1-1-2-parameter-naming")) {
    O.register("starc-1-1-2-parameter-naming", checkParameterNaming);
  }
  if (!O.has("starc-1-2-1-module-filename")) {
    O.register("starc-1-2-1-module-filename", checkModuleFilename);
  }
  if (!O.has("starc-1-2-2-single-module")) {
    O.register("starc-1-2-2-single-module", checkSingleModule);
  }
  if (!O.has("starc-2-1-1-mixed-assignments")) {
    O.register("starc-2-1-1-mixed-assignments", checkMixedAssignments);
  }
  if (!O.has("starc-2-1-2-assignment-type")) {
    O.register("starc-2-1-2-assignment-type", checkAssignmentType);
  }
  if (!O.has("starc-2-2-1-incomplete-sensitivity")) {
    O.register("starc-2-2-1-incomplete-sensitivity", checkIncompleteSensitivity);
  }
  if (!O.has("starc-2-3-1-case-default")) {
    O.register("starc-2-3-1-case-default", checkCaseDefault);
  }
  if (!O.has("starc-3-1-1-bitwidth-mismatch")) {
    O.register("starc-3-1-1-bitwidth-mismatch", checkBitwidthMismatch);
  }
  if (!O.has("starc-1-1-1-naming-conventions")) {
    O.register("starc-1-1-1-naming-conventions", checkNamingConventions);
  }
  if (!O.has("rmm-2-2-named-port-connections")) {
    O.register("rmm-2-2-named-port-connections", checkNamedPorts);
  }
  if (!O.has("rmm-2-3-unconnected-ports")) {
    O.register("rmm-2-3-unconnected-ports", checkUnconnectedPorts);
  }
  if (!O.has("starc-latch-inference")) {
    O.register("starc-latch-inference", checkLatchInference);
  }
  if (!O.has("theryx-rtl-1-always-control")) {
    O.register("theryx-rtl-1-always-control", checkAlwaysHasControl);
  }
  if (!O.has("theryx-rtl-2-delay-always-rtl")) {
    O.register("theryx-rtl-2-delay-always-rtl", checkDelayAlwaysInRtl);
  }
}

registerBuiltinCheckers(defaultRegistry);
