import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/**
 * A text box that grows with what is typed in it, so a long job description is
 * shown in full — up to a cap that follows the screen height (`.autogrow` in
 * styles.css: at most 480px, less on short screens). Past the cap it scrolls.
 * It never shrinks below the normal box, and can still be resized by hand.
 */
export default function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { className, value } = props;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      // scrollHeight + the borders; the CSS max-height caps it and turns on scrolling.
      el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
    };
    fit();
    // Re-fit when the box changes width (screen turned, window resized) — the
    // text wraps differently.
    let w = el.clientWidth;
    const onResize = () => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [value]);

  return <textarea {...props} ref={ref} className={`autogrow${className ? ` ${className}` : ''}`} />;
}
