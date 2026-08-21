/**
 * 自定义下拉选择组件（移植自 tab-assistant，MIT）。
 * https://github.com/tinypumpkin/tab-assistant
 */
(() => {
  "use strict";

  const ENHANCED = "data-custom-select";
  let openController = null;

  function directOptions(select) {
    return [...select.options].map((option, index) => ({
      index,
      value: option.value,
      label: option.textContent.trim(),
      disabled: option.disabled || option.parentElement?.disabled === true,
    }));
  }

  function associatedLabel(select) {
    const explicit = select.getAttribute("aria-label");
    if (explicit) return explicit;
    const labelledBy = select.getAttribute("aria-labelledby");
    if (labelledBy) {
      const node = document.getElementById(labelledBy);
      if (node?.textContent?.trim()) return node.textContent.trim();
    }
    const label = select.labels?.[0];
    return label?.textContent?.trim() || select.name || select.id || "选择选项";
  }

  function wrapperVariant(select) {
    if (select.id === "noteStyleSelect") return "custom-select--template";
    if (select.classList.contains("notes-export-select") || select.classList.contains("ai-note-export-select")) {
      return "custom-select--export";
    }
    if (select.classList.contains("model-option-select")) return "custom-select--model";
    return "custom-select--full";
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement) || select.hasAttribute(ENHANCED)) return null;
    select.setAttribute(ENHANCED, "true");

    const wrapper = document.createElement("span");
    wrapper.className = `custom-select ${wrapperVariant(select)}`;
    const parent = select.parentNode;
    parent.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select__hit-area";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", associatedLabel(select));
    trigger.disabled = select.disabled;
    wrapper.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "custom-select__menu";
    menu.id = `custom-select-menu-${select.id || Math.random().toString(36).slice(2)}`;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", associatedLabel(select));
    trigger.setAttribute("aria-controls", menu.id);
    document.body.appendChild(menu);

    let activeIndex = -1;

    function options() {
      return directOptions(select);
    }

    function selectedIndex() {
      return Math.max(0, options().findIndex((item) => item.value === select.value));
    }

    function buildMenu() {
      menu.textContent = "";
      const items = options();
      activeIndex = selectedIndex();
      items.forEach((item) => {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "custom-select__option";
        optionButton.dataset.index = String(item.index);
        optionButton.dataset.value = item.value;
        optionButton.setAttribute("role", "option");
        optionButton.setAttribute("aria-selected", String(item.value === select.value));
        optionButton.disabled = item.disabled;
        optionButton.textContent = item.label;
        optionButton.addEventListener("click", () => choose(item.index));
        menu.appendChild(optionButton);
      });
      paintActive();
    }

    function paintActive({ scroll = false } = {}) {
      const buttons = [...menu.querySelectorAll(".custom-select__option")];
      buttons.forEach((button, index) => {
        button.classList.toggle("is-active", index === activeIndex);
        button.setAttribute("aria-selected", String(button.dataset.value === select.value));
      });
      const active = buttons[activeIndex];
      if (active) {
        trigger.setAttribute("aria-activedescendant", `${menu.id}-option-${activeIndex}`);
        active.id = `${menu.id}-option-${activeIndex}`;
        if (scroll) active.scrollIntoView({ block: "nearest" });
      }
    }

    function positionMenu() {
      const rect = wrapper.getBoundingClientRect();
      const compactWidth = wrapper.classList.contains("custom-select--model")
        ? 240
        : wrapper.classList.contains("custom-select--export")
          ? 120
          : 180;
      const width = Math.min(Math.max(rect.width, compactWidth), window.innerWidth - 16);
      const desiredLeft = wrapper.classList.contains("custom-select--model")
        ? rect.right - width
        : rect.left;
      const left = Math.max(8, Math.min(desiredLeft, window.innerWidth - width - 8));
      menu.style.width = `${width}px`;
      menu.style.left = `${left}px`;
      menu.style.visibility = "hidden";
      menu.classList.add("is-open");
      // 始终向下展开（用户预期「下拉」）。下方空间不足时收缩菜单高度，
      // 靠 overflow-y:auto 内部滚动，而不是向上弹。
      const below = window.innerHeight - rect.bottom - 8;
      const maxHeight = Math.min(260, Math.max(40, below));
      menu.style.maxHeight = `${maxHeight}px`;
      // top 也守住视口底边：maxHeight 已按 below 收缩，这里再兜一层，
      // 极端情况（select 几乎贴底）不会让菜单溢出视口。
      menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - maxHeight - 8)}px`;
      menu.style.visibility = "visible";
    }

    function open() {
      if (select.disabled || !select.isConnected) return;
      if (openController && openController !== controller) openController.close();
      buildMenu();
      wrapper.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      positionMenu();
      paintActive({ scroll: true });
      openController = controller;
    }

    function close({ focus = false } = {}) {
      wrapper.classList.remove("is-open");
      menu.classList.remove("is-open");
      menu.style.visibility = "";
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      if (openController === controller) openController = null;
      if (focus) trigger.focus();
    }

    function choose(index) {
      const item = options()[index];
      if (!item || item.disabled) return;
      select.value = item.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      close({ focus: true });
    }

    function move(delta) {
      const items = options();
      if (!items.length) return;
      let next = activeIndex;
      for (let tries = 0; tries < items.length; tries += 1) {
        next = (next + delta + items.length) % items.length;
        if (!items[next].disabled) break;
      }
      activeIndex = next;
      paintActive({ scroll: true });
    }

    const controller = { close, open, select, wrapper, trigger, menu };
    select._customSelect = controller;

    trigger.addEventListener("click", () => {
      if (wrapper.classList.contains("is-open")) close({ focus: true });
      else open();
    });
    trigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) {
        event.preventDefault();
      }
      if (event.key === "Escape") return close({ focus: true });
      const wasOpen = wrapper.classList.contains("is-open");
      if (!wasOpen) open();
      if (!wasOpen && (event.key === "Enter" || event.key === " ")) return;
      if (event.key === "ArrowDown") move(1);
      if (event.key === "ArrowUp") move(-1);
      if (event.key === "Home") {
        activeIndex = 0;
        paintActive({ scroll: true });
      }
      if (event.key === "End") {
        activeIndex = options().length - 1;
        paintActive({ scroll: true });
      }
      if (event.key === "Enter" || event.key === " ") choose(activeIndex);
    });
    select.addEventListener("focus", () => trigger.focus());
    select.addEventListener("change", () => queueMicrotask(() => {
      if (wrapper.classList.contains("is-open")) buildMenu();
    }));
    return controller;
  }

  function enhanceTree(root = document) {
    if (root instanceof HTMLSelectElement) enhance(root);
    root.querySelectorAll?.("select").forEach(enhance);
  }

  document.addEventListener("click", (event) => {
    if (!openController) return;
    if (openController.wrapper.contains(event.target) || openController.menu.contains(event.target)) return;
    openController.close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openController) openController.close({ focus: true });
  });
  window.addEventListener("resize", () => openController?.close());
  window.addEventListener(
    "scroll",
    (event) => {
      // 菜单自身滚动（overflow-y: auto 的选项列表）不能触发关闭——
      // capture 阶段这里会先于菜单的默认滚动收到事件，若直接 close，
      // 用户一滚轮菜单就消失（滚轮无法响应、选项点不上）。
      const target = event.target;
      if (openController && target instanceof Element) {
        if (openController.menu.contains(target) || openController.wrapper.contains(target)) return;
      }
      openController?.close();
    },
    true,
  );

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceTree(node);
      }
      if (mutation.type === "attributes" && mutation.target instanceof HTMLSelectElement) {
        const controller = mutation.target._customSelect || enhance(mutation.target);
        if (controller) controller.trigger.disabled = mutation.target.disabled;
      }
    }
    if (openController && !openController.select.isConnected) openController.close();
  });

  function init() {
    enhanceTree();
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
