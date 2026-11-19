import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { readApiResponse } from "../shared/http.js";
export const DraftContext = createContext("");
const read = (key) => {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
export function useDraftState(name, initial) {
  const scope = useContext(DraftContext),
    key = "arks-draft:" + scope + ":" + name;
  const [value, setValue] = useState(() =>
    scope
      ? (read(key) ?? (typeof initial === "function" ? initial() : initial))
      : typeof initial === "function"
        ? initial()
        : initial,
  );
  const timer = useRef(),
    current = useRef(value),
    cleared = useRef(false);
  current.current = value;
  async function remote(v) {
    if (!scope) return;
    try {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(key),
      );
      const id = Array.from(new Uint8Array(bytes), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      await readApiResponse(
        await fetch("/api/admin/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: id, value: v }),
        }),
      );
    } catch {}
  }
  useEffect(() => {
    if (scope && !cleared.current) {
      write(key, value);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => remote(value), 900);
    }
    return () => clearTimeout(timer.current);
  }, [scope, key, value]);
  useEffect(() => {
    const save = () => remote(current.current);
    window.addEventListener("arks-save-draft", save);
    return () => window.removeEventListener("arks-save-draft", save);
  }, [scope, key]);
  const clear = () => {
    cleared.current = true;
    clearTimeout(timer.current);
    try {
      sessionStorage.removeItem(key);
    } catch {}
    remote(null);
  };
  return [
    value,
    (v) => {
      cleared.current = false;
      setValue(v);
    },
    clear,
  ];
}
export function DraftForm({ children, onSubmit, draftKey, ...props }) {
  const scope = useContext(DraftContext),
    ref = useRef(),
    keyRef = useRef(""),
    timer = useRef(),
    [status, setStatus] = useState("");
  function values() {
    return [...ref.current.elements]
      .filter(
        (e) =>
          e.name && !["password", "file", "hidden", "submit"].includes(e.type),
      )
      .map((e) => ({
        name: e.name,
        value: e.value,
        checked: e.checked,
        type: e.type,
      }));
  }
  async function save(remote = true) {
    if (!scope || !keyRef.current) return;
    const value = values();
    write(keyRef.current, value);
    setStatus("Draft saved in this tab");
    if (remote)
      try {
        const key = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(keyRef.current),
        );
        const hex = Array.from(new Uint8Array(key), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join("");
        await readApiResponse(
          await fetch("/api/admin/draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: hex, value }),
          }),
        );
        setStatus("Draft saved");
      } catch {
        setStatus("Saved in this tab · server draft unavailable");
      }
  }
  useEffect(() => {
    if (!scope) return;
    const form = ref.current;
    keyRef.current =
      "arks-form:" +
      scope +
      ":" +
      (draftKey || form.querySelector("h3")?.textContent || "form") +
      ":" +
      values()
        .map((v) => v.name)
        .join(",");
    const saved = read(keyRef.current);
    if (saved) {
      for (const item of saved) {
        const matches = [...form.elements].filter(
          (e) => e.name === item.name && e.type === item.type,
        );
        for (const el of matches) {
          if (["checkbox", "radio"].includes(el.type)) {
            if (el.value === item.value) el.checked = item.checked;
          } else el.value = item.value;
        }
      }
      setStatus("Draft restored");
    }
    const handler = () => save();
    window.addEventListener("arks-save-draft", handler);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("arks-save-draft", handler);
    };
  }, [scope, draftKey]);
  return (
    <form
      {...props}
      ref={ref}
      onInputCapture={() => {
        if (scope) {
          save(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(), 900);
        }
      }}
      onChangeCapture={() => {
        if (scope) {
          save(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(), 900);
        }
      }}
      onSubmit={async (e) => {
        const result = await onSubmit?.(e);
        if (result === true) {
          clearTimeout(timer.current);
          try {
            sessionStorage.removeItem(keyRef.current);
          } catch {}
          setStatus("Changes applied");
        }
      }}
    >
      {children}
      {scope && (
        <div className="draft-status">
          <span role="status">
            {status ||
              "Changes are kept as a draft; use the action above to apply them."}
          </span>
          <button type="button" className="text-btn" onClick={() => save()}>
            Save draft
          </button>
        </div>
      )}
    </form>
  );
}
