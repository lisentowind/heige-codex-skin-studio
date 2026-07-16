import { HEX_COLOR } from "./constants.mjs";

const DEFAULT_ACCENT = "#24c9d7";
const CONTROL_ENDPOINT = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/v1\/persistence$/;
const CONTROL_TOKEN = /^[A-Za-z0-9_-]{43}$/;

// 客户端 CSS 由 Node 端模板加哨兵生成，替换后与内置主题同源，避免两套模板漂移
export const CSS_SENTINELS = {
  id: "heige-custom-sentinel-id",
  hero: "data:image/png;base64,HEIGEHEROSENTINEL",
  accent: "#010203",
  secondary: "#040506",
  surface: "#070809",
  text: "#0a0b0c",
};

function normalizeControl(control) {
  if (control === undefined || control === null) return null;
  if (typeof control !== "object" || Array.isArray(control)) {
    throw new Error("菜单控制描述必须是对象");
  }
  const keys = Object.keys(control).sort();
  const expectedKeys = [
    "available",
    "endpoint",
    "launcherName",
    "persistenceEnabled",
    "revision",
    "token",
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("菜单控制描述字段无效");
  }
  const endpointMatch = typeof control.endpoint === "string"
    ? CONTROL_ENDPOINT.exec(control.endpoint)
    : null;
  const port = endpointMatch === null ? 0 : Number(endpointMatch[1]);
  if (
    control.available !== true ||
    typeof control.persistenceEnabled !== "boolean" ||
    !Number.isSafeInteger(control.revision) ||
    control.revision < 0 ||
    endpointMatch === null ||
    port > 65_535 ||
    !CONTROL_TOKEN.test(control.token ?? "") ||
    Buffer.from(control.token, "base64url").length !== 32 ||
    Buffer.from(control.token, "base64url").toString("base64url") !== control.token ||
    control.launcherName !== "HeiGe 皮肤启动器"
  ) {
    throw new Error("菜单控制描述无效");
  }
  return {
    available: true,
    persistenceEnabled: control.persistenceEnabled,
    revision: control.revision,
    endpoint: control.endpoint,
    token: control.token,
    launcherName: control.launcherName,
  };
}

export function buildSkinMenuScript({
  entries,
  activeId,
  styleId,
  menuId,
  cssTemplate = "",
  preferStored = false,
  control = null,
}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("皮肤菜单至少需要一个主题");
  }
  const themes = entries.map((entry) => {
    if (!entry?.id || typeof entry.css !== "string") throw new Error("主题条目缺少 id 或 css");
    return {
      id: String(entry.id),
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : String(entry.id),
      accent: HEX_COLOR.test(entry.accent ?? "") ? entry.accent : DEFAULT_ACCENT,
      css: entry.css,
    };
  });
  if (activeId !== null && !themes.some((theme) => theme.id === activeId)) {
    throw new Error(`当前主题不在菜单列表中：${activeId}`);
  }
  const payload = JSON.stringify({
    styleId,
    menuId,
    activeId,
    themes,
    cssTemplate,
    sentinels: CSS_SENTINELS,
    customId: "custom-upload",
    storageKey: "heigeCodexCustomTheme",
    hiddenKey: "heigeCodexSkinMenuHidden",
    selectedKey: "heigeCodexSkinSelected",
    nativeSel: "__heige_native__",
    preferStored,
    control: normalizeControl(control),
  });

  return `(() => {
  const data = ${payload};

  let style = document.getElementById(data.styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = data.styleId;
    document.head.appendChild(style);
  }

  document.getElementById(data.menuId)?.remove();
  const root = document.createElement("div");
  root.id = data.menuId;
  // 双平台统一放顶部中间：右上角会撞 Windows 的窗口控制按钮和 Codex 自身菜单；
  // 顶部中间正是标题栏拖拽区，no-drag 必须保留，否则点击被拖拽吞掉
  root.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483000;font:500 13px/1.4 system-ui;user-select:none;-webkit-app-region:no-drag;";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "\\u{1F3A8}";
  button.title = "HeiGe Codex Skin Studio";
  button.style.cssText = "display:block;margin:0 auto;width:30px;height:30px;border-radius:50%;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.82);backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.14);cursor:pointer;font-size:15px;padding:0;-webkit-app-region:no-drag;";

  const panel = document.createElement("div");
  panel.style.cssText = "display:none;margin-top:8px;width:330px;max-width:calc(100vw - 24px);padding:6px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.94);backdrop-filter:blur(16px);box-shadow:0 10px 30px rgba(0,0,0,.18);color:#17344f;-webkit-app-region:no-drag;";

  const rows = new Map();
  const paint = (id) => {
    for (const [rowId, row] of rows) {
      row.style.background = rowId === id ? "rgba(36,201,215,.16)" : "transparent";
      row.style.fontWeight = rowId === id ? "700" : "500";
    }
  };
  const row = (label, dotColor, onPick, before) => {
    const item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;";
    const dot = document.createElement("span");
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;flex:none;background:" + dotColor + ";";
    const text = document.createElement("span");
    text.textContent = label;
    item.append(dot, text);
    item.addEventListener("mouseenter", () => { if (item.style.fontWeight !== "700") item.style.background = "rgba(0,0,0,.05)"; });
    // 先无条件复位再 paint：上传行/隐藏行不在 rows 里，paint 遍历不到它们，
    // 只靠 paint 会让这两行的 hover 灰底永久残留
    item.addEventListener("mouseleave", () => { item.style.background = "transparent"; paint(document.documentElement.dataset.heigeCodexSkin ?? null); });
    item.addEventListener("click", () => onPick(item));
    if (before) panel.insertBefore(item, before); else panel.appendChild(item);
    return item;
  };

  // 选中态持久化：重新注入（含看门狗补针）后恢复用户上次选的主题，而不是硬切回 activeId
  const writeSelected = (id) => { try { localStorage.setItem(data.selectedKey, id); } catch {} };
  const readSelected = () => { try { return localStorage.getItem(data.selectedKey); } catch { return null; } };
  // 卸载皮肤后 style 已脱离 DOM，任何脚本化调用不得再改 dataset/写存储，否则污染 status
  const alive = () => style.isConnected;

  const setTheme = (id, persist = true) => {
    if (!alive()) return;
    const theme = data.themes.find((candidate) => candidate.id === id);
    if (!theme) return;
    style.textContent = theme.css;
    document.documentElement.dataset.heigeCodexSkin = theme.id;
    paint(theme.id);
    if (persist) writeSelected(theme.id);
  };
  const clearTheme = (persist = true) => {
    if (!alive()) return;
    style.textContent = "";
    delete document.documentElement.dataset.heigeCodexSkin;
    paint(null);
    if (persist) writeSelected(data.nativeSel);
  };

  for (const theme of data.themes) {
    rows.set(theme.id, row(theme.name, theme.accent, () => { setTheme(theme.id); panel.style.display = "none"; }));
  }

  // ---- 自定义图片：本地选图 -> 压缩 -> 取色 -> 生成 CSS -> 持久化 ----
  const buildCustomCss = (dataUrl, colors) => data.cssTemplate
    .split(data.sentinels.hero).join(dataUrl)
    .split(data.sentinels.accent).join(colors.accent)
    .split(data.sentinels.secondary).join(colors.secondary)
    .split(data.sentinels.surface).join(colors.surface)
    .split(data.sentinels.text).join(colors.text)
    .split(data.sentinels.id).join(data.customId);

  const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  const extractPalette = (canvas) => {
    const ctx = canvas.getContext("2d");
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map();
    let lumSum = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum; count += 1;
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.18 || lum < 24 || lum > 245) continue;   // 灰、过暗、过曝不参与取主色
      const d = max - min || 1;
      let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const bucket = Math.round(h) % 6 * 2 + (sat > 0.55 ? 1 : 0);
      const entry = buckets.get(bucket) ?? { w: 0, r: 0, g: 0, b: 0, h: h * 60 };
      const weight = sat * sat;
      entry.w += weight; entry.r += r * weight; entry.g += g * weight; entry.b += b * weight;
      buckets.set(bucket, entry);
    }
    const avgLum = count ? lumSum / count : 128;
    const ranked = [...buckets.values()].sort((a, b2) => b2.w - a.w)
      .map((e) => ({ rgb: [e.r / e.w, e.g / e.w, e.b / e.w], h: e.h, w: e.w }));
    const accent = ranked[0]?.rgb ?? [36, 201, 215];
    // 色相是环形量：355° 与 10° 实际只差 15°，线性差会误判成对比色
    const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
    const second = ranked.find((e) => hueGap(e.h, ranked[0]?.h ?? 0) > 50)?.rgb
      ?? mix(accent, [255, 255, 255], 0.35);
    const light = avgLum > 128;
    const surface = light ? mix(accent, [252, 252, 255], 0.92) : mix(accent, [12, 12, 18], 0.86);
    const text = light ? mix(accent, [16, 24, 40], 0.82) : mix(accent, [244, 246, 252], 0.85);
    return {
      accent: hex(...accent),
      secondary: hex(...second),
      surface: hex(...surface),
      text: hex(...text),
    };
  };

  let currentCustom = null;   // 内存态：save 失败时仍以它为准，不被 localStorage 里的旧图覆盖
  const applyCustomTheme = (theme) => {
    if (!alive()) return;
    currentCustom = theme;
    style.textContent = buildCustomCss(theme.dataUrl, theme.colors);
    document.documentElement.dataset.heigeCodexSkin = data.customId;
    ensureCustomRow(theme);
    paint(data.customId);
    writeSelected(data.customId);
  };

  let customRow = null;
  const deleteCustom = () => {
    try { localStorage.removeItem(data.storageKey); } catch {}
    currentCustom = null;
    if (document.documentElement.dataset.heigeCodexSkin === data.customId) clearTheme();
    customRow?.remove();
    rows.delete(data.customId);
    customRow = null;
  };
  const ensureCustomRow = (theme) => {
    if (customRow) { customRow.querySelector("span + span").textContent = theme.name; customRow.firstChild.style.background = theme.colors.accent; return; }
    customRow = row(theme.name, theme.colors.accent, () => { applyCustomTheme(currentCustom ?? loadCustom() ?? theme); panel.style.display = "none"; }, uploadRow);
    const text = customRow.querySelector("span + span");
    text.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const del = document.createElement("span");
    del.textContent = "\\u00d7";
    del.title = "\\u5220\\u9664\\u81ea\\u5b9a\\u4e49\\u4e3b\\u9898";
    del.style.cssText = "flex:none;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;color:rgba(0,0,0,.45);font-size:14px;";
    del.addEventListener("mouseenter", () => { del.style.background = "rgba(220,60,60,.15)"; del.style.color = "#c03030"; });
    del.addEventListener("mouseleave", () => { del.style.background = "transparent"; del.style.color = "rgba(0,0,0,.45)"; });
    del.addEventListener("click", (event) => { event.stopPropagation(); deleteCustom(); });
    customRow.appendChild(del);
    rows.set(data.customId, customRow);
  };

  const loadCustom = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(data.storageKey) ?? "null");
      return saved && saved.dataUrl && saved.colors ? saved : null;
    } catch { return null; }
  };
  const saveCustom = (theme) => {
    try { localStorage.setItem(data.storageKey, JSON.stringify(theme)); return true; }
    catch (error) { console.warn("HeiGe Codex Skin：自定义主题图片过大，本次生效但重启后会回退到上一张图", error); return false; }
  };

  const importFromDataUrl = (dataUrl, name) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.width || !img.height) { reject(new Error("图片尺寸无效")); return; }
      const scale = Math.min(1, 1600 / img.width);
      const full = document.createElement("canvas");
      // 下限 1px：超宽图（如 4000×1）取整会得 0 高，toDataURL 产出空图坏主题
      full.width = Math.max(1, Math.round(img.width * scale));
      full.height = Math.max(1, Math.round(img.height * scale));
      full.getContext("2d").drawImage(img, 0, 0, full.width, full.height);
      const sample = document.createElement("canvas");
      sample.width = 48; sample.height = Math.max(1, Math.round(48 * img.height / img.width));
      sample.getContext("2d").drawImage(img, 0, 0, sample.width, sample.height);
      const theme = {
        name: name || "\\u6211\\u7684\\u56fe\\u7247",
        dataUrl: full.toDataURL("image/webp", 0.8),
        colors: extractPalette(sample),
      };
      saveCustom(theme);
      applyCustomTheme(theme);
      resolve(theme.colors);
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = dataUrl;
  });

  // 上传失败给用户一个可见反馈，不再静默吞掉 rejection
  const flashButton = (msg) => {
    const prevTitle = button.title;
    button.title = msg;
    button.animate?.([{ filter: "none" }, { filter: "brightness(1.6) saturate(0)" }, { filter: "none" }], { duration: 900 });
    setTimeout(() => { button.title = prevTitle; }, 2600);
    console.warn("HeiGe Codex Skin：" + msg);
  };

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/png,image/jpeg,image/webp";
  picker.style.display = "none";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importFromDataUrl(reader.result, file.name.replace(/\\.[a-z0-9]+$/i, ""))
        .catch(() => flashButton("\\u56fe\\u7247\\u5904\\u7406\\u5931\\u8d25\\uff0c\\u8bf7\\u6362\\u4e00\\u5f20"));
    };
    reader.onerror = () => flashButton("\\u6587\\u4ef6\\u8bfb\\u53d6\\u5931\\u8d25\\uff0c\\u8bf7\\u91cd\\u8bd5");
    reader.readAsDataURL(file);
    picker.value = "";
    panel.style.display = "none";
  });

  const uploadRow = row("\\uff0b \\u81ea\\u5b9a\\u4e49\\u56fe\\u7247", "rgba(36,201,215,.9)", () => picker.click());
  uploadRow.style.borderTop = "1px solid rgba(0,0,0,.08)";

  const native = row("\\u539f\\u751f\\u754c\\u9762", "rgba(0,0,0,.24)", () => { clearTheme(); panel.style.display = "none"; });
  rows.set(null, native);

  // ---- 常驻开关：只显示控制器确认的真实状态，不使用 localStorage 伪造持久化 ----
  let getPersistenceState = () => null;
  if (data.control?.available === true) {
    const section = document.createElement("section");
    section.dataset.heigeRole = "persistence-section";
    section.style.cssText = "margin-top:6px;padding:10px;border-top:1px solid rgba(23,52,79,.1);background:rgba(36,201,215,.055);border-radius:9px;";

    const heading = document.createElement("div");
    heading.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:14px;";
    const headingCopy = document.createElement("div");
    headingCopy.style.cssText = "min-width:0;";
    const headingTitle = document.createElement("div");
    headingTitle.textContent = "皮肤常驻";
    headingTitle.style.cssText = "font-weight:750;letter-spacing:.01em;color:#17344f;";
    const headingState = document.createElement("div");
    headingState.dataset.heigeRole = "persistence-state";
    headingState.style.cssText = "margin-top:1px;font-size:11px;color:rgba(23,52,79,.68);";
    headingCopy.append(headingTitle, headingState);

    const persistenceSwitch = document.createElement("button");
    persistenceSwitch.type = "button";
    persistenceSwitch.dataset.heigeRole = "persistence-switch";
    persistenceSwitch.setAttribute("role", "switch");
    persistenceSwitch.setAttribute("tabindex", "0");
    persistenceSwitch.setAttribute("aria-label", "皮肤常驻");
    persistenceSwitch.style.cssText = "position:relative;flex:none;width:42px;height:24px;padding:0;border:1px solid rgba(23,52,79,.2);border-radius:999px;cursor:pointer;-webkit-app-region:no-drag;";
    const switchKnob = document.createElement("span");
    switchKnob.setAttribute("aria-hidden", "true");
    switchKnob.style.cssText = "position:absolute;top:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.24);";
    persistenceSwitch.appendChild(switchKnob);
    heading.append(headingCopy, persistenceSwitch);

    const helper = document.createElement("p");
    helper.dataset.heigeRole = "persistence-helper";
    helper.textContent = "关闭后本次继续使用；下次启动恢复原生界面。\\n重新启用：打开「HeiGe 皮肤启动器」，或在 Codex 中说「启用 HeiGe 皮肤」。";
    helper.style.cssText = "margin:8px 0 0;white-space:pre-line;font-size:11px;line-height:1.55;color:rgba(23,52,79,.74);";

    const confirmation = document.createElement("div");
    confirmation.dataset.heigeRole = "persistence-confirmation";
    confirmation.hidden = true;
    confirmation.style.cssText = "margin-top:9px;padding:9px;border:1px solid rgba(187,72,50,.24);border-radius:8px;background:rgba(255,244,240,.92);";
    const confirmationText = document.createElement("div");
    confirmationText.textContent = "确认关闭常驻？本次会话仍继续使用皮肤，下次启动将恢复原生界面。";
    confirmationText.style.cssText = "font-size:11px;line-height:1.55;color:#713a31;";
    const confirmationActions = document.createElement("div");
    confirmationActions.style.cssText = "display:flex;justify-content:flex-end;gap:7px;margin-top:8px;";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.dataset.heigeRole = "persistence-cancel";
    cancel.textContent = "取消";
    cancel.style.cssText = "padding:4px 9px;border:1px solid rgba(23,52,79,.18);border-radius:6px;background:#fff;color:#17344f;cursor:pointer;";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.dataset.heigeRole = "persistence-confirm";
    confirm.textContent = "确认关闭";
    confirm.style.cssText = "padding:4px 9px;border:1px solid #a84232;border-radius:6px;background:#a84232;color:#fff;cursor:pointer;";
    confirmationActions.append(cancel, confirm);
    confirmation.append(confirmationText, confirmationActions);

    const alert = document.createElement("div");
    alert.dataset.heigeRole = "persistence-alert";
    alert.setAttribute("role", "alert");
    alert.setAttribute("aria-live", "polite");
    alert.hidden = true;
    alert.style.cssText = "margin-top:8px;padding:7px 8px;border-radius:7px;background:rgba(23,52,79,.07);font-size:11px;line-height:1.5;color:#17344f;white-space:pre-line;";

    section.append(heading, helper, confirmation, alert);
    panel.appendChild(section);

    let persistenceEnabled = data.control.persistenceEnabled;
    let controlRevision = data.control.revision;
    let pending = false;

    const showAlert = (message, kind = "error") => {
      alert.textContent = message;
      alert.style.background = kind === "success" ? "rgba(26,132,103,.10)" : "rgba(187,72,50,.10)";
      alert.style.color = kind === "success" ? "#175f4d" : "#713a31";
      alert.hidden = false;
    };
    const hideAlert = () => { alert.hidden = true; alert.textContent = ""; };
    const paintPersistence = () => {
      persistenceSwitch.setAttribute("aria-checked", String(persistenceEnabled));
      persistenceSwitch.setAttribute("aria-busy", String(pending));
      persistenceSwitch.disabled = pending;
      persistenceSwitch.style.background = persistenceEnabled ? "#1aaab8" : "rgba(23,52,79,.18)";
      persistenceSwitch.style.opacity = pending ? ".64" : "1";
      switchKnob.style.left = persistenceEnabled ? "21px" : "4px";
      headingState.textContent = pending ? "正在等待后台确认…" : persistenceEnabled ? "已开启，下次启动继续使用" : "已关闭，仅保留本次会话";
    };
    const safeClientError = (error) => {
      if (error?.name === "AbortError") return "控制器请求超时，请重试";
      let detail = typeof error?.message === "string" ? error.message : "无法连接后台控制器";
      detail = detail.split(data.control.token).join("[已隐去]").split(data.control.endpoint).join("本机控制端点");
      detail = detail.replace(/[\\r\\n\\t]+/g, " ").slice(0, 160);
      return detail.includes("控制器不可用") ? detail : "控制器不可用：" + detail;
    };
    const isRevision = (value) => Number.isSafeInteger(value) && value >= 0;
    const requestPersistence = async (target) => {
      if (pending || target === persistenceEnabled) return;
      const previousEnabled = persistenceEnabled;
      const requestRevision = controlRevision;
      pending = true;
      confirmation.hidden = true;
      hideAlert();
      paintPersistence();
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 3000);
      try {
        const response = await fetch(data.control.endpoint, {
          method: "POST",
          mode: "cors",
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: {
            "Content-Type": "application/json",
            "X-HeiGe-Control-Token": data.control.token,
          },
          body: JSON.stringify({ revision: requestRevision, persistenceEnabled: target }),
          signal: abortController.signal,
        });
        const body = await response.json();
        if (response.ok) {
          if (
            body?.ok !== true ||
            body.persistenceEnabled !== target ||
            !isRevision(body.revision) ||
            body.revision <= requestRevision
          ) {
            throw new Error("后台响应无效，开关未更改");
          }
          persistenceEnabled = target;
          controlRevision = body.revision;
          showAlert(target
            ? "常驻已开启，下次启动继续使用皮肤。"
            : "常驻已关闭。本次继续使用，下次启动恢复原生界面。\\n重新启用：打开「HeiGe 皮肤启动器」，或在 Codex 中说「启用 HeiGe 皮肤」。",
          "success");
        } else {
          if (
            body?.ok === false &&
            body.persistenceEnabled === previousEnabled &&
            isRevision(body.revision) &&
            body.revision > requestRevision
          ) {
            controlRevision = body.revision;
          }
          const message = typeof body?.message === "string" && body.message.length <= 160
            ? body.message
            : "后台拒绝了常驻设置，开关未更改";
          showAlert(message);
        }
      } catch (error) {
        showAlert(error?.message?.includes("后台响应无效") ? error.message : safeClientError(error));
      } finally {
        clearTimeout(timeoutId);
        pending = false;
        paintPersistence();
      }
    };
    const activatePersistenceSwitch = () => {
      if (pending) return;
      if (persistenceEnabled) {
        hideAlert();
        confirmation.hidden = false;
        cancel.focus();
      } else {
        void requestPersistence(true);
      }
    };
    persistenceSwitch.addEventListener("click", activatePersistenceSwitch);
    persistenceSwitch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activatePersistenceSwitch();
    });
    cancel.addEventListener("click", () => {
      confirmation.hidden = true;
      persistenceSwitch.focus();
    });
    confirm.addEventListener("click", () => { void requestPersistence(false); });
    getPersistenceState = () => ({ persistenceEnabled, revision: controlRevision, pending });
    paintPersistence();
  }

  // ---- 隐藏按钮：收成半透明小圆点少占地方，点圆点恢复，状态跨重启保留 ----
  const readHidden = () => { try { return localStorage.getItem(data.hiddenKey) === "1"; } catch { return false; } };
  const writeHidden = (value) => { try { if (value) localStorage.setItem(data.hiddenKey, "1"); else localStorage.removeItem(data.hiddenKey); } catch {} };
  const FULL_BUTTON_CSS = button.style.cssText;
  const MINI_BUTTON_CSS = "display:block;margin:0 auto;width:10px;height:10px;border-radius:50%;border:none;background:rgba(120,130,140,.55);box-shadow:0 1px 4px rgba(0,0,0,.18);cursor:pointer;font-size:0;padding:0;opacity:.35;transition:opacity .15s,transform .15s;-webkit-app-region:no-drag;";
  let hidden = false;
  const setHidden = (value, persist = true) => {
    hidden = value;
    button.style.cssText = value ? MINI_BUTTON_CSS : FULL_BUTTON_CSS;
    button.textContent = value ? "" : "\\u{1F3A8}";
    button.title = value ? "\\u663e\\u793a\\u6362\\u80a4\\u6309\\u94ae" : "HeiGe Codex Skin Studio";
    if (value) panel.style.display = "none";
    if (persist) writeHidden(value);
  };
  button.addEventListener("mouseenter", () => { if (hidden) { button.style.opacity = ".9"; button.style.transform = "scale(1.5)"; } });
  button.addEventListener("mouseleave", () => { if (hidden) { button.style.opacity = ".35"; button.style.transform = "scale(1)"; } });
  const hideRow = row("\\u9690\\u85cf\\u6b64\\u6309\\u94ae", "rgba(0,0,0,.18)", () => setHidden(true));
  hideRow.style.borderTop = "1px solid rgba(0,0,0,.08)";

  const saved = loadCustom();
  if (saved) ensureCustomRow(saved);

  button.addEventListener("click", () => {
    if (hidden) { setHidden(false); return; }
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  root.append(button, panel, picker);
  document.body.appendChild(root);
  // preferStored=true（看门狗自动补针/重开）：恢复用户上次的选择，不覆盖。persist=false 不反写。
  // preferStored=false（用户显式 apply/customize）：activeId 当场生效并记为新选择（persist=true）。
  const restore = () => {
    if (data.preferStored) {
      const sel = readSelected();
      if (sel === data.nativeSel) { clearTheme(false); return; }
      if (sel === data.customId) {
        const custom = currentCustom ?? loadCustom();
        if (custom) { applyCustomTheme(custom); return; }
      }
      if (sel && data.themes.some((t) => t.id === sel)) { setTheme(sel, false); return; }
    }
    if (data.activeId === null) clearTheme();
    else setTheme(data.activeId);
  };
  restore();
  if (readHidden()) setHidden(true, false);

  // 供脚本化调用与测试：window.__heigeCodexSkin.importFromDataUrl(dataUrl, name)
  window.__heigeCodexSkin = { importFromDataUrl, setTheme, clearTheme, deleteCustom, setHidden, getPersistenceState };
  return true;
})()`;
}
