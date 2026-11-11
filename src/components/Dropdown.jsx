import { useEffect, useRef, useState } from "react";
import { useBackLayer, isPhone } from "../lib/backStack";

// Generic trigger+menu dropdown, ported from the .dropdown / [data-dropdown]
// pattern in components/dropdown.js — closes on outside click or Escape.
export default function Dropdown({ trigger, children, menuClassName = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // Phone: Back closes an open menu (notifications, profile...) instead of leaving the page.
  useBackLayer(open, () => setOpen(false), isPhone());

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className={`dropdown${open ? " is-open" : ""}`} ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div
          className={`dropdown__menu glass-panel ${menuClassName}`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
