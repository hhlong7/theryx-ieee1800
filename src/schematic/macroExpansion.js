class MacroGraphBuilder {
  constructor(prefix) {
    this.prefix = prefix;
  }
  prefix;
  nodes = [];
  connections = [];
  nextId = 0;
  id(d) {
    return `${this.prefix}_${d}_${++this.nextId}`;
  }
  push(d) {
    this.nodes.push(d);
  }
  connect(d, m, k, E, C) {
    this.connections.push({
      id: this.id("wire"),
      sourceNodeId: d,
      sourcePinId: m,
      targetNodeId: k,
      targetPinId: E,
      bitWidth: C,
    });
  }
  portIn(d, m) {
    let k = {
      id: this.id("port_in"),
      type: "PORT_IN",
      label: d,
      pins: [
        {
          id: "out",
          name: "OUT",
          direction: "out",
          bitWidth: m,
        },
      ],
      bitWidth: m,
    };
    this.push(k);
    return k;
  }
  portOut(d, m) {
    let k = {
      id: this.id("port_out"),
      type: "PORT_OUT",
      label: d,
      pins: [
        {
          id: "in",
          name: "IN",
          direction: "in",
          bitWidth: m,
        },
      ],
      bitWidth: m,
    };
    this.push(k);
    return k;
  }
  bitOf(d, m) {
    let k = {
      id: this.id("split"),
      type: "SPLIT",
      label: `[${m}]`,
      pins: [
        {
          id: "in",
          name: "IN",
          direction: "in",
          bitWidth: d.bitWidth,
        },
        {
          id: "out",
          name: "OUT",
          direction: "out",
          bitWidth: 1,
        },
      ],
      bitWidth: 1,
      attributes: {
        index: m,
      },
    };
    this.push(k);
    this.connect(d.nodeId, "out", k.id, "in", d.bitWidth);
    return {
      nodeId: k.id,
      pinId: "out",
    };
  }
  sliceOf(d, m, k) {
    let E = m + k - 1;
    let C = {
      id: this.id("split"),
      type: "SPLIT",
      label: `[${E}:${m}]`,
      pins: [
        {
          id: "in",
          name: "IN",
          direction: "in",
          bitWidth: d.bitWidth,
        },
        {
          id: "out",
          name: "OUT",
          direction: "out",
          bitWidth: k,
        },
      ],
      bitWidth: k,
      attributes: {
        msb: E,
        lsb: m,
      },
    };
    this.push(C);
    this.connect(d.nodeId, "out", C.id, "in", d.bitWidth);
    return {
      nodeId: C.id,
      pinId: "out",
      bitWidth: k,
    };
  }
  constant(d, m) {
    let k = m > 8 ? `${m}'b0` : `${m}'b${(d >>> 0).toString(2).padStart(m, "0").slice(-m)}`;
    let E = {
      id: this.id("const"),
      type: "CONSTANT",
      label: k,
      pins: [
        {
          id: "out",
          name: "Y",
          direction: "out",
          bitWidth: m,
        },
      ],
      bitWidth: m,
      attributes: {
        value: d,
      },
    };
    this.push(E);
    return {
      nodeId: E.id,
      pinId: "out",
      bitWidth: m,
    };
  }
  gate(d, m, k) {
    let E = m.length === 1 ? ["in"] : m.map((R, J) => `in${J}`);
    let C = m.map((R, J) => (J === 0 ? "A" : J === 1 ? "B" : `in${J}`));
    let M = m.map((R, J) => ({
      id: E[J],
      name: C[J],
      direction: "in",
      bitWidth: 1,
    }));
    let v = {
      id: this.id("gate"),
      type: d,
      label: k ?? gateOperator(d),
      pins: [
        ...M,
        {
          id: "out",
          name: "Y",
          direction: "out",
          bitWidth: 1,
        },
      ],
      bitWidth: 1,
    };
    this.push(v);
    m.forEach((R, J) => {
      this.connect(R.nodeId, R.pinId, v.id, E[J], 1);
    });
    return {
      nodeId: v.id,
      pinId: "out",
    };
  }
  concat(d) {
    let reduce = d.reduce((C, M) => C + M.bitWidth, 0);
    let k = d.map((C, M) => ({
      id: `in${M}`,
      name: `in${M}`,
      direction: "in",
      bitWidth: d[M].bitWidth,
    }));
    let E = {
      id: this.id("concat"),
      type: "CONCAT",
      label: "{ }",
      pins: [
        ...k,
        {
          id: "out",
          name: "Y",
          direction: "out",
          bitWidth: reduce,
        },
      ],
      bitWidth: reduce,
    };
    this.push(E);
    d.forEach((C, M) => {
      this.connect(C.nodeId, C.pinId, E.id, `in${M}`, C.bitWidth);
    });
    return {
      nodeId: E.id,
      pinId: "out",
      bitWidth: reduce,
    };
  }
  isZeroConstant(d) {
    let m = this.nodes.find((k) => k.id === d.nodeId);
    return m?.type === "CONSTANT" && m.attributes?.value === 0;
  }
  graph(d) {
    return {
      moduleName: d,
      nodes: this.nodes,
      connections: this.connections,
      isSubcircuit: true,
    };
  }
}

function gateOperator(O) {
  switch (O) {
    case "GATE_AND":
      return "&";
    case "GATE_OR":
      return "|";
    case "GATE_XOR":
      return "^";
    case "GATE_XNOR":
      return "^~";
    case "GATE_NAND":
      return "~&";
    case "GATE_NOR":
      return "~|";
    case "GATE_NOT":
      return "~";
    default:
      return O;
  }
}

function reduceTree(O, d, m) {
  let k = m;
  for (; k.length > 1;) {
    let E = [];
    for (let C = 0; C + 1 < k.length; C += 2) {
      E.push(O.gate(d, [k[C], k[C + 1]]));
    }
    if (k.length % 2 === 1) {
      E.push(k[k.length - 1]);
    }
    k = E;
  }
  return k[0];
}

function expandReduction(O, d) {
  let m = String(O.attributes?.operator ?? "");
  let k = O.pins.find((X) => X.direction === "in");
  let bitWidth = k.bitWidth;
  let portIn = d.portIn(k.name, bitWidth);
  let portOut = d.portOut("Y", 1);
  let v = m === "&" || m === "~&" ? "GATE_AND" : m === "|" || m === "~|" ? "GATE_OR" : "GATE_XOR";
  if (bitWidth === 1) {
    let bitOf = d.bitOf(
      {
        nodeId: portIn.id,
        bitWidth: bitWidth,
      },
      0,
    );
    if (m.startsWith("~") || m === "^~") {
      let gate = d.gate("GATE_NOT", [bitOf]);
      d.connect(gate.nodeId, gate.pinId, portOut.id, "in", 1);
    } else {
      d.connect(bitOf.nodeId, bitOf.pinId, portOut.id, "in", 1);
    }
    return d.graph(`${O.label} (1 bit)`);
  }
  let R = [];
  for (let X = 0; X < bitWidth; X++) {
    R.push(
      d.bitOf(
        {
          nodeId: portIn.id,
          bitWidth: bitWidth,
        },
        X,
      ),
    );
  }
  let J = reduceTree(d, v, R);
  if (m.startsWith("~") || m === "^~") {
    let gate2 = d.gate("GATE_NOT", [J]);
    d.connect(gate2.nodeId, gate2.pinId, portOut.id, "in", 1);
  } else {
    d.connect(J.nodeId, J.pinId, portOut.id, "in", 1);
  }
  return d.graph(`${O.label} (${bitWidth} bits)`);
}

function expandShift(O, d) {
  let m = String(O.attributes?.operator ?? "");
  let shiftAmount = O.attributes?.shiftAmount;
  if (typeof shiftAmount != "number") {
    return;
  }
  let maxValue = Math.max(0, Math.floor(shiftAmount));
  let C = O.pins.find((te) => te.id === "in0");
  let M = O.pins.find((te) => te.id === "out");
  let bitWidth = C.bitWidth;
  let R = O.pins.find((te) => te.id === "in1");
  let portIn = d.portIn(C.name, bitWidth);
  if (R) {
    d.portIn(R.name, R.bitWidth);
  }
  let portOut = d.portOut("Y", M.bitWidth);
  let minValue = Math.min(maxValue, bitWidth);
  let Re = {
    nodeId: portIn.id,
    pinId: "out",
    bitWidth: bitWidth,
  };
  let Qe = {
    nodeId: portIn.id,
    bitWidth: bitWidth,
  };
  let le;
  if (minValue === 0) {
    le = Re;
  } else if (m === "<<" || m === "<<<") {
    let te = [];
    if (bitWidth - minValue > 0) {
      te.push(d.sliceOf(Qe, 0, bitWidth - minValue));
    }
    te.push(d.constant(0, minValue));
    le = te.length === 1 ? te[0] : d.concat(te);
  } else if (m === ">>") {
    let te = [];
    te.push(d.constant(0, minValue));
    if (bitWidth - minValue > 0) {
      te.push(d.sliceOf(Qe, minValue, bitWidth - minValue));
    }
    le = te.length === 1 ? te[0] : d.concat(te);
  } else {
    let te = [];
    for (let Oe = 0; Oe < minValue; Oe++) {
      let bitOf = d.bitOf(Qe, bitWidth - 1);
      te.push({
        nodeId: bitOf.nodeId,
        pinId: bitOf.pinId,
        bitWidth: 1,
      });
    }
    if (bitWidth - minValue > 0) {
      te.push(d.sliceOf(Qe, minValue, bitWidth - minValue));
    }
    le = te.length === 1 ? te[0] : d.concat(te);
  }
  d.connect(le.nodeId, le.pinId, portOut.id, "in", M.bitWidth);
  return d.graph(`${O.label} (${bitWidth} bits)`);
}

function expandGate(O, d) {
  let m = O.pins.filter((R) => R.direction === "in");
  let k = O.pins.find((R) => R.id === "out");
  let E = m.map((R) => d.portIn(R.name, R.bitWidth));
  let portOut = d.portOut("Y", k.bitWidth);
  let M = E.map((R, J) => ({
    nodeId: R.id,
    pinId: "out",
    bitWidth: m[J].bitWidth,
  }));
  let v = M.length === 1 ? M[0] : d.concat(M);
  d.connect(v.nodeId, v.pinId, portOut.id, "in", k.bitWidth);
  return d.graph(`${O.label} (${m.length} chunks)`);
}

function fullAdder(O, d, m, k) {
  let gate = O.gate("GATE_XOR", [d, m]);
  let gate2 = O.gate("GATE_XOR", [gate, k]);
  let gate3 = O.gate("GATE_AND", [d, m]);
  let gate4 = O.gate("GATE_AND", [gate, k]);
  let gate5 = O.gate("GATE_OR", [gate3, gate4]);
  return {
    sum: gate2,
    cout: gate5,
  };
}

function halfAdder(O, d, m) {
  let gate = O.gate("GATE_XOR", [d, m]);
  let gate2 = O.gate("GATE_AND", [d, m]);
  return {
    sum: gate,
    cout: gate2,
  };
}

function bitOrZero(O, d, m) {
  if (d && m < d.bitWidth) {
    return O.bitOf(d, m);
  }
  let constant = O.constant(0, 1);
  return {
    nodeId: constant.nodeId,
    pinId: constant.pinId,
  };
}

function rippleCarry(O, d, m, k) {
  let count = d.length;
  let C = [];
  let M = k;
  for (let R = 0; R < count; R++) {
    let J = M === undefined ? halfAdder(O, d[R], m[R]) : fullAdder(O, d[R], m[R], M);
    C.push(J.sum);
    M = J.cout;
  }
  let v = M ?? O.gate("GATE_NOT", [O.gate("GATE_AND", [d[0], m[0]])]);
  return {
    sumBits: C,
    finalCout: v,
  };
}

function expandAdd(O, d) {
  let m = O.pins.find((Qe) => Qe.id === "in0");
  let k = O.pins.find((Qe) => Qe.id === "in1");
  let E = O.pins.find((Qe) => Qe.id === "out");
  let maxValue = Math.max(m.bitWidth, k.bitWidth, E.bitWidth);
  let portIn = d.portIn(m.name, m.bitWidth);
  let portIn2 = d.portIn(k.name, k.bitWidth);
  let portOut = d.portOut("Y", E.bitWidth);
  let J = [];
  let X = [];
  for (let Qe = 0; Qe < maxValue; Qe++) {
    J.push(
      bitOrZero(
        d,
        {
          nodeId: portIn.id,
          bitWidth: m.bitWidth,
        },
        Qe,
      ),
    );
    X.push(
      bitOrZero(
        d,
        {
          nodeId: portIn2.id,
          bitWidth: k.bitWidth,
        },
        Qe,
      ),
    );
  }
  let { sumBits: Q } = rippleCarry(d, J, X);
  let Re = d.concat(
    Q.map((Qe, le) => ({
      handle: Qe,
      index: le,
    }))
      .sort((Qe, le) => le.index - Qe.index)
      .map((Qe) => ({
        nodeId: Qe.handle.nodeId,
        pinId: Qe.handle.pinId,
        bitWidth: 1,
      })),
  );
  connectPadded(d, Re, portOut, E.bitWidth);
  return d.graph(`+ (${maxValue} bits, ripple-carry)`);
}

function expandSub(O, d) {
  let m = O.pins.find((le) => le.id === "in0");
  let k = O.pins.find((le) => le.id === "in1");
  let E = O.pins.find((le) => le.id === "out");
  let maxValue = Math.max(m.bitWidth, k.bitWidth, E.bitWidth);
  let portIn = d.portIn(m.name, m.bitWidth);
  let portIn2 = d.portIn(k.name, k.bitWidth);
  let portOut = d.portOut("Y", E.bitWidth);
  let J = [];
  let X = [];
  for (let le = 0; le < maxValue; le++) {
    J.push(
      bitOrZero(
        d,
        {
          nodeId: portIn.id,
          bitWidth: m.bitWidth,
        },
        le,
      ),
    );
    let te = bitOrZero(
      d,
      {
        nodeId: portIn2.id,
        bitWidth: k.bitWidth,
      },
      le,
    );
    X.push(d.gate("GATE_NOT", [te]));
  }
  let constant = d.constant(1, 1);
  let { sumBits: Re } = rippleCarry(d, J, X, {
    nodeId: constant.nodeId,
    pinId: constant.pinId,
  });
  let Qe = d.concat(
    Re.map((le, te) => ({
      handle: le,
      index: te,
    }))
      .sort((le, te) => te.index - le.index)
      .map((le) => ({
        nodeId: le.handle.nodeId,
        pinId: le.handle.pinId,
        bitWidth: 1,
      })),
  );
  connectPadded(d, Qe, portOut, E.bitWidth);
  return d.graph(`- (${maxValue} bits, two's complement)`);
}

function connectPadded(O, d, m, k) {
  let E = d;
  if (E.bitWidth < k) {
    E = O.concat([O.constant(0, k - E.bitWidth), E]);
  }
  O.connect(E.nodeId, E.pinId, m.id, "in", k);
}

function expandCompare(O, d) {
  let m = String(O.attributes?.operator ?? "==");
  let k = O.pins.find((jn) => jn.id === "in0");
  let E = O.pins.find((jn) => jn.id === "in1");
  let C = O.pins.find((jn) => jn.id === "out");
  let portIn = d.portIn(k.name, k.bitWidth);
  let portIn2 = d.portIn(E.name, E.bitWidth);
  let portOut = d.portOut("Y", C.bitWidth);
  let J = (jn, Ln, ji) => ({
    a: bitOrZero(
      d,
      {
        nodeId: jn.id,
        bitWidth: k.bitWidth,
      },
      ji,
    ),
    b: bitOrZero(
      d,
      {
        nodeId: Ln.id,
        bitWidth: E.bitWidth,
      },
      ji,
    ),
  });
  let X = (jn) => {
    d.connect(jn.nodeId, jn.pinId, portOut.id, "in", C.bitWidth);
  };
  if (m === "==" || m === "===") {
    let maxValue = Math.max(k.bitWidth, E.bitWidth);
    let Ln = [];
    for (let ji = 0; ji < maxValue; ji++) {
      let { a: Hr, b: Zu } = J(portIn, portIn2, ji);
      Ln.push(d.gate("GATE_XNOR", [Hr, Zu]));
    }
    X(Ln.length === 1 ? Ln[0] : reduceTree(d, "GATE_AND", Ln));
    return d.graph(`== (${maxValue} bits)`);
  }
  if (m === "!=" || m === "!==") {
    let maxValue2 = Math.max(k.bitWidth, E.bitWidth);
    let Ln = [];
    for (let ji = 0; ji < maxValue2; ji++) {
      let { a: Hr, b: Zu } = J(portIn, portIn2, ji);
      Ln.push(d.gate("GATE_XNOR", [Hr, Zu]));
    }
    if (Ln.length === 1) {
      X(d.gate("GATE_NOT", [Ln[0]]));
    } else {
      let ji = reduceTree(d, "GATE_AND", Ln);
      X(d.gate("GATE_NOT", [ji]));
    }
    return d.graph(`!= (${maxValue2} bits)`);
  }
  let Q = m === "<" || m === ">=";
  let Re = Q ? portIn : portIn2;
  let Qe = Q ? portIn2 : portIn;
  let le = Q ? k : E;
  let te = Q ? E : k;
  let maxValue3 = Math.max(k.bitWidth, E.bitWidth);
  let _e = [];
  let Ke = [];
  for (let jn = 0; jn < maxValue3; jn++) {
    _e.push(
      bitOrZero(
        d,
        {
          nodeId: Re.id,
          bitWidth: le.bitWidth,
        },
        jn,
      ),
    );
    let Ln = bitOrZero(
      d,
      {
        nodeId: Qe.id,
        bitWidth: te.bitWidth,
      },
      jn,
    );
    Ke.push(d.gate("GATE_NOT", [Ln]));
  }
  let constant = d.constant(1, 1);
  let { finalCout: Se } = rippleCarry(d, _e, Ke, {
    nodeId: constant.nodeId,
    pinId: constant.pinId,
  });
  switch (m) {
    case "<":
    case ">":
      X(d.gate("GATE_NOT", [Se]));
      break;
    case ">=":
    case "<=":
      X(Se);
      break;
    default:
      X(d.gate("GATE_NOT", [Se]));
  }
  return d.graph(`${m} (${maxValue3} bits, via subtractor)`);
}

function expandMux(O, d) {
  let m = O.pins.find((te) => te.id === "in0");
  let k = O.pins.find((te) => te.id === "in1");
  let E = O.pins.find((te) => te.id === "sel");
  let C = O.pins.find((te) => te.id === "out");
  let maxValue = Math.max(m.bitWidth, k.bitWidth, C.bitWidth);
  let portIn = d.portIn(m.name, m.bitWidth);
  let portIn2 = d.portIn(k.name, k.bitWidth);
  let portIn3 = d.portIn(E.name, E.bitWidth);
  let portOut = d.portOut("Y", C.bitWidth);
  let bitOf = d.bitOf(
    {
      nodeId: portIn3.id,
      bitWidth: E.bitWidth,
    },
    0,
  );
  let gate = d.gate("GATE_NOT", [bitOf]);
  let Qe = [];
  for (let te = 0; te < maxValue; te++) {
    let Oe = bitOrZero(
      d,
      {
        nodeId: portIn2.id,
        bitWidth: k.bitWidth,
      },
      te,
    );
    let _e = bitOrZero(
      d,
      {
        nodeId: portIn.id,
        bitWidth: m.bitWidth,
      },
      te,
    );
    let gate2 = d.gate("GATE_AND", [bitOf, Oe]);
    let gate3 = d.gate("GATE_AND", [gate, _e]);
    Qe.push(d.gate("GATE_OR", [gate2, gate3]));
  }
  let le = d.concat(
    Qe.map((te, Oe) => ({
      handle: te,
      index: Oe,
    }))
      .sort((te, Oe) => Oe.index - te.index)
      .map((te) => ({
        nodeId: te.handle.nodeId,
        pinId: te.handle.pinId,
        bitWidth: 1,
      })),
  );
  connectPadded(d, le, portOut, C.bitWidth);
  return d.graph(`MUX 2:1 (${maxValue} bits)`);
}

function groupZeroBits(O, d) {
  let m = [];
  let k = 0;
  for (let E = d.length - 1; E >= 0; E--) {
    let C = d[E];
    if (C.bitWidth === 1 && O.isZeroConstant(C)) {
      k++;
      continue;
    }
    if (k > 0) {
      m.push(O.constant(0, k));
      k = 0;
    }
    m.push(C);
  }
  if (k > 0) {
    m.push(O.constant(0, k));
  }
  return m.length === 0 ? O.constant(0, d.length) : m.length === 1 ? m[0] : O.concat(m);
}

function expandMul(O, d) {
  let m = O.pins.find((le) => le.id === "in0");
  let k = O.pins.find((le) => le.id === "in1");
  let E = O.pins.find((le) => le.id === "out");
  let bitWidth = E.bitWidth;
  let portIn = d.portIn(m.name, m.bitWidth);
  let portIn2 = d.portIn(k.name, k.bitWidth);
  let portOut = d.portOut("Y", E.bitWidth);
  let J = {
    nodeId: portIn.id,
    bitWidth: m.bitWidth,
  };
  let X = {
    nodeId: portIn2.id,
    bitWidth: k.bitWidth,
  };
  let Q = [];
  for (let le = 0; le < k.bitWidth; le++) {
    Q.push(d.bitOf(X, le));
  }
  let Re = (le) => {
    let bitOf = d.bitOf(J, le);
    let Oe = [];
    for (let _e = 0; _e < bitWidth; _e++) {
      let Ke = _e - le;
      if (Ke >= 0 && Ke < k.bitWidth) {
        let gate = d.gate("GATE_AND", [bitOf, Q[Ke]]);
        Oe.push({
          nodeId: gate.nodeId,
          pinId: gate.pinId,
          bitWidth: 1,
        });
      } else {
        let constant = d.constant(0, 1);
        Oe.push({
          nodeId: constant.nodeId,
          pinId: constant.pinId,
          bitWidth: 1,
        });
      }
    }
    return Oe;
  };
  let Qe = groupZeroBits(d, Re(0));
  for (let le = 1; le < m.bitWidth && le < bitWidth; le++) {
    let te = groupZeroBits(d, Re(le));
    let Oe = {
      id: d.id("add"),
      type: "ADD",
      label: "+",
      pins: [
        {
          id: "in0",
          name: "A",
          direction: "in",
          bitWidth: bitWidth,
        },
        {
          id: "in1",
          name: "B",
          direction: "in",
          bitWidth: bitWidth,
        },
        {
          id: "out",
          name: "Y",
          direction: "out",
          bitWidth: bitWidth,
        },
      ],
      bitWidth: bitWidth,
      attributes: {
        isExpandable: true,
        macroType: "add",
        operator: "+",
      },
    };
    d.push(Oe);
    d.connect(Qe.nodeId, Qe.pinId, Oe.id, "in0", Qe.bitWidth);
    d.connect(te.nodeId, te.pinId, Oe.id, "in1", te.bitWidth);
    Qe = {
      nodeId: Oe.id,
      pinId: "out",
      bitWidth: bitWidth,
    };
  }
  connectPadded(d, Qe, portOut, bitWidth);
  return d.graph(`* (${m.bitWidth}x${k.bitWidth}, partial products)`);
}

export function expandMacroNode(O) {
  if (O.attributes?.isExpandable !== true) {
    return;
  }
  let macroType = O.attributes?.macroType;
  let macroGraphBuilder = new MacroGraphBuilder(O.id);
  switch (macroType) {
    case "reduction":
      return expandReduction(O, macroGraphBuilder);
    case "shift":
      return expandShift(O, macroGraphBuilder);
    case "replication":
      return expandGate(O, macroGraphBuilder);
    case "add":
      return expandAdd(O, macroGraphBuilder);
    case "sub":
      return expandSub(O, macroGraphBuilder);
    case "compare":
      return expandCompare(O, macroGraphBuilder);
    case "mux":
      return expandMux(O, macroGraphBuilder);
    case "mul":
      return expandMul(O, macroGraphBuilder);
    default:
      return;
  }
}
