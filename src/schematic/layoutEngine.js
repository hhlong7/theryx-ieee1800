import ELK from "elkjs/lib/elk.bundled.js";
import * as fs from "fs";
import * as workerThreads from "worker_threads";
import { cellFor } from "./cellLibrary.js";

const inProcessElk = new ELK();

const LAYOUT_TIMEOUT_MS = 8e3;

const NODE_SPACING = 90;

const LAYER_SPACING = 45;

const GRAPH_PADDING = 30;

export class LayoutEngine {
  workerPath;
  timeoutMs;
  logger;
  worker;
  workerUnavailable = false;
  requestCounter = 0;
  pending = new Map();
  constructor(d) {
    this.workerPath = d?.workerPath;
    this.timeoutMs = d?.timeoutMs ?? LAYOUT_TIMEOUT_MS;
    this.logger = d?.logger;
  }
  async computeLayout(d) {
    let elkGraph = this.buildElkGraph(d);
    let k;
    try {
      k = await this.runElk(elkGraph);
    } catch (E) {
      this.logger?.(
        `[Schematic] ELK layout failed for module '${d.moduleName}': ${E?.message ?? E}. Falling back to the simple layered layout.`,
      );
      return this.computeFallbackLayout(d);
    }
    return this.mapElkResult(d, k);
  }
  dispose() {
    this.failAllPending(new Error("Layout engine disposed"));
    try {
      this.worker?.terminate();
    } catch {}
    this.worker = undefined;
  }
  buildElkGraph(d) {
    let m = d.nodes.map((v) => {
      let R = cellFor(v.type);
      let J = v.pins.filter((Oe) => Oe.direction === "in");
      let X = v.pins.filter((Oe) => Oe.direction === "out");
      let { width: Q, height: Re } = this.computeNodeSize(v);
      let Qe = v.pins.map((Oe, _e) => {
        let Ke = R.pins.find((Ln) => Ln.id === Oe.id);
        let yn;
        let Se;
        let jn;
        if (v.type === "SUBMODULE") {
          if (Oe.direction === "out") {
            let index = X.indexOf(Oe);
            yn = Q;
            Se = 35 + index * 22;
            jn = "EAST";
          } else {
            let index2 = J.indexOf(Oe);
            yn = 0;
            Se = 35 + index2 * 22;
            jn = "WEST";
          }
        } else if (v.type === "CONCAT" || v.type === "REPLICATION") {
          if (Oe.direction === "out") {
            yn = Q;
            Se = Math.round(Re / 2);
            jn = "EAST";
          } else {
            let index3 = J.indexOf(Oe);
            yn = 0;
            Se = 12 + index3 * 16;
            jn = "WEST";
          }
        } else {
          jn = Ke?.side ?? (Oe.direction === "out" ? "EAST" : "WEST");
          if (jn === "EAST") {
            yn = Q;
          } else {
            if (jn === "WEST") {
              yn = 0;
            } else {
              yn = Ke ? Ke.x : Math.round(Q / 2);
            }
          }
          Se = Ke ? Ke.y : 15 + _e * 18;
        }
        return {
          id: `${v.id}_${Oe.id}`,
          x: yn,
          y: Se,
          width: 0,
          height: 0,
          layoutOptions: {
            "elk.port.side": jn,
          },
        };
      });
      let le =
        v.type === "PORT_OUT" ||
        v.type === "PORT_INOUT" ||
        v.type === "PORT_INTERMEDIATE" ||
        v.type === "SIGNAL_UNUSED";
      let te = v.type === "PORT_IN";
      return {
        id: v.id,
        width: Q,
        height: Re,
        ports: Qe,
        layoutOptions: {
          "elk.portConstraints": "FIXED_POS",
          "elk.layered.layering.layerConstraint": le ? "LAST" : te ? "FIRST" : "NONE",
        },
      };
    });
    let k = new Map(d.nodes.map((v) => [v.id, new Set(v.pins.map((R) => R.id))]));
    let E = d.connections.filter((v) => {
      let value = k.get(v.sourceNodeId);
      let value2 = k.get(v.targetNodeId);
      return !!value && value.has(v.sourcePinId) && !!value2 && value2.has(v.targetPinId);
    });
    let C = new Map(d.nodes.map((v) => [v.id, v]));
    let M = E.map((v) => {
      let value = C.get(v.sourceNodeId);
      let value2 = C.get(v.targetNodeId);
      let X = 5;
      if (
        value2 &&
        (value2.type === "PORT_OUT" ||
          value2.type === "PORT_INOUT" ||
          value2.type === "PORT_INTERMEDIATE" ||
          value2.type === "SIGNAL_UNUSED" ||
          value2.type === "DFF" ||
          value2.type === "LATCH")
      ) {
        X = 10;
      }
      if (
        value &&
        (value.type === "DFF" || value.type === "LATCH") &&
        value2 &&
        value2.type !== "PORT_OUT" &&
        value2.type !== "PORT_INOUT" &&
        value2.type !== "PORT_INTERMEDIATE" &&
        value2.type !== "SIGNAL_UNUSED"
      ) {
        X = 1;
      }
      return {
        id: v.id,
        sources: [`${v.sourceNodeId}_${v.sourcePinId}`],
        targets: [`${v.targetNodeId}_${v.targetPinId}`],
        layoutOptions: {
          "org.eclipse.elk.layered.priority.direction": String(X),
        },
      };
    });
    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "org.eclipse.elk.layered.feedbackEdges": "true",
        "elk.layered.spacing.nodeNodeBetweenLayers": "75",
        "elk.spacing.nodeNode": "45",
        "elk.spacing.edgeNode": "25",
        "elk.spacing.edgeEdge": "18",
        "elk.padding": "[top=30,left=30,bottom=30,right=30]",
      },
      children: m,
      edges: M,
    };
  }
  async runElk(d) {
    let m = this.ensureWorker();
    return m ? await this.layoutInWorker(m, d) : await inProcessElk.layout(d);
  }
  ensureWorker() {
    if (this.worker) {
      return this.worker;
    }
    if (!(this.workerUnavailable || !this.workerPath)) {
      if (!fs.existsSync(this.workerPath)) {
        this.workerUnavailable = true;
        this.logger?.(
          `[Schematic] ELK worker not found at '${this.workerPath}'; running ELK in-process instead (this may block the extension host briefly).`,
        );
        return;
      }
      try {
        let d = new workerThreads.Worker(this.workerPath);
        d.on("message", (m) => {
          let value = this.pending.get(m?.id);
          if (value) {
            this.pending.delete(m.id);
            clearTimeout(value.timer);
            if (m?.type === "error") {
              value.reject(new Error(String(m.error)));
            } else {
              value.resolve(m.result);
            }
          }
        });
        d.on("error", (m) => {
          this.failAllPending(m);
          this.worker = undefined;
          this.workerUnavailable = true;
          this.logger?.(
            `[Schematic] ELK worker crashed (${m.message}); layouts will run in-process for the rest of the session.`,
          );
        });
        d.on("exit", () => {
          this.failAllPending(new Error("ELK worker exited"));
          this.worker = undefined;
        });
        this.worker = d;
        return d;
      } catch (d) {
        this.workerUnavailable = true;
        this.logger?.(
          `[Schematic] Could not start the ELK worker (${d?.message ?? d}); running ELK in-process instead.`,
        );
        return;
      }
    }
  }
  layoutInWorker(d, m) {
    let k = ++this.requestCounter;
    return new Promise((E, C) => {
      let M = setTimeout(() => {
        this.pending.delete(k);
        C(new Error(`ELK layout timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(k, {
        resolve: E,
        reject: C,
        timer: M,
      });
      try {
        d.postMessage({
          type: "layout",
          id: k,
          graph: m,
        });
      } catch (v) {
        this.pending.delete(k);
        clearTimeout(M);
        C(v instanceof Error ? v : new Error(String(v)));
      }
    });
  }
  failAllPending(d) {
    for (let m of this.pending.values()) {
      clearTimeout(m.timer);
      m.reject(d);
    }
    this.pending.clear();
  }
  mapElkResult(d, m) {
    let k = [];
    let E = new Map();
    let C = new Map(d.nodes.map((J) => [J.id, J]));
    let M = new Map(d.connections.map((J) => [J.id, J]));
    for (let J of m.children ?? []) {
      let value = C.get(J.id);
      if (!value) {
        continue;
      }
      let Q = Math.round(J.x ?? 0);
      let Re = Math.round(J.y ?? 0);
      E.set(J.id, {
        x: Q,
        y: Re,
      });
      let Qe = J.width ?? 50;
      let le = J.height ?? 40;
      let te = this.computePinOffsets(value, Qe, le).map((Oe) => ({
        id: Oe.pin.id,
        name: Oe.pin.name,
        direction: Oe.pin.direction,
        x: Q + Oe.relX,
        y: Re + Oe.relY,
        bitWidth: Oe.pin.bitWidth,
      }));
      k.push({
        id: value.id,
        type: value.type,
        label: value.label,
        x: Q,
        y: Re,
        width: Qe,
        height: le,
        pins: te,
        bitWidth: value.bitWidth,
        attributes: value.attributes,
      });
    }
    let v = new Map(k.map((J) => [J.id, J]));
    let R = [];
    for (let J of m.edges ?? []) {
      let value2 = M.get(J.id);
      if (!value2) {
        continue;
      }
      let Q = [];
      for (let Re of J.sections ?? []) {
        if (Re.startPoint) {
          Q.push({
            x: Math.round(Re.startPoint.x),
            y: Math.round(Re.startPoint.y),
          });
        }
        for (let Qe of Re.bendPoints ?? []) {
          Q.push({
            x: Math.round(Qe.x),
            y: Math.round(Qe.y),
          });
        }
        if (Re.endPoint) {
          Q.push({
            x: Math.round(Re.endPoint.x),
            y: Math.round(Re.endPoint.y),
          });
        }
      }
      if (Q.length === 0) {
        let Re = v.get(value2.sourceNodeId)?.pins.find((le) => le.id === value2.sourcePinId);
        let Qe = v.get(value2.targetNodeId)?.pins.find((le) => le.id === value2.targetPinId);
        if (Re && Qe) {
          let le = Math.round((Re.x + Qe.x) / 2);
          Q.push({
            x: Math.round(Re.x),
            y: Math.round(Re.y),
          });
          Q.push({
            x: le,
            y: Math.round(Re.y),
          });
          Q.push({
            x: le,
            y: Math.round(Qe.y),
          });
          Q.push({
            x: Math.round(Qe.x),
            y: Math.round(Qe.y),
          });
        }
      }
      R.push({
        id: value2.id,
        sourceNodeId: value2.sourceNodeId,
        targetNodeId: value2.targetNodeId,
        points: Q,
        bitWidth: value2.bitWidth,
        netName: value2.netName,
      });
    }
    return {
      moduleName: d.moduleName,
      width: Math.max(m.width ?? 400, 300),
      height: Math.max(m.height ?? 300, 200),
      nodes: k,
      connections: R,
      isSubcircuit: d.isSubcircuit,
    };
  }
  computeNodeSize(d) {
    let m = cellFor(d.type);
    let k = d.pins.filter((J) => J.direction === "in");
    let E = d.pins.filter((J) => J.direction === "out");
    let maxValue = Math.max(k.length, E.length, 1);
    let M = d.label.length + (d.bitWidth > 1 ? ` [${d.bitWidth - 1}:0]`.length : 0);
    let v =
      d.type === "SUBMODULE"
        ? 130
        : d.type === "CONCAT"
          ? 44
          : d.type === "REPLICATION"
            ? 52
            : d.type === "SIGNAL_UNUSED"
              ? Math.max(65, 30 + M * 7.5)
              : d.type === "PORT_INTERMEDIATE" || d.type === "PORT_IN" || d.type === "PORT_OUT"
                ? Math.max(55, 24 + M * 7.5)
                : m.width;
    let R =
      d.type === "SUBMODULE"
        ? Math.max(60, 32 + maxValue * 22)
        : d.type === "CONCAT" || d.type === "REPLICATION"
          ? Math.max(36, 12 + k.length * 16)
          : m.height;
    return {
      width: v,
      height: R,
    };
  }
  computePinOffsets(d, m, k) {
    let E = cellFor(d.type);
    let C = d.pins.filter((v) => v.direction === "in");
    let M = d.pins.filter((v) => v.direction === "out");
    return d.pins.map((v, R) => {
      let J = E.pins.find((Re) => Re.id === v.id);
      let X;
      let Q;
      if (d.type === "SUBMODULE") {
        if (v.direction === "out") {
          X = m;
          Q = 35 + M.indexOf(v) * 22;
        } else {
          X = 0;
          Q = 35 + C.indexOf(v) * 22;
        }
      } else if (d.type === "CONCAT" || d.type === "REPLICATION") {
        if (v.direction === "out") {
          X = m;
          Q = Math.round(k / 2);
        } else {
          X = 0;
          Q = 12 + C.indexOf(v) * 16;
        }
      } else {
        let Re = J?.side ?? (v.direction === "out" ? "EAST" : "WEST");
        if (Re === "EAST") {
          X = m;
        } else {
          if (Re === "WEST") {
            X = 0;
          } else {
            X = J ? J.x : Math.round(m / 2);
          }
        }
        Q = J ? J.y : 15 + R * 18;
      }
      return {
        pin: v,
        relX: X,
        relY: Q,
      };
    });
  }
  computeFallbackLayout(d) {
    let m = new Map(d.nodes.map((le) => [le.id, le]));
    let k = new Map();
    let E = new Set();
    let C = (le) => {
      let value = k.get(le);
      if (value !== undefined) {
        return value;
      }
      if (E.has(le)) {
        return 0;
      }
      E.add(le);
      let Oe = 0;
      for (let connection of d.connections) {
        if (connection.targetNodeId === le && m.has(connection.sourceNodeId)) {
          Oe = Math.max(Oe, C(connection.sourceNodeId) + 1);
        }
      }
      E.delete(le);
      k.set(le, Oe);
      return Oe;
    };
    for (let node of d.nodes) {
      C(node.id);
    }
    let M = new Map();
    for (let node2 of d.nodes) {
      let te = k.get(node2.id) ?? 0;
      let value2 = M.get(te);
      if (value2) {
        value2.push(node2);
      } else {
        M.set(te, [node2]);
      }
    }
    let v = M.size > 0 ? Math.max(...M.keys()) : 0;
    let R = [];
    let J = GRAPH_PADDING;
    let X = GRAPH_PADDING;
    for (let le = 0; le <= v; le++) {
      let te = M.get(le) ?? [];
      let Oe = GRAPH_PADDING;
      let _e = 0;
      for (let Ke of te) {
        let { width: yn, height: Se } = this.computeNodeSize(Ke);
        let pinOffsets = this.computePinOffsets(Ke, yn, Se);
        R.push({
          id: Ke.id,
          type: Ke.type,
          label: Ke.label,
          x: J,
          y: Oe,
          width: yn,
          height: Se,
          pins: pinOffsets.map((Ln) => ({
            id: Ln.pin.id,
            name: Ln.pin.name,
            direction: Ln.pin.direction,
            x: J + Ln.relX,
            y: Oe + Ln.relY,
            bitWidth: Ln.pin.bitWidth,
          })),
          bitWidth: Ke.bitWidth,
          attributes: Ke.attributes,
        });
        _e = Math.max(_e, yn);
        Oe += Se + LAYER_SPACING;
      }
      X = Math.max(X, Oe - GRAPH_PADDING);
      J += _e + NODE_SPACING;
    }
    let Q = new Map(R.map((le) => [le.id, le]));
    let Re = [];
    for (let connection2 of d.connections) {
      let value3 = Q.get(connection2.sourceNodeId);
      let value4 = Q.get(connection2.targetNodeId);
      if (!value3 || !value4) {
        continue;
      }
      let _e = value3.pins.find((Se) => Se.id === connection2.sourcePinId);
      let Ke = value4.pins.find((Se) => Se.id === connection2.targetPinId);
      let yn = [];
      if (_e && Ke) {
        let Se = Math.round((_e.x + Ke.x) / 2);
        yn.push({
          x: Math.round(_e.x),
          y: Math.round(_e.y),
        });
        yn.push({
          x: Se,
          y: Math.round(_e.y),
        });
        yn.push({
          x: Se,
          y: Math.round(Ke.y),
        });
        yn.push({
          x: Math.round(Ke.x),
          y: Math.round(Ke.y),
        });
      }
      Re.push({
        id: connection2.id,
        sourceNodeId: connection2.sourceNodeId,
        targetNodeId: connection2.targetNodeId,
        points: yn,
        bitWidth: connection2.bitWidth,
        netName: connection2.netName,
      });
    }
    let Qe = Math.max(J - NODE_SPACING, 0) + GRAPH_PADDING;
    return {
      moduleName: d.moduleName,
      width: Math.max(Qe, 300),
      height: Math.max(X, 200),
      nodes: R,
      connections: Re,
      isSubcircuit: d.isSubcircuit,
    };
  }
}
