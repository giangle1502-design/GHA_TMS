// Bộ phân tích công thức an toàn cho trường dữ liệu động.
// Không dùng eval/Function: tự tách token, dựng cây cú pháp và tính toán trên dữ liệu số.
// Hỗ trợ: số, mã trường, + - * / %, so sánh (> < >= <= = <>), (), và các hàm
// ROUND(x, n), MIN(...), MAX(...), ABS(x), IF(điều_kiện, a, b), AND(...), OR(...), NOT(x), N(x) (ô trống tính là 0).

export type FormulaNode =
  | { t: "num"; v: number }
  | { t: "ref"; name: string }
  | { t: "neg"; e: FormulaNode }
  | { t: "bin"; op: string; l: FormulaNode; r: FormulaNode }
  | { t: "call"; fn: string; args: FormulaNode[] };

export class FormulaError extends Error {}

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  ROUND: { min: 1, max: 2 },
  MIN: { min: 1, max: 20 },
  MAX: { min: 1, max: 20 },
  ABS: { min: 1, max: 1 },
  IF: { min: 3, max: 3 },
  AND: { min: 1, max: 20 },
  OR: { min: 1, max: 20 },
  NOT: { min: 1, max: 1 },
  N: { min: 1, max: 1 },
};

type Token = { k: "num" | "id" | "op" | "(" | ")" | ","; v: string; pos: number };

const MAX_LENGTH = 500;

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) throw new FormulaError(`Công thức tối đa ${MAX_LENGTH} ký tự`);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Số không hợp lệ ở vị trí ${i + 1}`);
      out.push({ k: "num", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "<>" || two === "!=") {
      out.push({ k: "op", v: two === "!=" ? "<>" : two, pos: i });
      i += 2;
      continue;
    }
    if ("+-*/%<>=".includes(c)) {
      out.push({ k: "op", v: c, pos: i });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ k: c, v: c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError(`Ký tự không hợp lệ "${c}" ở vị trí ${i + 1}`);
  }
  return out;
}

/** Phân tích công thức thành cây cú pháp. Ném FormulaError (tiếng Việt) nếu sai. */
export function parseFormula(src: string): FormulaNode {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new FormulaError("Công thức đang trống");
  let p = 0;
  let depth = 0;
  const peek = () => tokens[p];
  const take = () => tokens[p++];
  const expect = (k: Token["k"], what: string) => {
    const t = take();
    if (!t || t.k !== k) throw new FormulaError(`Thiếu ${what}${t ? ` ở vị trí ${t.pos + 1}` : " ở cuối công thức"}`);
    return t;
  };

  function comparison(): FormulaNode {
    let l = additive();
    while (peek()?.k === "op" && ["<", ">", "<=", ">=", "=", "<>"].includes(peek()!.v)) {
      const op = take().v;
      l = { t: "bin", op, l, r: additive() };
    }
    return l;
  }
  function additive(): FormulaNode {
    let l = multiplicative();
    while (peek()?.k === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = take().v;
      l = { t: "bin", op, l, r: multiplicative() };
    }
    return l;
  }
  function multiplicative(): FormulaNode {
    let l = unary();
    while (peek()?.k === "op" && ["*", "/", "%"].includes(peek()!.v)) {
      const op = take().v;
      l = { t: "bin", op, l, r: unary() };
    }
    return l;
  }
  function unary(): FormulaNode {
    if (peek()?.k === "op" && (peek()!.v === "-" || peek()!.v === "+")) {
      const op = take().v;
      const e = unary();
      return op === "-" ? { t: "neg", e } : e;
    }
    return primary();
  }
  function primary(): FormulaNode {
    const t = take();
    if (!t) throw new FormulaError("Công thức kết thúc đột ngột");
    if (t.k === "num") return { t: "num", v: Number(t.v) };
    if (t.k === "(") {
      if (++depth > 30) throw new FormulaError("Công thức lồng quá sâu");
      const e = comparison();
      expect(")", 'dấu ")"');
      depth--;
      return e;
    }
    if (t.k === "id") {
      if (peek()?.k === "(") {
        const fn = t.v.toUpperCase();
        const spec = FUNCTIONS[fn];
        if (!spec) throw new FormulaError(`Hàm "${t.v}" không được hỗ trợ`);
        take();
        if (++depth > 30) throw new FormulaError("Công thức lồng quá sâu");
        const args: FormulaNode[] = [];
        if (peek()?.k !== ")") {
          args.push(comparison());
          while (peek()?.k === ",") {
            take();
            args.push(comparison());
          }
        }
        expect(")", `dấu ")" của hàm ${fn}`);
        depth--;
        if (args.length < spec.min || args.length > spec.max) {
          throw new FormulaError(`Hàm ${fn} cần ${spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`} đối số`);
        }
        return { t: "call", fn, args };
      }
      return { t: "ref", name: t.v };
    }
    throw new FormulaError(`Không mong đợi "${t.v}" ở vị trí ${t.pos + 1}`);
  }

  const node = comparison();
  if (p < tokens.length) throw new FormulaError(`Không mong đợi "${tokens[p].v}" ở vị trí ${tokens[p].pos + 1}`);
  return node;
}

/** Danh sách mã trường được công thức tham chiếu. */
export function formulaRefs(node: FormulaNode, acc = new Set<string>()): Set<string> {
  switch (node.t) {
    case "ref":
      acc.add(node.name);
      break;
    case "neg":
      formulaRefs(node.e, acc);
      break;
    case "bin":
      formulaRefs(node.l, acc);
      formulaRefs(node.r, acc);
      break;
    case "call":
      node.args.forEach((a) => formulaRefs(a, acc));
      break;
  }
  return acc;
}

/**
 * Kiểm tra công thức hợp lệ và chỉ dùng các trường cho phép.
 * Trả về thông báo lỗi tiếng Việt, hoặc null nếu hợp lệ.
 */
export function validateFormula(src: string, allowedRefs: Iterable<string>, selfKey?: string): string | null {
  try {
    const node = parseFormula(src);
    const allowed = new Set(allowedRefs);
    for (const r of formulaRefs(node)) {
      if (r === selfKey) return "Công thức không được tham chiếu chính trường này";
      if (!allowed.has(r)) return `Trường "${r}" không tồn tại hoặc không phải trường số`;
    }
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : "Công thức không hợp lệ";
  }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tính giá trị công thức. Trường thiếu dữ liệu => kết quả null (không đoán số 0),
 * trừ khi nằm trong nhánh IF không được chọn. Chia cho 0 => null.
 */
export function evaluateFormula(node: FormulaNode, vars: Record<string, unknown>): number | null {
  switch (node.t) {
    case "num":
      return node.v;
    case "ref":
      return toNum(vars[node.name]);
    case "neg": {
      const v = evaluateFormula(node.e, vars);
      return v === null ? null : -v;
    }
    case "bin": {
      const l = evaluateFormula(node.l, vars);
      const r = evaluateFormula(node.r, vars);
      if (l === null || r === null) return null;
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? null : l / r;
        case "%": return r === 0 ? null : l % r;
        case "<": return l < r ? 1 : 0;
        case ">": return l > r ? 1 : 0;
        case "<=": return l <= r ? 1 : 0;
        case ">=": return l >= r ? 1 : 0;
        case "=": return l === r ? 1 : 0;
        case "<>": return l !== r ? 1 : 0;
      }
      return null;
    }
    case "call": {
      const a = node.args;
      switch (node.fn) {
        case "IF": {
          const c = evaluateFormula(a[0], vars);
          if (c === null) return null;
          return evaluateFormula(c !== 0 ? a[1] : a[2], vars);
        }
        case "ROUND": {
          const v = evaluateFormula(a[0], vars);
          const d = a[1] ? evaluateFormula(a[1], vars) : 0;
          if (v === null || d === null) return null;
          const f = 10 ** Math.max(-6, Math.min(6, Math.trunc(d)));
          return Math.round(v * f) / f;
        }
        case "ABS": {
          const v = evaluateFormula(a[0], vars);
          return v === null ? null : Math.abs(v);
        }
        case "N": {
          return evaluateFormula(a[0], vars) ?? 0;
        }
        case "NOT": {
          const v = evaluateFormula(a[0], vars);
          return v === null ? null : v === 0 ? 1 : 0;
        }
        default: {
          const vs = a.map((x) => evaluateFormula(x, vars));
          if (vs.some((v) => v === null)) return null;
          const ns = vs as number[];
          if (node.fn === "MIN") return Math.min(...ns);
          if (node.fn === "MAX") return Math.max(...ns);
          if (node.fn === "AND") return ns.every((v) => v !== 0) ? 1 : 0;
          if (node.fn === "OR") return ns.some((v) => v !== 0) ? 1 : 0;
          return null;
        }
      }
    }
  }
}

/** Tiện ích: phân tích + tính, trả về null nếu công thức lỗi. */
export function computeFormula(src: string | null | undefined, vars: Record<string, unknown>): number | null {
  if (!src) return null;
  try {
    return evaluateFormula(parseFormula(src), vars);
  } catch {
    return null;
  }
}
