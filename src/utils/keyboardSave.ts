import type { KeyboardEvent } from 'react';

// Однострочный input: Enter (без модификаторов) → save.
export function inputEnterToSave(onSave: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onSave();
  };
}

// Textarea: Enter → save; Ctrl/Cmd+Enter → вставить перенос строки в каретку.
export function textareaEnterToSave(onSave: () => void, setValue: (v: string) => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      setValue(el.value.slice(0, start) + '\n' + el.value.slice(end));
      requestAnimationFrame(() => {
        try {
          el.selectionStart = el.selectionEnd = start + 1;
        } catch {
          /* noop */
        }
      });
      return;
    }
    if (e.shiftKey || e.altKey) return; // Shift/Alt+Enter — оставляем нативный перенос
    e.preventDefault();
    onSave();
  };
}
