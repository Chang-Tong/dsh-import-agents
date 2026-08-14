window.__ModuleLoader__.load({
  id: "dsh-import-pi-opencode",
  factory: (require) => {
var __dshImportClientFactory = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name2 in all)
      __defProp(target, name2, { get: all[name2], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/index.ts
  var index_exports = {};
  __export(index_exports, {
    apply: () => apply,
    inject: () => inject,
    name: () => name
  });

  // src/client/SyncButton.tsx
  var import_react = __require("react");
  var import_jsx_runtime = __require("react/jsx-runtime");
  var RESULT_HIDE_MS = 6e3;
  var styles = {
    button: {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      height: "24px",
      padding: "0 8px",
      border: "1px solid var(--dsw-border-subtle, #e0e0e0)",
      borderRadius: "6px",
      background: "var(--dsw-surface-subtle, transparent)",
      color: "var(--dsw-text-secondary, #666)",
      fontSize: "12px",
      cursor: "pointer",
      whiteSpace: "nowrap"
    },
    busy: { opacity: 0.6, cursor: "progress" },
    result: {
      maxWidth: "260px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontSize: "12px"
    },
    ok: { color: "var(--dsw-text-success, #2e7d32)" },
    error: { color: "var(--dsw-text-danger, #c62828)" }
  };
  function scheduleClear(timer, set) {
    if (timer.current !== void 0) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      set(void 0);
      timer.current = void 0;
    }, RESULT_HIDE_MS);
  }
  function SyncButton({ sync }) {
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [result, setResult] = (0, import_react.useState)(void 0);
    const timer = (0, import_react.useRef)(void 0);
    const onClick = async () => {
      if (busy) return;
      setBusy(true);
      setResult(void 0);
      try {
        const outcome = await sync();
        setResult(outcome);
        scheduleClear(timer, () => setResult(void 0));
      } catch {
        setResult({ ok: false, text: "\u540C\u6B65\u5931\u8D25" });
        scheduleClear(timer, () => setResult(void 0));
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          title: "\u540C\u6B65 pi / opencode \u7684\u5386\u53F2\u4F1A\u8BDD\u3001agents\u3001skills\uFF08/import-all\uFF09",
          style: { ...styles.button, ...busy ? styles.busy : {} },
          onClick: () => void onClick(),
          disabled: busy,
          children: busy ? "\u540C\u6B65\u4E2D\u2026" : "\u540C\u6B65"
        }
      ),
      result !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.result, ...result.ok ? styles.ok : styles.error }, children: result.text })
    ] });
  }

  // src/client/index.ts
  var name = "dsh-import-pi-opencode";
  var inject = ["slots"];
  function apply(ctx) {
    ctx.slots.inject("conversation.input.left", () => ctx.slots.register(
      {
        name: "conversation.input.left",
        id: "dsh-import-sync-button",
        inject: (sessionId) => ({
          sync: async () => {
            if (sessionId === void 0) {
              return { ok: false, text: "\u5F53\u524D\u6CA1\u6709\u4F1A\u8BDD" };
            }
            const result = await ctx.remote.commands.execute(sessionId, "/import-all");
            if (!result.ok) {
              return { ok: false, text: `${result.error.code}: ${result.error.message}` };
            }
            if (result.value === void 0) {
              return { ok: true, text: "\u547D\u4EE4\u672A\u627E\u5230" };
            }
            const outcome = result.value.result;
            return { ok: outcome.kind === "success", text: outcome.text ?? "\u5B8C\u6210" };
          }
        })
      },
      SyncButton
    ));
  }
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=factory.js.map

    return __dshImportClientFactory;
  },
});
//# sourceMappingURL=client.js.map
