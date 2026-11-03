import * as path from "path";
import * as fs from "fs";
import * as url from "url";
import { parseSource, isSystemVerilogPath } from "../parser/sourceParser.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", ".vscode", ".hg", ".svn", "dist", "out"]);

const MAX_CACHE_ENTRIES = 512;

const MAX_SCAN_DEPTH = 8;

const MAX_SCAN_ENTRIES = 2e3;

const NEGATIVE_TTL_MS = 1500;

const SOURCE_EXTENSIONS = [".v", ".vh", ".sv", ".svh"];

function isVerilogFileName(O) {
  return /\.(v|vh|sv|svh)$/i.test(O);
}

function escapeRegExp(O) {
  return O.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ModuleResolver {
  cache = new Map();
  packageCache = new Map();
  filesInProgress = new Set();
  searchRoots = [];
  logger;
  negativeTtlMs;
  constructor(d) {
    this.logger = d?.logger;
    this.negativeTtlMs = d?.negativeTtlMs ?? NEGATIVE_TTL_MS;
  }
  setSearchRoots(d) {
    let m = [...new Set(d.map((E) => path.resolve(E)))];
    if (m.length !== this.searchRoots.length || m.some((E, C) => E !== this.searchRoots[C])) {
      this.searchRoots.length = 0;
      this.searchRoots.push(...m);
      for (let [E, C] of this.cache) {
        if (!C.found) {
          this.cache.delete(E);
        }
      }
    }
  }
  resolveModule(d, m) {
    if (!m) {
      return {
        found: false,
      };
    }
    let normalizeToFilePath = this.normalizeToFilePath(m);
    if (!normalizeToFilePath) {
      return {
        found: false,
      };
    }
    let dirname = path.dirname(normalizeToFilePath);
    let stringify = JSON.stringify([dirname, d]);
    let value = this.cache.get(stringify);
    if (value) {
      if (value.found) {
        let fileStamp = this.getFileStamp(value.filePath);
        if (fileStamp && fileStamp.mtimeMs === value.mtimeMs && fileStamp.size === value.size) {
          this.cache.delete(stringify);
          this.cache.set(stringify, value);
          return {
            found: true,
            moduleNode: value.moduleNode,
            filePath: value.filePath,
            searchDir: dirname,
          };
        }
      } else if (this.negativeEntryStillValid(value)) {
        return {
          found: false,
          searchDir: dirname,
        };
      }
      this.cache.delete(stringify);
    }
    let v = new Map();
    let R = [];
    let searchDirectory = this.searchDirectory(dirname, d, v, R);
    if (searchDirectory) {
      this.storePositive(stringify, searchDirectory.filePath, searchDirectory.moduleNode);
      return {
        found: true,
        filePath: searchDirectory.filePath,
        moduleNode: searchDirectory.moduleNode,
        searchDir: dirname,
      };
    }
    for (let searchRoot of this.searchRoots) {
      if (searchRoot === dirname) {
        continue;
      }
      for (let le of SOURCE_EXTENSIONS.map((ext) => path.join(searchRoot, `${d}${ext}`))) {
        if ((R.push(le), this.stampDir(v, searchRoot) && fs.existsSync(le))) {
          let moduleFromFile = this.parseModuleFromFile(le, d);
          if (moduleFromFile) {
            this.storePositive(stringify, le, moduleFromFile);
            return {
              found: true,
              filePath: le,
              moduleNode: moduleFromFile,
              searchDir: dirname,
            };
          }
        }
      }
      let root = this.scanRoot(searchRoot, d, v);
      if (root) {
        this.storePositive(stringify, root.filePath, root.moduleNode);
        return {
          found: true,
          filePath: root.filePath,
          moduleNode: root.moduleNode,
          searchDir: dirname,
        };
      }
    }
    this.storeNegative(stringify, v, R);
    return {
      found: false,
      searchDir: dirname,
    };
  }
  // Finds a package in the importing file's folder, then the workspace roots.
  resolvePackage(d, m) {
    let normalizeToFilePath = this.normalizeToFilePath(m);
    if (!normalizeToFilePath) {
      return { found: false };
    }
    let dirname = path.dirname(normalizeToFilePath);
    let stringify = JSON.stringify([dirname, d]);
    let value = this.packageCache.get(stringify);
    if (value) {
      let fileStamp = this.getFileStamp(value.filePath);
      if (fileStamp && fileStamp.mtimeMs === value.mtimeMs && fileStamp.size === value.size) {
        return { found: true, packageNode: value.packageNode, filePath: value.filePath };
      }
      this.packageCache.delete(stringify);
    }
    let pattern = new RegExp(`\\bpackage\\s+(?:(?:automatic|static)\\s+)?${escapeRegExp(d)}\\b`);
    for (let dir of [dirname, ...this.searchRoots]) {
      let filePath = this.findFileMatching(dir, pattern, `${d}.sv`);
      if (!filePath) {
        continue;
      }
      let packageNode = this.parsePackageFromFile(filePath, d);
      if (packageNode) {
        let fileStamp = this.getFileStamp(filePath);
        this.packageCache.set(stringify, {
          packageNode,
          filePath,
          mtimeMs: fileStamp?.mtimeMs ?? -1,
          size: fileStamp?.size ?? -1,
        });
        return { found: true, packageNode, filePath };
      }
    }
    return { found: false };
  }
  // Breadth-first walk of SystemVerilog sources, trying the conventional file name first.
  findFileMatching(d, m, k) {
    let queue = [{ dir: d, depth: 0 }];
    let visited = 0;
    for (; queue.length > 0 && visited < MAX_SCAN_ENTRIES;) {
      let { dir, depth } = queue.shift();
      let dirEntries = this.readDirEntries(dir);
      if (!dirEntries) {
        continue;
      }
      visited += dirEntries.length;
      let ordered = [...dirEntries].sort((a, b) => (b === k ? 1 : 0) - (a === k ? 1 : 0));
      for (let dirEntry of ordered) {
        let filePath = path.join(dir, dirEntry);
        if (/\.(sv|svh)$/i.test(dirEntry)) {
          try {
            if (m.test(fs.readFileSync(filePath, "utf-8"))) {
              return filePath;
            }
          } catch {}
        } else if (depth < MAX_SCAN_DEPTH && !path.extname(dirEntry) && !IGNORED_DIRS.has(dirEntry)) {
          try {
            if (fs.statSync(filePath).isDirectory()) {
              queue.push({ dir: filePath, depth: depth + 1 });
            }
          } catch {}
        }
      }
    }
  }
  parsePackageFromFile(d, m) {
    if (this.filesInProgress.has(d)) {
      return null;
    }
    this.filesInProgress.add(d);
    try {
      let uri = url.pathToFileURL(d).toString();
      return parseSource(fs.readFileSync(d, "utf-8"), uri, this).ast.packages?.find((k) => k.name === m) ?? null;
    } catch (k) {
      this.logger?.(`[ModuleResolver] Failed to parse '${d}' while searching for '${m}': ${k.message ?? k}`);
      return null;
    } finally {
      this.filesInProgress.delete(d);
    }
  }
  // Resolves `include "name" relative to the including file, then the search roots.
  resolveInclude(d, m) {
    let normalizeToFilePath = this.normalizeToFilePath(m);
    let dirs = [normalizeToFilePath ? path.dirname(normalizeToFilePath) : undefined, ...this.searchRoots];
    for (let dir of dirs) {
      if (!dir) {
        continue;
      }
      let filePath = path.resolve(dir, d);
      try {
        return { uri: url.pathToFileURL(filePath).toString(), text: fs.readFileSync(filePath, "utf-8") };
      } catch {}
    }
  }
  clearCache() {
    this.cache.clear();
    this.packageCache.clear();
  }
  get cacheSize() {
    return this.cache.size;
  }
  searchDirectory(d, m, k, E) {
    if (!this.stampDir(k, d)) {
      return;
    }
    let C = SOURCE_EXTENSIONS.map((ext) => path.join(d, `${m}${ext}`));
    E.push(...C);
    for (let J of C) {
      if (fs.existsSync(J)) {
        let moduleFromFile = this.parseModuleFromFile(J, m);
        if (moduleFromFile) {
          return {
            filePath: J,
            moduleNode: moduleFromFile,
          };
        }
      }
    }
    let dirEntries = this.readDirEntries(d);
    if (!dirEntries) {
      return;
    }
    let v = SOURCE_EXTENSIONS.map((ext) => `${m.toLowerCase()}${ext}`);
    for (let dirEntry of dirEntries) {
      let X = dirEntry.toLowerCase();
      if (v.includes(X)) {
        let Q = path.join(d, dirEntry);
        let moduleFromFile2 = this.parseModuleFromFile(Q, m);
        if (moduleFromFile2) {
          return {
            filePath: Q,
            moduleNode: moduleFromFile2,
          };
        }
      }
    }
    for (let dirEntry2 of dirEntries) {
      if (isVerilogFileName(dirEntry2) && !E.includes(path.join(d, dirEntry2))) {
        let X = path.join(d, dirEntry2);
        let moduleFromFile3 = this.parseModuleFromFile(X, m);
        if (moduleFromFile3) {
          return {
            filePath: X,
            moduleNode: moduleFromFile3,
          };
        }
      }
    }
  }
  scanRoot(d, m, k) {
    let E = [
      {
        dir: d,
        depth: 0,
      },
    ];
    for (; E.length > 0 && k.size < MAX_SCAN_ENTRIES;) {
      let { dir: C, depth: M } = E.shift();
      if (!this.stampDir(k, C)) {
        continue;
      }
      let dirEntries = this.readDirEntries(C);
      if (dirEntries) {
        for (let dirEntry of dirEntries) {
          let J = path.join(C, dirEntry);
          if (isVerilogFileName(dirEntry)) {
            let moduleFromFile = this.parseModuleFromFile(J, m);
            if (moduleFromFile) {
              return {
                filePath: J,
                moduleNode: moduleFromFile,
              };
            }
          } else if (M < MAX_SCAN_DEPTH && !path.extname(dirEntry) && !IGNORED_DIRS.has(dirEntry)) {
            try {
              if (fs.statSync(J).isDirectory()) {
                E.push({
                  dir: J,
                  depth: M + 1,
                });
              }
            } catch {}
          }
        }
      }
    }
  }
  storePositive(d, m, k) {
    let fileStamp = this.getFileStamp(m);
    this.cache.set(d, {
      found: true,
      moduleNode: k,
      filePath: m,
      mtimeMs: fileStamp?.mtimeMs ?? -1,
      size: fileStamp?.size ?? -1,
    });
    this.evictIfNeeded();
  }
  storeNegative(d, m, k) {
    this.cache.set(d, {
      found: false,
      scannedDirs: m,
      directCandidates: k,
      createdAt: Date.now(),
    });
    this.evictIfNeeded();
  }
  evictIfNeeded() {
    for (; this.cache.size > MAX_CACHE_ENTRIES;) {
      let next = this.cache.keys().next();
      if (next.done || next.value === undefined) {
        break;
      }
      this.cache.delete(next.value);
    }
  }
  negativeEntryStillValid(d) {
    if (this.negativeTtlMs > 0 && Date.now() - d.createdAt > this.negativeTtlMs) {
      return false;
    }
    for (let directCandidate of d.directCandidates) {
      if (fs.existsSync(directCandidate)) {
        return false;
      }
    }
    for (let [m, k] of d.scannedDirs) {
      try {
        if (fs.statSync(m).mtimeMs !== k) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }
  stampDir(d, m) {
    try {
      d.set(m, fs.statSync(m).mtimeMs);
      return true;
    } catch {
      return false;
    }
  }
  readDirEntries(d) {
    try {
      return fs.readdirSync(d);
    } catch (m) {
      this.logger?.(`[ModuleResolver] Could not read directory '${d}': ${m.message ?? m}`);
      return;
    }
  }
  getFileStamp(d) {
    try {
      let statSync = fs.statSync(d);
      return {
        mtimeMs: statSync.mtimeMs,
        size: statSync.size,
      };
    } catch {
      return;
    }
  }
  normalizeToFilePath(d) {
    try {
      return d.startsWith("file://") ? url.fileURLToPath(d) : path.resolve(d);
    } catch {
      return null;
    }
  }
  parseModuleFromFile(d, m) {
    try {
      let fileSync = fs.readFileSync(d, "utf-8");
      let keywords = isSystemVerilogPath(d) ? "(?:module|interface|program)(?:\\s+(?:automatic|static))?" : "module";
      if (!new RegExp(`\\b${keywords}\\s+${escapeRegExp(m)}\\b`).test(fileSync)) {
        return null;
      }
      if (this.filesInProgress.has(d)) {
        return null;
      }
      this.filesInProgress.add(d);
      try {
        return parseSource(fileSync, d, this).ast.modules.find((R) => R.name === m) ?? null;
      } finally {
        this.filesInProgress.delete(d);
      }
    } catch (k) {
      this.logger?.(
        `[ModuleResolver] Failed to parse '${d}' while searching for '${m}': ${k.message ?? k}`,
      );
      return null;
    }
  }
}
