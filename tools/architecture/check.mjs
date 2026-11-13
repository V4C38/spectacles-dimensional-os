/** Shared AST dependency checks. Callers supply their installed TypeScript compiler. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

export function dependencies(ts, file, source) {
  const result = [];
  const add = (node, runtime) => {
    if (node && ts.isStringLiteralLike(node)) result.push({ specifier: node.text, runtime });
  };
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyNamedTypes = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
        && bindings.elements.every(item => item.isTypeOnly) && !clause.name;
      add(node.moduleSpecifier, !clause?.isTypeOnly && !onlyNamedTypes);
    }
    if (ts.isExportDeclaration(node)) {
      const onlyNamedTypes = node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly);
      add(node.moduleSpecifier, !node.isTypeOnly && !onlyNamedTypes);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      add(node.moduleReference.expression, !node.isTypeOnly);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal, false);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0], true);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
  return result;
}

const outside = path => path === ".." || path.startsWith(".." + sep) || isAbsolute(path);
const fixturePath = path => path.split(/[\\/]/).some(part => ["tests", "Tests", "test_support", "Review"].includes(part));
const excludedFeatures = {
  localization: ["presentation", "navigation", "sensors", "agent"],
  sensors: ["presentation", "localization", "navigation", "agent"],
  agent: ["presentation", "localization", "navigation", "sensors"],
  manipulation: ["localization", "navigation", "sensors", "agent"],
};

export function importViolation(kind, file, root, dependency) {
  const { specifier, runtime } = dependency;
  const local = specifier.startsWith(".");
  const target = local ? relative(root, resolve(dirname(file), specifier)) : specifier;
  if (fixturePath(target)) return "production imports a test fixture";
  if (kind === "core" && (!local || outside(target))) return "Core imports outside authored source";
  if (kind === "specs" && (specifier.startsWith("@dimos-ar-client") || /(?:^|\/)core\/src\//.test(target)))
    return "Specs bypasses the installed Core package";
  if (kind === "specs" && /^(?:three(?:\/|$)|xrblocks(?:\/|$)|iwer(?:\/|$))/.test(specifier))
    return "Specs imports a browser SDK";
  if (kind === "webxr" && (specifier.startsWith("LensStudio:") || /\.lspkg(?:\/|$)/.test(specifier)))
    return "WebXR imports a Lens SDK";
  if (kind !== "core" && local && outside(target)) return "host imports outside its source boundary";
  if (kind !== "core" && local && runtime) {
    const domain = relative(root, file).split(sep)[0], targetDomain = target.split(sep)[0];
    if (excludedFeatures[domain]?.includes(targetDomain)) return `${domain} depends on unrelated ${targetDomain}`;
  }
  return null;
}

export function runtimeCycles(graph) {
  const active = new Set(), done = new Set(), stack = [], cycles = [];
  const visit = node => {
    if (active.has(node)) { cycles.push([...stack.slice(stack.indexOf(node)), node]); return; }
    if (done.has(node)) return;
    active.add(node); stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop(); active.delete(node); done.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return cycles;
}

export function checkProject(ts, root, kind) {
  const graph = new Map(), failures = [];
  for (const file of sourceFiles(root)) {
    const label = relative(root, file);
    graph.set(label, []);
    for (const dependency of dependencies(ts, file, readFileSync(file, "utf8"))) {
      const violation = importViolation(kind, file, root, dependency);
      if (violation) failures.push(`${label}: ${violation}: ${dependency.specifier}`);
      if (dependency.runtime && dependency.specifier.startsWith(".")) {
        const path = resolve(dirname(file), dependency.specifier);
        const target = [path, path + ".ts", join(path, "index.ts")].find(candidate => existsSync(candidate) && candidate.endsWith(".ts"));
        if (target && !outside(relative(root, target))) graph.get(label).push(relative(root, target));
      }
    }
  }
  failures.push(...runtimeCycles(graph).map(cycle => `runtime dependency cycle: ${cycle.join(" → ")}`));
  return failures;
}
