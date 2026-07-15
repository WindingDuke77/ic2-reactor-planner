"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Minecraft item tooltip that renders through a portal to <body>, so it is
// never clipped by a scrolling column's overflow. Anchors to the hovered
// element and flips/clamps to stay on screen.
export default function HoverTip({ children, tip, className, onEnter, onLeave, onDown }) {
  const anchor = useRef(null);
  const card = useRef(null);
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const show = () => {
    if (anchor.current) setRect(anchor.current.getBoundingClientRect());
  };
  const hide = () => setRect(null);

  // Place beside the anchor, then nudge back inside the viewport
  useLayoutEffect(() => {
    if (!rect || !card.current) return;
    const c = card.current.getBoundingClientRect();
    let left = rect.right + 6;
    let top = rect.top;
    if (left + c.width > window.innerWidth - 4) left = rect.left - c.width - 6;
    if (left < 4) left = 4;
    if (top + c.height > window.innerHeight - 4) top = window.innerHeight - c.height - 4;
    if (top < 4) top = 4;
    setPos({ left, top });
  }, [rect]);

  return (
    <div
      ref={anchor}
      className={className}
      onMouseEnter={(e) => { show(); onEnter && onEnter(e); }}
      onMouseLeave={(e) => { hide(); onLeave && onLeave(e); }}
      onMouseDown={(e) => { hide(); onDown && onDown(e); }}
    >
      {children}
      {rect && tip && typeof document !== "undefined" && createPortal(
        <div
          ref={card}
          className="mc-tooltip fixed z-[9999] w-56 p-2 text-left pointer-events-none"
          style={{ left: pos.left, top: pos.top }}
        >
          {tip}
        </div>,
        document.body
      )}
    </div>
  );
}
