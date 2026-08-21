/**
 * Mermaid 图表增强组件（移植自 tab-assistant 的 mermaid-widget，MIT）。
 * https://github.com/tinypumpkin/tab-assistant
 *
 * 把 ```mermaid 代码块升级为交互卡片：
 *   - 标题栏：Mermaid 标识 + 复制源码 / 下载 SVG / 查看源码 / 查看图形 / 重置视图
 *   - 源码/图形双模式切换（data-mode）
 *   - 滚轮缩放（0.25x ~ 4x）+ 拖拽平移（transform）
 *   - 失败兜底：保留源码文本，不炸页面
 *
 * 纯 DOM 构建，innerHTML 只放静态字面量图标，不接触用户内容，
 * 与 lib/markdown.js 的安全底线一致。全局依赖仅 window.mermaid。
 */
(function () {
  "use strict";

  var ICONS = {
    code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m14 4-4 16"/></svg>',
    preview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5v15l14-7.5-14-7.5Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M20 9A8 8 0 0 0 6.6 5.2L4 8"/><path d="M4 15a8 8 0 0 0 13.4 3.8L20 16"/></svg>',
  };

  /** 工具栏按钮文案。zh 为兜底，en 跟随宿主页 <html lang>。 */
  var MERMAID_BUTTON_TEXT_ZH = {
    copy: "复制 Mermaid 源码",
    download: "下载 SVG",
    code: "查看源码",
    preview: "查看图形",
    reset: "重置视图",
  };
  var MERMAID_BUTTON_TEXT_EN = {
    copy: "Copy Mermaid source",
    download: "Download SVG",
    code: "View source",
    preview: "View diagram",
    reset: "Reset view",
  };

  /** 宿主文档是否英文界面（读 <html lang>，sidepanel 切换语言时会更新）。 */
  function isEnglishDoc(doc) {
    try {
      return (
        ((doc && doc.documentElement && doc.documentElement.lang) || "")
          .toLowerCase()
          .indexOf("en") === 0
      );
    } catch (error) {
      return false;
    }
  }

  /** 静态字面量 SVG 图标（不接触用户内容）。 */
  function iconSvg(name) {
    return ICONS[name] || "";
  }

  function createButton(doc, action, title, iconName) {
    var button = doc.createElement("button");
    button.type = "button";
    button.className = "mermaid-btn mermaid-btn--" + action;
    button.dataset.action = action;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = iconSvg(iconName); // 静态字面量
    return button;
  }

  /**
   * 把 markdown.js 留下的 .mermaid-block（内含源码文本）升级为交互卡片。
   * 返回 { widget, element, source } 或 null（参数不合法时）。
   */
  function createMermaidWidget(sourceNode, code) {
    var doc = (sourceNode && sourceNode.ownerDocument) || document;
    if (!sourceNode || !doc.createElement || typeof sourceNode.replaceWith !== "function") {
      return null;
    }

    var widget = doc.createElement("section");
    widget.className = "mermaid-widget";
    widget.dataset.mode = "preview";
    widget.dataset.scale = "1";
    widget.dataset.x = "0";
    widget.dataset.y = "0";

    var header = doc.createElement("div");
    header.className = "mermaid-widget__header";

    var title = doc.createElement("div");
    title.className = "mermaid-widget__title";
    title.innerHTML = iconSvg("code") + "<span>Mermaid</span>"; // 静态字面量

    var toolbar = doc.createElement("div");
    toolbar.className = "mermaid-widget__toolbar";
    // 按钮文案跟随宿主页语言（sidepanel 切换语言时会更新 <html lang>）。
    // 未设置或非 en 时一律回退中文，与侧边栏默认一致。
    var L = isEnglishDoc(doc) ? MERMAID_BUTTON_TEXT_EN : MERMAID_BUTTON_TEXT_ZH;
    toolbar.appendChild(createButton(doc, "copy", L.copy, "copy"));
    toolbar.appendChild(createButton(doc, "download", L.download, "download"));
    toolbar.appendChild(createButton(doc, "code", L.code, "code"));
    toolbar.appendChild(createButton(doc, "preview", L.preview, "preview"));
    toolbar.appendChild(createButton(doc, "reset", L.reset, "reset"));

    header.appendChild(title);
    header.appendChild(toolbar);

    var body = doc.createElement("div");
    body.className = "mermaid-widget__body";

    var codePane = doc.createElement("pre");
    codePane.className = "mermaid-widget__code";
    var codeEl = doc.createElement("code");
    codeEl.textContent = code; // 纯文本，无注入
    codePane.appendChild(codeEl);

    var previewPane = doc.createElement("div");
    previewPane.className = "mermaid-widget__preview";

    var stage = doc.createElement("div");
    stage.className = "mermaid-widget__stage";
    var diagram = doc.createElement("div");
    diagram.className = "mermaid-widget__diagram mermaid";
    diagram.textContent = code; // mermaid.run 读它画图
    stage.appendChild(diagram);
    previewPane.appendChild(stage);

    body.appendChild(codePane);
    body.appendChild(previewPane);
    widget.appendChild(header);
    widget.appendChild(body);

    sourceNode.replaceWith(widget);
    return { widget: widget, element: diagram, source: code };
  }

  /** 给卡片接上交互（按钮/缩放/拖拽），幂等：dataset.ready 防重入。 */
  function setupMermaidWidget(item) {
    var widget = (item && item.widget) || (item && item.element && item.element.closest && item.element.closest(".mermaid-widget"));
    if (!widget || widget.dataset.ready === "true") return;
    widget.dataset.ready = "true";

    var source = (item && item.source) || "";
    var diagram = (item && item.element) || widget.querySelector(".mermaid-widget__diagram");

    function setMode(mode) {
      widget.dataset.mode = mode === "code" ? "code" : "preview";
    }

    function setTransform(scale, x, y) {
      var nextScale = Math.min(4, Math.max(0.25, scale));
      widget.dataset.scale = String(nextScale);
      widget.dataset.x = String(x);
      widget.dataset.y = String(y);
      if (diagram) {
        diagram.style.transform = "translate(" + x + "px, " + y + "px) scale(" + nextScale + ")";
      }
    }

    function resetView() {
      setTransform(1, 0, 0);
    }

    function copyCode() {
      var done = function () {
        widget.classList.add("mermaid-widget--copied");
        setTimeout(function () {
          widget.classList.remove("mermaid-widget--copied");
        }, 900);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(source).then(done, function (error) {
          console.warn("Copy Mermaid source failed", error);
        });
      }
    }

    function downloadSvg() {
      var svg = diagram && diagram.querySelector && diagram.querySelector("svg");
      if (!svg) return;
      var serializer = new XMLSerializer();
      var svgText = serializer.serializeToString(svg);
      var blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var link = (widget.ownerDocument || document).createElement("a");
      link.href = url;
      link.download = "mermaid.svg";
      link.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    }

    widget.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        var action = button.dataset.action;
        if (action === "code") setMode("code");
        if (action === "preview") setMode("preview");
        if (action === "copy") copyCode();
        if (action === "download") downloadSvg();
        if (action === "reset") resetView();
      });
    });

    var interactionTarget = widget.querySelector(".mermaid-widget__preview");
    if (interactionTarget) {
      interactionTarget.addEventListener("wheel", function (event) {
        event.preventDefault();
        var scale = Number(widget.dataset.scale || "1");
        var delta = event.deltaY < 0 ? 0.12 : -0.12;
        setTransform(scale + delta, Number(widget.dataset.x || "0"), Number(widget.dataset.y || "0"));
      }, { passive: false });

      var dragState = null;
      interactionTarget.addEventListener("pointerdown", function (event) {
        if (event.target.closest && event.target.closest("[data-action]")) return;
        if (event.button !== 0) return;
        dragState = {
          startX: event.clientX,
          startY: event.clientY,
          x: Number(widget.dataset.x || "0"),
          y: Number(widget.dataset.y || "0"),
        };
        if (interactionTarget.setPointerCapture) interactionTarget.setPointerCapture(event.pointerId);
        var stage = widget.querySelector(".mermaid-widget__stage");
        if (stage) stage.classList.add("mermaid-widget__stage--dragging");
      });
      interactionTarget.addEventListener("pointermove", function (event) {
        if (!dragState) return;
        setTransform(
          Number(widget.dataset.scale || "1"),
          dragState.x + event.clientX - dragState.startX,
          dragState.y + event.clientY - dragState.startY
        );
      });
      var stopDrag = function () {
        if (!dragState) return;
        dragState = null;
        if (interactionTarget.releasePointerCapture && interactionTarget.hasPointerCapture) {
          // releasePointerCapture 需要指针 id；此处仅在有捕获时释放
        }
        var stage = widget.querySelector(".mermaid-widget__stage");
        if (stage) stage.classList.remove("mermaid-widget__stage--dragging");
      };
      interactionTarget.addEventListener("pointerup", stopDrag);
      interactionTarget.addEventListener("pointercancel", stopDrag);
    }

    resetView();
    setMode("preview");
  }

  /**
   * 收集容器内所有未处理的 .mermaid-block，升级为交互卡片并交给 mermaid.run。
   * 由 sidepanel.js 在渲染完 markdown 后调用（图表依赖可见容器尺寸）。
   */
  function upgradeMermaidBlocks(root) {
    if (!root || !root.querySelectorAll) return;
    var blocks = root.querySelectorAll(".mermaid-block:not([data-mermaid-done])");
    if (!blocks.length) return;
    var items = [];
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      var code = block.dataset.mermaidSource || block.textContent || "";
      block.dataset.mermaidDone = "1"; // 防重入
      var built = createMermaidWidget(block, code);
      if (built) {
        items.push(built);
      } else {
        delete block.dataset.mermaidDone; // 升级失败允许重试
      }
    }
    if (!items.length) return;
    var win = (root.ownerDocument && root.ownerDocument.defaultView) || window;
    var lib = win.mermaid;
    if (!lib || typeof lib.initialize !== "function") {
      // mermaid 未加载：卡片保持源码文本模式
      for (var j = 0; j < items.length; j += 1) {
        items[j].widget.dataset.mode = "code";
      }
      return;
    }
    try {
      lib.initialize({ startOnLoad: false, securityLevel: "strict", darkMode: false });
    } catch (error) {
      console.warn("Mermaid initialization failed", error);
      return;
    }
    for (var k = 0; k < items.length; k += 1) {
      setupMermaidWidget(items[k]);
    }
    Promise.resolve(lib.run({ nodes: items.map(function (item) { return item.element; }) })).catch(function () {
      // 失败时恢复源码展示（mermaid 可能已清空容器）
      for (var m = 0; m < items.length; m += 1) {
        var diagram = items[m].element;
        if (!diagram.querySelector("svg")) {
          diagram.textContent = items[m].source || "";
        }
      }
    });
  }

  window.MermaidWidget = { upgradeMermaidBlocks: upgradeMermaidBlocks };
})();
