class CheckerRegistry {
  checkers = new Map();
  register(d, m) {
    if (this.checkers.has(d)) {
      throw new Error(`Rule checker '${d}' is already registered.`);
    }
    this.checkers.set(d, m);
  }
  get(d) {
    return this.checkers.get(d);
  }
  has(d) {
    return this.checkers.has(d);
  }
  getAllCheckerNames() {
    return Array.from(this.checkers.keys());
  }
}

export const defaultRegistry = new CheckerRegistry();
