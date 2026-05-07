import { useEffect, useMemo, useRef, useState } from "react";

export default function CustomSelect({ options, value, onChange, placeholder = "请选择模板" }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  const selectedLabel = useMemo(() => {
    const hit = options.find((opt) => opt.value === value);
    return hit ? hit.label : "";
  }, [options, value]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  return (
    <div ref={rootRef} className="custom-select-container">
      <div
        className={`select-trigger ${isOpen ? "open" : ""}`}
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsOpen((prev) => !prev);
          }
          if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
      >
        <span>{selectedLabel || placeholder}</span>
        <span className="arrow">▼</span>
      </div>

      {isOpen && (
        <ul className="select-dropdown" role="listbox">
          {options.map((opt) => (
            <li
              key={opt.value || "__default"}
              role="option"
              aria-selected={opt.value === value}
              className={`select-option ${opt.value === value ? "active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
